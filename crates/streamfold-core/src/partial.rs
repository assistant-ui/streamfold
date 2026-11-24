use crate::{JsonStreamParser, StreamError, StreamState, is_json_whitespace};

const PATCH_SET_OBJECT: u8 = 0;
const PATCH_SET_ARRAY: u8 = 1;
const PATCH_SET_STRING: u8 = 2;
const PATCH_APPEND_STRING: u8 = 3;
const PATCH_SET_NUMBER: u8 = 4;
const PATCH_SET_TRUE: u8 = 5;
const PATCH_SET_FALSE: u8 = 6;
const PATCH_SET_NULL: u8 = 7;
const PATCH_COMPLETE: u8 = 8;
const PATCH_INVALIDATE: u8 = 9;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RootState {
    Value,
    AfterValue,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ObjectState {
    FirstKeyOrEnd,
    KeyAfterComma,
    Colon,
    Value,
    CommaOrEnd,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ArrayState {
    FirstValueOrEnd,
    ValueAfterComma,
    CommaOrEnd,
}

#[derive(Debug)]
enum Frame {
    Object {
        state: ObjectState,
        key: Option<Vec<u16>>,
    },
    Array {
        state: ArrayState,
        next_index: u32,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Expected {
    RootValue,
    RootAfterValue,
    ObjectKeyOrEnd,
    ObjectKey,
    ObjectColon,
    ObjectValue,
    ObjectCommaOrEnd,
    ArrayValueOrEnd,
    ArrayValue,
    ArrayCommaOrEnd,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StringRole {
    Key,
    Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EscapeState {
    None,
    Escape,
    Unicode { value: u16, digits: u8 },
}

#[derive(Debug)]
struct StringToken {
    role: StringRole,
    units: Vec<u16>,
    delta: Vec<u16>,
    raw_utf8: Vec<u8>,
    escape: EscapeState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StringStep {
    Continue,
    Closed,
}

impl StringToken {
    fn new(role: StringRole) -> Self {
        Self {
            role,
            units: Vec::new(),
            delta: Vec::new(),
            raw_utf8: Vec::new(),
            escape: EscapeState::None,
        }
    }

    fn consume(&mut self, byte: u8, offset: usize) -> Result<StringStep, StreamError> {
        match self.escape {
            EscapeState::None => match byte {
                b'"' => {
                    self.flush_utf8(offset, true)?;
                    Ok(StringStep::Closed)
                }
                b'\\' => {
                    self.flush_utf8(offset, true)?;
                    self.escape = EscapeState::Escape;
                    Ok(StringStep::Continue)
                }
                0x00..=0x1f => Err(StreamError::InvalidJson { offset }),
                _ => {
                    self.raw_utf8.push(byte);
                    Ok(StringStep::Continue)
                }
            },
            EscapeState::Escape => {
                match byte {
                    b'"' | b'\\' | b'/' => self.push_unit(byte.into()),
                    b'b' => self.push_unit(0x0008),
                    b'f' => self.push_unit(0x000c),
                    b'n' => self.push_unit(0x000a),
                    b'r' => self.push_unit(0x000d),
                    b't' => self.push_unit(0x0009),
                    b'u' => {
                        self.escape = EscapeState::Unicode {
                            value: 0,
                            digits: 0,
                        };
                        return Ok(StringStep::Continue);
                    }
                    _ => return Err(StreamError::InvalidJson { offset }),
                }
                self.escape = EscapeState::None;
                Ok(StringStep::Continue)
            }
            EscapeState::Unicode {
                mut value,
                mut digits,
            } => {
                let Some(hex) = hex_value(byte) else {
                    return Err(StreamError::InvalidJson { offset });
                };
                value = (value << 4) | u16::from(hex);
                digits += 1;
                if digits == 4 {
                    self.push_unit(value);
                    self.escape = EscapeState::None;
                } else {
                    self.escape = EscapeState::Unicode { value, digits };
                }
                Ok(StringStep::Continue)
            }
        }
    }

    fn flush_chunk(&mut self, offset: usize) -> Result<(), StreamError> {
        self.flush_utf8(offset, false)
    }

    fn flush_utf8(&mut self, offset: usize, terminated: bool) -> Result<(), StreamError> {
        if self.raw_utf8.is_empty() {
            return Ok(());
        }

        let units = match self.role {
            StringRole::Key => &mut self.units,
            StringRole::Value => &mut self.delta,
        };
        match std::str::from_utf8(&self.raw_utf8) {
            Ok(text) => {
                extend_utf16(units, text);
                self.raw_utf8.clear();
                Ok(())
            }
            Err(error) => {
                let valid = error.valid_up_to();
                if valid > 0 {
                    extend_utf16(
                        units,
                        std::str::from_utf8(&self.raw_utf8[..valid]).expect("valid UTF-8 prefix"),
                    );
                    self.raw_utf8.drain(..valid);
                }
                if terminated || error.error_len().is_some() {
                    Err(StreamError::InvalidJson {
                        offset: offset.saturating_sub(self.raw_utf8.len()),
                    })
                } else {
                    Ok(())
                }
            }
        }
    }

    fn push_unit(&mut self, unit: u16) {
        self.push_units(&[unit]);
    }

    fn push_units(&mut self, units: &[u16]) {
        match self.role {
            StringRole::Key => self.units.extend_from_slice(units),
            StringRole::Value => self.delta.extend_from_slice(units),
        }
    }
}

fn extend_utf16(units: &mut Vec<u16>, text: &str) {
    if text.is_ascii() {
        units.extend(text.bytes().map(u16::from));
    } else {
        units.extend(text.encode_utf16());
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LiteralKind {
    True,
    False,
    Null,
}

impl LiteralKind {
    fn bytes(self) -> &'static [u8] {
        match self {
            Self::True => b"true",
            Self::False => b"false",
            Self::Null => b"null",
        }
    }

    fn patch(self) -> u8 {
        match self {
            Self::True => PATCH_SET_TRUE,
            Self::False => PATCH_SET_FALSE,
            Self::Null => PATCH_SET_NULL,
        }
    }
}

#[derive(Debug)]
struct LiteralToken {
    kind: LiteralKind,
    matched: usize,
}

/// Patch capacity a parser keeps between calls.
const RETAINED_PATCH_BYTES: usize = 64 * 1024;
/// A completion patch whose path is shared with the previous patch.
const COMPLETE_PATCH_BYTES: usize = 5;

/// Significant digits kept in partial patches for long numbers. Every midpoint
/// between adjacent doubles has at most 768 significant decimal digits, so
/// keeping more than that and appending a nonzero digit when any dropped digit
/// is nonzero rounds to the same double as the full prefix.
const NUMBER_PATCH_DIGITS: usize = 800;
/// Exponents beyond this already round every prefix to zero or infinity.
const NUMBER_EXPONENT_LIMIT: i64 = 1_000_000_000_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NumberState {
    Start,
    Sign,
    Zero,
    Integer,
    Point,
    Fraction,
    Exponent,
    ExponentSign,
    ExponentDigits,
    Invalid,
}

#[derive(Debug)]
struct NumberToken {
    raw: Vec<u8>,
    state: NumberState,
    /// Length of the longest valid JSON number prefix of `raw`, or zero.
    valid_length: usize,
    emitted_length: usize,
    /// `raw[digits_start..digits_end]` holds the kept significant digits,
    /// possibly with the decimal point between them.
    digits_start: usize,
    digits_end: usize,
    significant_digits: usize,
    /// A nonzero significant digit was dropped after `NUMBER_PATCH_DIGITS`.
    truncated: bool,
    /// The mantissa equals `0.<significant digits> * 10^point`.
    point: i64,
    exponent: i64,
    exponent_negative: bool,
}

impl NumberToken {
    fn new(byte: u8) -> Self {
        let mut number = Self {
            raw: Vec::new(),
            state: NumberState::Start,
            valid_length: 0,
            emitted_length: 0,
            digits_start: 0,
            digits_end: 0,
            significant_digits: 0,
            truncated: false,
            point: 0,
            exponent: 0,
            exponent_negative: false,
        };
        number.push(byte);
        number
    }

    fn push(&mut self, byte: u8) {
        let index = self.raw.len();
        self.raw.push(byte);
        self.state = match (self.state, byte) {
            (NumberState::Start, b'-') => NumberState::Sign,
            (NumberState::Start | NumberState::Sign, b'0') => NumberState::Zero,
            (NumberState::Start | NumberState::Sign | NumberState::Integer, b'0'..=b'9') => {
                self.point += 1;
                self.push_significant_digit(index, byte);
                NumberState::Integer
            }
            (NumberState::Zero | NumberState::Integer, b'.') => NumberState::Point,
            (NumberState::Point | NumberState::Fraction, b'0'..=b'9') => {
                if self.significant_digits == 0 && byte == b'0' {
                    self.point -= 1;
                } else {
                    self.push_significant_digit(index, byte);
                }
                NumberState::Fraction
            }
            (NumberState::Zero | NumberState::Integer | NumberState::Fraction, b'e' | b'E') => {
                NumberState::Exponent
            }
            (NumberState::Exponent, b'+') => NumberState::ExponentSign,
            (NumberState::Exponent, b'-') => {
                self.exponent_negative = true;
                NumberState::ExponentSign
            }
            (
                NumberState::Exponent | NumberState::ExponentSign | NumberState::ExponentDigits,
                b'0'..=b'9',
            ) => {
                self.exponent =
                    (self.exponent * 10 + i64::from(byte - b'0')).min(NUMBER_EXPONENT_LIMIT);
                NumberState::ExponentDigits
            }
            _ => NumberState::Invalid,
        };
        if matches!(
            self.state,
            NumberState::Zero
                | NumberState::Integer
                | NumberState::Fraction
                | NumberState::ExponentDigits
        ) {
            self.valid_length = self.raw.len();
        }
    }

    fn push_significant_digit(&mut self, index: usize, byte: u8) {
        if self.significant_digits == 0 {
            self.digits_start = index;
        }
        self.significant_digits += 1;
        if self.significant_digits <= NUMBER_PATCH_DIGITS {
            self.digits_end = index + 1;
        } else if byte != b'0' {
            self.truncated = true;
        }
    }

    fn is_valid(&self) -> bool {
        self.valid_length == self.raw.len()
    }

    /// Writes text that `Number()` parses to the same value as the longest
    /// valid prefix, in at most `NUMBER_PATCH_DIGITS` plus a few bytes.
    fn write_partial_value(&self, output: &mut Vec<u8>) {
        if self.valid_length <= NUMBER_PATCH_DIGITS {
            output.extend_from_slice(&self.raw[..self.valid_length]);
            return;
        }
        if self.raw[0] == b'-' {
            output.push(b'-');
        }
        if self.significant_digits == 0 {
            output.push(b'0');
            return;
        }
        output.extend_from_slice(b"0.");
        output.extend(
            self.raw[self.digits_start..self.digits_end]
                .iter()
                .copied()
                .filter(|&byte| byte != b'.'),
        );
        if self.truncated {
            output.push(b'1');
        } else {
            while output.last() == Some(&b'0') {
                output.pop();
            }
        }
        output.push(b'e');
        let exponent = if self.exponent_negative {
            self.point - self.exponent
        } else {
            self.point + self.exponent
        };
        write_i64(output, exponent);
    }
}

#[derive(Debug)]
enum Token {
    None,
    String(StringToken),
    Literal(LiteralToken),
    Number(NumberToken),
}

#[derive(Debug)]
pub struct PartialValueParser {
    root: RootState,
    stack: Vec<Frame>,
    token: Token,
    bytes_seen: usize,
    output: Vec<u8>,
    // Leading segments of the current path that the reader already holds from
    // the previous encoded path, so only the changed suffix is written.
    shared_path: usize,
}

impl Default for PartialValueParser {
    fn default() -> Self {
        Self {
            root: RootState::Value,
            stack: Vec::new(),
            token: Token::None,
            bytes_seen: 0,
            output: Vec::new(),
            shared_path: 0,
        }
    }
}

impl PartialValueParser {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, chunk: &[u8]) -> Result<(), StreamError> {
        self.push_from(chunk, 0, usize::MAX).map(|_| ())
    }

    /// Processes `chunk[start..]` until the chunk ends or at least
    /// `patch_limit` patch bytes are pending. Returns the index to continue
    /// from when it stops early. Reading the patches after each call and
    /// continuing from that index yields the same patches, in the same order,
    /// as one `push` of the whole chunk.
    pub fn push_from(
        &mut self,
        chunk: &[u8],
        start: usize,
        patch_limit: usize,
    ) -> Result<Option<usize>, StreamError> {
        self.reset_output();
        let result = self.push_chunk(chunk, start, patch_limit);
        if result.is_err() {
            // The reader discards output from a failed call.
            self.shared_path = 0;
        }
        result
    }

    // Wasm memory never shrinks, so capacity left behind by one large call is
    // returned to the allocator for other parsers rather than kept until finish.
    fn reset_output(&mut self) {
        self.output.clear();
        self.output.shrink_to(RETAINED_PATCH_BYTES);
    }

    fn push_chunk(
        &mut self,
        chunk: &[u8],
        start: usize,
        patch_limit: usize,
    ) -> Result<Option<usize>, StreamError> {
        let mut index = start;
        while index < chunk.len() {
            if let Token::String(string) = &mut self.token
                && string.escape == EscapeState::None
            {
                let remaining = &chunk[index..];
                let length = remaining
                    .iter()
                    .position(|&byte| byte == b'"' || byte == b'\\' || byte < 0x20)
                    .unwrap_or(remaining.len());
                string.raw_utf8.extend_from_slice(&remaining[..length]);
                index += length;
                self.bytes_seen += length;
                if index == chunk.len() {
                    break;
                }
            }
            let byte = chunk[index];
            let offset = self.bytes_seen;
            index += 1;
            self.bytes_seen += 1;
            self.consume(byte, offset)?;
            if self.output.len() >= patch_limit && index < chunk.len() {
                return Ok(Some(index));
            }
        }
        self.flush_partial(chunk.len())?;
        Ok(None)
    }

    pub fn finish(&mut self) -> Result<(), StreamError> {
        self.reset_output();
        let result = self.finish_value();
        if result.is_err() {
            self.shared_path = 0;
        }
        result
    }

    fn finish_value(&mut self) -> Result<(), StreamError> {
        match std::mem::replace(&mut self.token, Token::None) {
            Token::None => {}
            Token::Number(number) => {
                if !number.is_valid() {
                    self.token = Token::Number(number);
                    return Err(StreamError::InvalidJson {
                        offset: self.bytes_seen,
                    });
                }
                self.emit_number_if_changed(&number);
                self.emit_complete();
                self.complete_value()?;
            }
            Token::Literal(literal) => {
                self.token = Token::Literal(literal);
                return Err(StreamError::InvalidJson {
                    offset: self.bytes_seen,
                });
            }
            Token::String(string) => {
                self.token = Token::String(string);
                return Err(StreamError::Incomplete {
                    offset: self.bytes_seen,
                });
            }
        }

        if self.root != RootState::AfterValue || !self.stack.is_empty() {
            return Err(StreamError::Incomplete {
                offset: self.bytes_seen,
            });
        }
        self.output.shrink_to_fit();
        Ok(())
    }

    pub fn patch_bytes(&self) -> &[u8] {
        &self.output
    }

    fn consume(&mut self, byte: u8, offset: usize) -> Result<(), StreamError> {
        // Number bytes update the token in place instead of moving it out.
        if let Token::Number(number) = &mut self.token
            && is_number_byte(byte)
        {
            number.push(byte);
            return Ok(());
        }
        let token = std::mem::replace(&mut self.token, Token::None);
        match token {
            Token::None => self.consume_structural(byte, offset),
            Token::String(mut string) => match string.consume(byte, offset)? {
                StringStep::Continue => {
                    self.token = Token::String(string);
                    Ok(())
                }
                StringStep::Closed => self.complete_string(string),
            },
            Token::Literal(mut literal) => {
                let expected = literal.kind.bytes();
                if byte != expected[literal.matched] {
                    self.token = Token::Literal(literal);
                    return Err(StreamError::InvalidJson { offset });
                }
                literal.matched += 1;
                if literal.matched == expected.len() {
                    self.complete_value()
                } else {
                    self.token = Token::Literal(literal);
                    Ok(())
                }
            }
            Token::Number(number) => {
                if !number.is_valid() {
                    self.token = Token::Number(number);
                    return Err(StreamError::InvalidJson { offset });
                }
                self.emit_number_if_changed(&number);
                self.emit_complete();
                self.complete_value()?;
                self.consume_structural(byte, offset)
            }
        }
    }

    fn consume_structural(&mut self, byte: u8, offset: usize) -> Result<(), StreamError> {
        if is_json_whitespace(byte) {
            return Ok(());
        }

        match self.expected() {
            Expected::RootValue
            | Expected::ObjectValue
            | Expected::ArrayValueOrEnd
            | Expected::ArrayValue => {
                if self.expected() == Expected::ArrayValueOrEnd && byte == b']' {
                    return self.close_array(offset);
                }
                self.start_value(byte, offset)
            }
            Expected::RootAfterValue => Err(StreamError::TrailingData { offset }),
            Expected::ObjectKeyOrEnd => {
                if byte == b'}' {
                    self.close_object(offset)
                } else if byte == b'"' {
                    self.token = Token::String(StringToken::new(StringRole::Key));
                    Ok(())
                } else {
                    Err(StreamError::InvalidJson { offset })
                }
            }
            Expected::ObjectKey => {
                if byte == b'"' {
                    self.token = Token::String(StringToken::new(StringRole::Key));
                    Ok(())
                } else {
                    Err(StreamError::InvalidJson { offset })
                }
            }
            Expected::ObjectColon => {
                if byte != b':' {
                    return Err(StreamError::InvalidJson { offset });
                }
                let Some(Frame::Object { state, .. }) = self.stack.last_mut() else {
                    unreachable!();
                };
                *state = ObjectState::Value;
                Ok(())
            }
            Expected::ObjectCommaOrEnd => match byte {
                b',' => {
                    let Some(Frame::Object { state, .. }) = self.stack.last_mut() else {
                        unreachable!();
                    };
                    *state = ObjectState::KeyAfterComma;
                    Ok(())
                }
                b'}' => self.close_object(offset),
                _ => Err(StreamError::InvalidJson { offset }),
            },
            Expected::ArrayCommaOrEnd => match byte {
                b',' => {
                    let Some(Frame::Array { state, .. }) = self.stack.last_mut() else {
                        unreachable!();
                    };
                    *state = ArrayState::ValueAfterComma;
                    Ok(())
                }
                b']' => self.close_array(offset),
                _ => Err(StreamError::InvalidJson { offset }),
            },
        }
    }

    fn start_value(&mut self, byte: u8, offset: usize) -> Result<(), StreamError> {
        self.check_value_slot()?;
        match byte {
            b'{' => {
                self.emit_path_patch(PATCH_SET_OBJECT);
                self.push_frame(Frame::Object {
                    state: ObjectState::FirstKeyOrEnd,
                    key: None,
                });
            }
            b'[' => {
                self.emit_path_patch(PATCH_SET_ARRAY);
                self.push_frame(Frame::Array {
                    state: ArrayState::FirstValueOrEnd,
                    next_index: 0,
                });
            }
            b'"' => {
                self.emit_path_patch(PATCH_SET_STRING);
                self.token = Token::String(StringToken::new(StringRole::Value));
            }
            b't' => self.start_literal(LiteralKind::True),
            b'f' => self.start_literal(LiteralKind::False),
            b'n' => self.start_literal(LiteralKind::Null),
            b'-' | b'0'..=b'9' => {
                self.token = Token::Number(NumberToken::new(byte));
            }
            _ => return Err(StreamError::InvalidJson { offset }),
        }
        Ok(())
    }

    fn start_literal(&mut self, kind: LiteralKind) {
        self.emit_path_patch(kind.patch());
        self.emit_complete();
        self.token = Token::Literal(LiteralToken { kind, matched: 1 });
    }

    fn push_frame(&mut self, frame: Frame) {
        self.unshare_path_from(self.stack.len());
        self.stack.push(frame);
    }

    fn pop_frame(&mut self) -> Option<Frame> {
        let frame = self.stack.pop();
        self.unshare_path_from(self.stack.len());
        frame
    }

    /// Marks path segments from `depth` onward as changed since the last
    /// encoded path. Segment `depth` is the key or index held by frame `depth`.
    fn unshare_path_from(&mut self, depth: usize) {
        self.shared_path = self.shared_path.min(depth);
    }

    fn complete_string(&mut self, mut string: StringToken) -> Result<(), StreamError> {
        match string.role {
            StringRole::Key => {
                self.unshare_path_from(self.stack.len() - 1);
                let Some(Frame::Object { state, key, .. }) = self.stack.last_mut() else {
                    unreachable!();
                };
                *key = Some(string.units);
                *state = ObjectState::Colon;
                Ok(())
            }
            StringRole::Value => {
                if !string.delta.is_empty() {
                    self.emit_string_append(&string.delta);
                    string.delta.clear();
                }
                self.emit_complete();
                self.complete_value()
            }
        }
    }

    fn complete_value(&mut self) -> Result<(), StreamError> {
        let Some(depth) = self.stack.len().checked_sub(1) else {
            self.root = RootState::AfterValue;
            return Ok(());
        };
        self.unshare_path_from(depth);
        let frame = &mut self.stack[depth];

        match frame {
            Frame::Object { state, key, .. } if *state == ObjectState::Value => {
                *state = ObjectState::CommaOrEnd;
                *key = None;
                Ok(())
            }
            Frame::Array {
                state, next_index, ..
            } if matches!(
                state,
                ArrayState::FirstValueOrEnd | ArrayState::ValueAfterComma
            ) =>
            {
                *state = ArrayState::CommaOrEnd;
                *next_index = next_index.checked_add(1).ok_or(StreamError::InvalidJson {
                    offset: self.bytes_seen,
                })?;
                Ok(())
            }
            _ => Err(StreamError::InvalidJson {
                offset: self.bytes_seen,
            }),
        }
    }

    fn close_object(&mut self, offset: usize) -> Result<(), StreamError> {
        let Some(Frame::Object { state, .. }) = self.stack.last() else {
            return Err(StreamError::InvalidJson { offset });
        };
        if !matches!(state, ObjectState::FirstKeyOrEnd | ObjectState::CommaOrEnd) {
            return Err(StreamError::InvalidJson { offset });
        }
        let Some(Frame::Object { .. }) = self.pop_frame() else {
            unreachable!();
        };
        self.emit_complete();
        self.complete_value()
    }

    fn close_array(&mut self, offset: usize) -> Result<(), StreamError> {
        let Some(Frame::Array { state, .. }) = self.stack.last() else {
            return Err(StreamError::InvalidJson { offset });
        };
        if !matches!(state, ArrayState::FirstValueOrEnd | ArrayState::CommaOrEnd) {
            return Err(StreamError::InvalidJson { offset });
        }
        let Some(Frame::Array { .. }) = self.pop_frame() else {
            unreachable!();
        };
        self.emit_complete();
        self.complete_value()
    }

    fn expected(&self) -> Expected {
        let Some(frame) = self.stack.last() else {
            return match self.root {
                RootState::Value => Expected::RootValue,
                RootState::AfterValue => Expected::RootAfterValue,
            };
        };

        match frame {
            Frame::Object { state, .. } => match state {
                ObjectState::FirstKeyOrEnd => Expected::ObjectKeyOrEnd,
                ObjectState::KeyAfterComma => Expected::ObjectKey,
                ObjectState::Colon => Expected::ObjectColon,
                ObjectState::Value => Expected::ObjectValue,
                ObjectState::CommaOrEnd => Expected::ObjectCommaOrEnd,
            },
            Frame::Array { state, .. } => match state {
                ArrayState::FirstValueOrEnd => Expected::ArrayValueOrEnd,
                ArrayState::ValueAfterComma => Expected::ArrayValue,
                ArrayState::CommaOrEnd => Expected::ArrayCommaOrEnd,
            },
        }
    }

    /// Checks that the next value has a path: the current key of every
    /// object frame and the next index of every array frame, root first.
    fn check_value_slot(&self) -> Result<(), StreamError> {
        let Some(frame) = self.stack.last() else {
            return if self.root == RootState::Value {
                Ok(())
            } else {
                Err(StreamError::TrailingData {
                    offset: self.bytes_seen.saturating_sub(1),
                })
            };
        };

        match frame {
            Frame::Object {
                state: ObjectState::Value,
                key: Some(_),
            }
            | Frame::Array {
                state: ArrayState::FirstValueOrEnd | ArrayState::ValueAfterComma,
                ..
            } => Ok(()),
            _ => Err(StreamError::InvalidJson {
                offset: self.bytes_seen.saturating_sub(1),
            }),
        }
    }

    fn flush_partial(&mut self, chunk_length: usize) -> Result<(), StreamError> {
        let offset = self.bytes_seen.saturating_sub(chunk_length);
        match std::mem::replace(&mut self.token, Token::None) {
            Token::String(mut string) => {
                let flushed = string.flush_chunk(offset);
                if flushed.is_ok() && string.role == StringRole::Value && !string.delta.is_empty() {
                    self.emit_string_append(&string.delta);
                    string.delta.clear();
                }
                self.token = Token::String(string);
                flushed?;
            }
            Token::Number(mut number) => {
                if number.raw == b"-" {
                    self.emit_path_patch(PATCH_INVALIDATE);
                }
                if number.valid_length != 0 && number.valid_length != number.emitted_length {
                    self.emit_path_patch(PATCH_SET_NUMBER);
                    let length_offset = self.output.len();
                    write_u32(&mut self.output, 0);
                    number.write_partial_value(&mut self.output);
                    let length = self.output.len() - length_offset - 4;
                    let length = u32::try_from(length).unwrap_or(u32::MAX);
                    self.output[length_offset..length_offset + 4]
                        .copy_from_slice(&length.to_le_bytes());
                    number.emitted_length = number.valid_length;
                }
                self.token = Token::Number(number);
            }
            token => self.token = token,
        }
        Ok(())
    }

    fn emit_number_if_changed(&mut self, number: &NumberToken) {
        if number.raw.len() != number.emitted_length {
            self.emit_number(&number.raw);
        }
    }

    /// Writes an operation and the current value path. The path starts with
    /// the number of segments shared with the previous encoded path, then its
    /// length, then only the segments after the shared prefix. A key's text is
    /// therefore written once per key, not once per patch below it.
    fn emit_path_patch(&mut self, operation: u8) {
        self.output.push(operation);
        let clamp = |value: usize| u16::try_from(value).unwrap_or(u16::MAX);
        let length = clamp(self.stack.len());
        let shared = clamp(self.shared_path).min(length);
        self.output.extend_from_slice(&shared.to_le_bytes());
        self.output.extend_from_slice(&length.to_le_bytes());
        for frame in &self.stack[usize::from(shared)..usize::from(length)] {
            match frame {
                Frame::Object { key, .. } => {
                    let units = key.as_deref().unwrap_or_default();
                    self.output.push(0);
                    write_u32(&mut self.output, units.len());
                    for &unit in units {
                        self.output.extend_from_slice(&unit.to_le_bytes());
                    }
                }
                Frame::Array { next_index, .. } => {
                    self.output.push(1);
                    self.output.extend_from_slice(&next_index.to_le_bytes());
                }
            }
        }
        self.shared_path = usize::from(length);
    }

    fn emit_string_append(&mut self, units: &[u16]) {
        self.emit_path_patch(PATCH_APPEND_STRING);
        // Reserving exactly, plus room for the completion patch that often
        // follows, keeps a long string from doubling the buffer past its size.
        self.output
            .reserve_exact(4 + units.len() * 2 + COMPLETE_PATCH_BYTES);
        write_u32(&mut self.output, units.len());
        for &unit in units {
            self.output.extend_from_slice(&unit.to_le_bytes());
        }
    }

    fn emit_number(&mut self, number: &[u8]) {
        self.emit_path_patch(PATCH_SET_NUMBER);
        write_u32(&mut self.output, number.len());
        self.output.extend_from_slice(number);
    }

    fn emit_complete(&mut self) {
        self.emit_path_patch(PATCH_COMPLETE);
    }
}

#[derive(Debug, Default)]
pub struct StructuredJsonParser {
    scanner: JsonStreamParser,
    values: PartialValueParser,
}

impl StructuredJsonParser {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_limits(max_depth: usize, max_bytes: usize) -> Self {
        Self {
            scanner: JsonStreamParser::with_limits(max_depth, max_bytes),
            values: PartialValueParser::new(),
        }
    }

    pub fn push(&mut self, chunk: &[u8]) -> Result<StreamState, StreamError> {
        let state = self.scanner.push(chunk)?;
        self.values.push(chunk)?;
        Ok(state)
    }

    /// Validates the whole chunk, then builds patches until `patch_limit`
    /// bytes are pending. A returned index means more patches remain; read
    /// these, then call `resume` with the same chunk and that index.
    pub fn push_bounded(
        &mut self,
        chunk: &[u8],
        patch_limit: usize,
    ) -> Result<Option<usize>, StreamError> {
        self.scanner.push(chunk)?;
        self.values.push_from(chunk, 0, patch_limit)
    }

    pub fn resume(
        &mut self,
        chunk: &[u8],
        start: usize,
        patch_limit: usize,
    ) -> Result<Option<usize>, StreamError> {
        self.values.push_from(chunk, start, patch_limit)
    }

    pub fn finish(&mut self) -> Result<StreamState, StreamError> {
        let state = self.scanner.finish()?;
        self.values.finish()?;
        Ok(state)
    }

    pub fn state(&self) -> StreamState {
        self.scanner.state()
    }

    pub fn patch_bytes(&self) -> &[u8] {
        self.values.patch_bytes()
    }
}

fn write_u32(output: &mut Vec<u8>, value: usize) {
    let value = u32::try_from(value).unwrap_or(u32::MAX);
    output.extend_from_slice(&value.to_le_bytes());
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn is_number_byte(byte: u8) -> bool {
    matches!(byte, b'0'..=b'9' | b'-' | b'+' | b'.' | b'e' | b'E')
}

fn write_i64(output: &mut Vec<u8>, value: i64) {
    if value < 0 {
        output.push(b'-');
    }
    let mut digits = [0; 20];
    let mut remaining = value.unsigned_abs();
    let mut start = digits.len();
    loop {
        start -= 1;
        digits[start] = b'0' + (remaining % 10) as u8;
        remaining /= 10;
        if remaining == 0 {
            break;
        }
    }
    output.extend_from_slice(&digits[start..]);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The previous whole-prefix scan, kept as an oracle for the
    /// incremental number state.
    fn longest_valid_number_prefix(input: &[u8]) -> Option<&[u8]> {
        let mut index = 0;
        if input.get(index) == Some(&b'-') {
            index += 1;
        }

        match input.get(index) {
            Some(b'0') => index += 1,
            Some(b'1'..=b'9') => {
                index += 1;
                while input.get(index).is_some_and(u8::is_ascii_digit) {
                    index += 1;
                }
            }
            _ => return None,
        }

        let integer_end = index;
        if input.get(index) == Some(&b'.') {
            index += 1;
            let start = index;
            while input.get(index).is_some_and(u8::is_ascii_digit) {
                index += 1;
            }
            if index == start {
                return Some(&input[..integer_end]);
            }
        }

        let mantissa_end = index;
        if matches!(input.get(index), Some(b'e' | b'E')) {
            index += 1;
            if matches!(input.get(index), Some(b'+' | b'-')) {
                index += 1;
            }
            let start = index;
            while input.get(index).is_some_and(u8::is_ascii_digit) {
                index += 1;
            }
            if index == start {
                return Some(&input[..mantissa_end]);
            }
        }

        Some(&input[..index])
    }

    fn number_value(text: &[u8]) -> f64 {
        std::str::from_utf8(text).unwrap().parse().unwrap()
    }

    fn partial_number_text(number: &NumberToken) -> Vec<u8> {
        let mut text = Vec::new();
        number.write_partial_value(&mut text);
        text
    }

    fn assert_number_prefixes(input: &[u8]) {
        let mut number = NumberToken::new(input[0]);
        for length in 1..=input.len() {
            if length > 1 {
                number.push(input[length - 1]);
            }
            let raw = &input[..length];
            let prefix = longest_valid_number_prefix(raw);
            assert_eq!(
                number.valid_length,
                prefix.map_or(0, <[u8]>::len),
                "prefix {:?}",
                String::from_utf8_lossy(raw)
            );
            assert_eq!(
                number.is_valid(),
                prefix.is_some_and(|prefix| prefix.len() == raw.len())
            );
            if let Some(prefix) = prefix {
                let partial = partial_number_text(&number);
                assert_eq!(
                    number_value(&partial).to_bits(),
                    number_value(prefix).to_bits(),
                    "prefix {:?} as {:?}",
                    String::from_utf8_lossy(prefix),
                    String::from_utf8_lossy(&partial)
                );
            }
        }
    }

    #[test]
    fn incremental_number_state_matches_the_prefix_scan() {
        const BYTES: &[u8] = b"019-+.eE";
        let mut inputs: Vec<Vec<u8>> = b"-019".iter().map(|&byte| vec![byte]).collect();
        while let Some(input) = inputs.pop() {
            assert_number_prefixes(&input);
            if input.len() < 7 {
                inputs.extend(
                    BYTES
                        .iter()
                        .map(|&byte| [input.as_slice(), &[byte]].concat()),
                );
            }
        }
    }

    #[test]
    fn long_number_patches_round_like_the_full_prefix() {
        let midpoint = b"9007199254740993";
        let long = |parts: &[&[u8]]| parts.concat();
        for input in [
            long(&[b"1", &[b'0'; 2000]]),
            long(&[b"-0.", &[b'0'; 2000], b"7e-5"]),
            long(&[b"0.", &[b'1'; 2000], b"e+12"]),
            long(&[b"1", &[b'0'; 900], b"e-900"]),
            long(&[midpoint, &[b'0'; 1200]]),
            long(&[midpoint, &[b'0'; 1200], b"1"]),
            long(&[midpoint, &[b'0'; 784], b"1"]),
            long(&[midpoint, &[b'0'; 785], b"1e-801"]),
            long(&[b"1.7976931348623158", &[b'0'; 1000], b"1e308"]),
            long(&[b"2.4703282292062327", &[b'0'; 1000], b"1e-324"]),
            long(&[b"1e", &[b'0'; 1000], b"9999999999999999999999"]),
            long(&[b"1e-", &[b'9'; 1000]]),
            long(&[b"0.", &[b'0'; 1000], b"e", &[b'9'; 1000]]),
        ] {
            assert_number_prefixes(&input);
        }
    }

    #[test]
    fn long_number_patches_stay_bounded_per_chunk() {
        for (head, body, chunk_size) in [
            (b"{\"n\":1".as_slice(), b'0', 16),
            (b"{\"n\":0.", b'1', 16),
            (b"{\"price\":0.", b'0', 3),
            (b"{\"n\":1e", b'0', 16),
        ] {
            let mut input = head.to_vec();
            input.resize(head.len() + 100_000, body);
            let mut parser = PartialValueParser::new();
            let mut patches = 0;
            for chunk in input.chunks(chunk_size) {
                parser.push(chunk).unwrap();
                let length = parser.patch_bytes().len();
                assert!(
                    length <= 1024,
                    "{length} patch bytes after {} input bytes",
                    parser.bytes_seen
                );
                patches += usize::from(length > 0);
            }
            assert!(patches > 1);
        }
    }

    #[test]
    fn bounded_batches_concatenate_to_the_whole_push() {
        let documents: [&[u8]; 7] = [
            br#"{"name":"stream","items":[1,true,null,{"ok":false}],"n":-12.5e+2}"#,
            "{\"k\u{e9}y\":[\"a\\n\\u0041\u{e9}\u{1F680}\",0.125,[[],{}]],\"tail\":\"x".as_bytes(),
            b"[1,22,333,4444,55555,-0,1e400",
            br#"{"a":{"b":{"c":[false,null,true,"deep"]}},"d":"#,
            b"\"unterminated value\\",
            b"123",
            br#"[1,{"a":"ok","b":tx]"#,
        ];
        for document in documents {
            for split in 0..=document.len() {
                let (first, second) = document.split_at(split);
                let mut whole = StructuredJsonParser::new();
                let mut batched = StructuredJsonParser::new();
                for chunk in [first, second] {
                    let expected = whole.push(chunk).map(|_| whole.patch_bytes().to_vec());
                    let mut actual = Vec::new();
                    let mut step = batched.push_bounded(chunk, 1);
                    while let Ok(Some(index)) = step {
                        assert!(!batched.patch_bytes().is_empty());
                        actual.extend_from_slice(batched.patch_bytes());
                        step = batched.resume(chunk, index, 1);
                    }
                    let actual = step.map(|_| {
                        actual.extend_from_slice(batched.patch_bytes());
                        actual
                    });
                    assert_eq!(actual, expected, "{document:?} split at {split}");
                    assert_eq!(batched.state(), whole.state());
                }
            }
        }
    }

    #[test]
    fn accepts_nested_values_one_byte_at_a_time() {
        let input = br#"{"name":"stream","items":[1,true,null,{"ok":false}]}"#;
        let mut parser = StructuredJsonParser::new();
        let mut emitted_patch = false;
        for byte in input {
            parser.push(std::slice::from_ref(byte)).unwrap();
            emitted_patch |= !parser.patch_bytes().is_empty();
        }
        assert!(parser.state().complete);
        assert!(emitted_patch);
    }

    #[test]
    fn emits_utf16_for_keys_and_values_across_utf8_boundaries() {
        let mut parser = StructuredJsonParser::new();
        // No shared segments, then one key segment with the UTF-16 units for "aé".
        let first: &[u8] = &[0, 0, 1, 0, 0, 2, 0, 0, 0, 97, 0, 233, 0];
        // The same path again, fully shared with the previous one.
        let path: &[u8] = &[1, 0, 1, 0];

        parser.push(b"{\"a\xc3").unwrap();
        assert_eq!(parser.patch_bytes(), &[PATCH_SET_OBJECT, 0, 0, 0, 0]);

        parser.push(b"\xa9\":\"x\xf0\x9f").unwrap();
        assert_eq!(
            parser.patch_bytes(),
            [
                &[PATCH_SET_STRING][..],
                first,
                &[PATCH_APPEND_STRING],
                path,
                &[1, 0, 0, 0, 120, 0],
            ]
            .concat()
        );

        parser.push(b"\xa6").unwrap();
        assert!(parser.patch_bytes().is_empty());

        parser.push(b"\x80\xc3\xa9").unwrap();
        assert_eq!(
            parser.patch_bytes(),
            [
                &[PATCH_APPEND_STRING][..],
                path,
                &[3, 0, 0, 0, 0x3e, 0xd8, 0x80, 0xdd, 233, 0],
            ]
            .concat()
        );

        parser.push(b"\\nZ\"}").unwrap();
        assert_eq!(
            parser.patch_bytes(),
            [
                &[PATCH_APPEND_STRING][..],
                path,
                &[2, 0, 0, 0, 10, 0, 90, 0, PATCH_COMPLETE],
                path,
                &[PATCH_COMPLETE, 0, 0, 0, 0],
            ]
            .concat()
        );
        assert!(parser.finish().unwrap().complete);
    }

    #[test]
    fn rejects_invalid_utf8_in_keys_and_values_at_every_split() {
        for prefix in [b"{\"ok".as_slice(), b"[\"ok"] {
            for invalid in [
                b"\xff\"".as_slice(),
                b"\xc0\xaf\"",
                b"\xf0\x28\x8c\xbc\"",
                b"\xc3\"",
                b"\xf0\x9f\\n",
            ] {
                let input = [prefix, invalid].concat();
                for split in 0..=input.len() {
                    let mut parser = StructuredJsonParser::new();
                    let result = parser
                        .push(&input[..split])
                        .and_then(|_| parser.push(&input[split..]));
                    assert!(
                        matches!(result, Err(StreamError::InvalidJson { .. })),
                        "input {input:?}, split {split}: {result:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn writes_each_key_once_however_many_patches_share_it() {
        let key = "k".repeat(1000);
        let input = format!(r#"{{"{key}":[0,0,0,[[1]]]}}"#);
        let mut parser = StructuredJsonParser::new();
        parser.push(input.as_bytes()).unwrap();
        let encoded: Vec<u8> = key.encode_utf16().flat_map(u16::to_le_bytes).collect();
        let output = parser.patch_bytes();
        let copies = output
            .windows(encoded.len())
            .filter(|window| *window == encoded.as_slice())
            .count();
        assert_eq!(copies, 1);
        assert!(output.len() < encoded.len() + 256, "{} bytes", output.len());
    }

    #[test]
    fn rejects_trailing_commas() {
        let mut parser = StructuredJsonParser::new();
        assert!(matches!(
            parser.push(br#"{"value":1,}"#),
            Err(StreamError::InvalidJson { .. })
        ));
    }

    #[test]
    fn validates_numbers_on_finish() {
        let mut valid = StructuredJsonParser::new();
        valid.push(b"-12.5e+2").unwrap();
        valid.finish().unwrap();

        let mut invalid = StructuredJsonParser::new();
        invalid.push(b"1.").unwrap();
        assert!(matches!(
            invalid.finish(),
            Err(StreamError::InvalidJson { .. })
        ));
    }

    #[test]
    fn emits_completion_for_literal_values() {
        let mut parser = PartialValueParser::new();
        parser.push(b"t").unwrap();
        assert_eq!(
            parser.patch_bytes(),
            &[PATCH_SET_TRUE, 0, 0, 0, 0, PATCH_COMPLETE, 0, 0, 0, 0]
        );
    }
}
