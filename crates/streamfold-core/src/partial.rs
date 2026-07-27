use crate::{JsonStreamParser, StreamError, StreamState};

const PATCH_SET_OBJECT: u8 = 0;
const PATCH_SET_ARRAY: u8 = 1;
const PATCH_SET_STRING: u8 = 2;
const PATCH_APPEND_STRING: u8 = 3;
const PATCH_SET_NUMBER: u8 = 4;
const PATCH_SET_TRUE: u8 = 5;
const PATCH_SET_FALSE: u8 = 6;
const PATCH_SET_NULL: u8 = 7;

#[derive(Debug, Clone, PartialEq, Eq)]
enum PathSegment {
    Key(Vec<u16>),
    Index(u32),
}

type Path = Vec<PathSegment>;

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
        path: Path,
        state: ObjectState,
        key: Option<Vec<u16>>,
    },
    Array {
        path: Path,
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

#[derive(Debug)]
enum StringRole {
    Key,
    Value(Path),
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

        match std::str::from_utf8(&self.raw_utf8) {
            Ok(text) => {
                let units: Vec<u16> = text.encode_utf16().collect();
                self.push_units(&units);
                self.raw_utf8.clear();
                Ok(())
            }
            Err(error) => {
                let valid = error.valid_up_to();
                if valid > 0 {
                    let units: Vec<u16> = std::str::from_utf8(&self.raw_utf8[..valid])
                        .expect("valid UTF-8 prefix")
                        .encode_utf16()
                        .collect();
                    self.push_units(&units);
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
            StringRole::Value(_) => self.delta.extend_from_slice(units),
        }
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

#[derive(Debug)]
struct NumberToken {
    path: Path,
    raw: Vec<u8>,
    emitted: Vec<u8>,
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
}

impl Default for PartialValueParser {
    fn default() -> Self {
        Self {
            root: RootState::Value,
            stack: Vec::new(),
            token: Token::None,
            bytes_seen: 0,
            output: Vec::new(),
        }
    }
}

impl PartialValueParser {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, chunk: &[u8]) -> Result<(), StreamError> {
        self.output.clear();
        for &byte in chunk {
            let offset = self.bytes_seen;
            self.bytes_seen += 1;
            self.consume(byte, offset)?;
        }
        self.flush_partial(chunk.len())?;
        Ok(())
    }

    pub fn finish(&mut self) -> Result<(), StreamError> {
        self.output.clear();
        match std::mem::replace(&mut self.token, Token::None) {
            Token::None => {}
            Token::Number(number) => {
                if !valid_json_number(&number.raw) {
                    self.token = Token::Number(number);
                    return Err(StreamError::InvalidJson {
                        offset: self.bytes_seen,
                    });
                }
                self.emit_number_if_changed(&number);
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
        Ok(())
    }

    pub fn patch_bytes(&self) -> &[u8] {
        &self.output
    }

    fn consume(&mut self, byte: u8, offset: usize) -> Result<(), StreamError> {
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
            Token::Number(mut number) => {
                if is_number_byte(byte) {
                    number.raw.push(byte);
                    self.token = Token::Number(number);
                    Ok(())
                } else {
                    if !valid_json_number(&number.raw) {
                        self.token = Token::Number(number);
                        return Err(StreamError::InvalidJson { offset });
                    }
                    self.emit_number_if_changed(&number);
                    self.complete_value()?;
                    self.consume_structural(byte, offset)
                }
            }
        }
    }

    fn consume_structural(&mut self, byte: u8, offset: usize) -> Result<(), StreamError> {
        if byte.is_ascii_whitespace() {
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
        let path = self.value_path()?;
        match byte {
            b'{' => {
                self.emit_path_patch(PATCH_SET_OBJECT, &path);
                self.stack.push(Frame::Object {
                    path,
                    state: ObjectState::FirstKeyOrEnd,
                    key: None,
                });
            }
            b'[' => {
                self.emit_path_patch(PATCH_SET_ARRAY, &path);
                self.stack.push(Frame::Array {
                    path,
                    state: ArrayState::FirstValueOrEnd,
                    next_index: 0,
                });
            }
            b'"' => {
                self.emit_path_patch(PATCH_SET_STRING, &path);
                self.token = Token::String(StringToken::new(StringRole::Value(path)));
            }
            b't' => self.start_literal(path, LiteralKind::True),
            b'f' => self.start_literal(path, LiteralKind::False),
            b'n' => self.start_literal(path, LiteralKind::Null),
            b'-' | b'0'..=b'9' => {
                self.token = Token::Number(NumberToken {
                    path,
                    raw: vec![byte],
                    emitted: Vec::new(),
                });
            }
            _ => return Err(StreamError::InvalidJson { offset }),
        }
        Ok(())
    }

    fn start_literal(&mut self, path: Path, kind: LiteralKind) {
        self.emit_path_patch(kind.patch(), &path);
        self.token = Token::Literal(LiteralToken { kind, matched: 1 });
    }

    fn complete_string(&mut self, mut string: StringToken) -> Result<(), StreamError> {
        match string.role {
            StringRole::Key => {
                let Some(Frame::Object { state, key, .. }) = self.stack.last_mut() else {
                    unreachable!();
                };
                *key = Some(string.units);
                *state = ObjectState::Colon;
                Ok(())
            }
            StringRole::Value(path) => {
                if !string.delta.is_empty() {
                    self.emit_string_append(&path, &string.delta);
                    string.delta.clear();
                }
                self.complete_value()
            }
        }
    }

    fn complete_value(&mut self) -> Result<(), StreamError> {
        let Some(frame) = self.stack.last_mut() else {
            self.root = RootState::AfterValue;
            return Ok(());
        };

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
        self.stack.pop();
        self.complete_value()
    }

    fn close_array(&mut self, offset: usize) -> Result<(), StreamError> {
        let Some(Frame::Array { state, .. }) = self.stack.last() else {
            return Err(StreamError::InvalidJson { offset });
        };
        if !matches!(state, ArrayState::FirstValueOrEnd | ArrayState::CommaOrEnd) {
            return Err(StreamError::InvalidJson { offset });
        }
        self.stack.pop();
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

    fn value_path(&self) -> Result<Path, StreamError> {
        let Some(frame) = self.stack.last() else {
            return if self.root == RootState::Value {
                Ok(Vec::new())
            } else {
                Err(StreamError::TrailingData {
                    offset: self.bytes_seen.saturating_sub(1),
                })
            };
        };

        match frame {
            Frame::Object {
                path, state, key, ..
            } if *state == ObjectState::Value => {
                let Some(key) = key else {
                    return Err(StreamError::InvalidJson {
                        offset: self.bytes_seen.saturating_sub(1),
                    });
                };
                let mut result = path.clone();
                result.push(PathSegment::Key(key.clone()));
                Ok(result)
            }
            Frame::Array {
                path,
                state: ArrayState::FirstValueOrEnd | ArrayState::ValueAfterComma,
                next_index,
            } => {
                let mut result = path.clone();
                result.push(PathSegment::Index(*next_index));
                Ok(result)
            }
            _ => Err(StreamError::InvalidJson {
                offset: self.bytes_seen.saturating_sub(1),
            }),
        }
    }

    fn flush_partial(&mut self, chunk_length: usize) -> Result<(), StreamError> {
        let offset = self.bytes_seen.saturating_sub(chunk_length);
        let append = if let Token::String(string) = &mut self.token {
            string.flush_chunk(offset)?;
            match &string.role {
                StringRole::Value(path) if !string.delta.is_empty() => {
                    Some((path.clone(), std::mem::take(&mut string.delta)))
                }
                _ => None,
            }
        } else {
            None
        };
        if let Some((path, delta)) = append {
            self.emit_string_append(&path, &delta);
        }

        let number = if let Token::Number(number) = &self.token {
            longest_valid_number_prefix(&number.raw)
                .map(|prefix| (number.path.clone(), prefix.to_vec(), number.emitted.clone()))
        } else {
            None
        };
        if let Some((path, prefix, emitted)) = number
            && prefix != emitted
        {
            self.emit_number(&path, &prefix);
            if let Token::Number(number) = &mut self.token {
                number.emitted = prefix;
            }
        }
        Ok(())
    }

    fn emit_number_if_changed(&mut self, number: &NumberToken) {
        if number.raw != number.emitted {
            self.emit_number(&number.path, &number.raw);
        }
    }

    fn emit_path_patch(&mut self, operation: u8, path: &[PathSegment]) {
        self.output.push(operation);
        encode_path(&mut self.output, path);
    }

    fn emit_string_append(&mut self, path: &[PathSegment], units: &[u16]) {
        self.emit_path_patch(PATCH_APPEND_STRING, path);
        write_u32(&mut self.output, units.len());
        for &unit in units {
            self.output.extend_from_slice(&unit.to_le_bytes());
        }
    }

    fn emit_number(&mut self, path: &[PathSegment], number: &[u8]) {
        self.emit_path_patch(PATCH_SET_NUMBER, path);
        write_u32(&mut self.output, number.len());
        self.output.extend_from_slice(number);
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

    pub fn push(&mut self, chunk: &[u8]) -> Result<StreamState, StreamError> {
        let state = self.scanner.push(chunk)?;
        self.values.push(chunk)?;
        Ok(state)
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

fn encode_path(output: &mut Vec<u8>, path: &[PathSegment]) {
    let length = u16::try_from(path.len()).unwrap_or(u16::MAX);
    output.extend_from_slice(&length.to_le_bytes());
    for segment in path.iter().take(usize::from(length)) {
        match segment {
            PathSegment::Key(units) => {
                output.push(0);
                write_u32(output, units.len());
                for &unit in units {
                    output.extend_from_slice(&unit.to_le_bytes());
                }
            }
            PathSegment::Index(index) => {
                output.push(1);
                output.extend_from_slice(&index.to_le_bytes());
            }
        }
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

fn longest_valid_number_prefix(input: &[u8]) -> Option<&[u8]> {
    (1..=input.len())
        .rev()
        .map(|length| &input[..length])
        .find(|prefix| valid_json_number(prefix))
}

fn valid_json_number(input: &[u8]) -> bool {
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
        _ => return false,
    }

    if input.get(index) == Some(&b'.') {
        index += 1;
        let start = index;
        while input.get(index).is_some_and(u8::is_ascii_digit) {
            index += 1;
        }
        if index == start {
            return false;
        }
    }

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
            return false;
        }
    }

    index == input.len()
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
