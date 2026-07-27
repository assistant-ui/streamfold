mod partial;
#[cfg(target_arch = "wasm32")]
mod wasm;

pub use partial::{PartialValueParser, StructuredJsonParser};

pub const DEFAULT_MAX_BYTES: usize = 16 * 1024 * 1024;
pub const DEFAULT_MAX_DEPTH: usize = 128;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Container {
    Object,
    Array,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StreamError {
    UnexpectedClosing { offset: usize, byte: u8 },
    MismatchedClosing { offset: usize, byte: u8 },
    TrailingData { offset: usize },
    EmptyInput,
    Incomplete { offset: usize },
    InvalidJson { offset: usize },
    MaxBytesExceeded { offset: usize, limit: usize },
    MaxDepthExceeded { offset: usize, limit: usize },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StreamState {
    pub bytes_seen: usize,
    pub depth: usize,
    pub complete: bool,
    pub in_string: bool,
}

#[derive(Debug)]
pub struct JsonStreamParser {
    stack: Vec<Container>,
    bytes_seen: usize,
    started: bool,
    complete: bool,
    in_string: bool,
    escaped: bool,
    primitive: bool,
    max_bytes: usize,
    max_depth: usize,
}

impl Default for JsonStreamParser {
    fn default() -> Self {
        Self {
            stack: Vec::new(),
            bytes_seen: 0,
            started: false,
            complete: false,
            in_string: false,
            escaped: false,
            primitive: false,
            max_bytes: DEFAULT_MAX_BYTES,
            max_depth: DEFAULT_MAX_DEPTH,
        }
    }
}

impl JsonStreamParser {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_limits(max_depth: usize, max_bytes: usize) -> Self {
        Self {
            max_bytes,
            max_depth,
            ..Self::default()
        }
    }

    pub fn push(&mut self, chunk: &[u8]) -> Result<StreamState, StreamError> {
        if chunk.len() > self.max_bytes.saturating_sub(self.bytes_seen) {
            return Err(StreamError::MaxBytesExceeded {
                offset: self.bytes_seen,
                limit: self.max_bytes,
            });
        }

        for &byte in chunk {
            let offset = self.bytes_seen;
            self.bytes_seen += 1;

            if self.complete {
                if !byte.is_ascii_whitespace() {
                    return Err(StreamError::TrailingData { offset });
                }
                continue;
            }

            if self.in_string {
                if self.escaped {
                    self.escaped = false;
                } else if byte == b'\\' {
                    self.escaped = true;
                } else if byte == b'"' {
                    self.in_string = false;
                    if self.stack.is_empty() {
                        self.complete = true;
                    }
                }
                continue;
            }

            match byte {
                b' ' | b'\n' | b'\r' | b'\t' => {}
                b'"' => {
                    self.started = true;
                    self.in_string = true;
                }
                b'{' => {
                    self.started = true;
                    self.check_depth(offset)?;
                    self.stack.push(Container::Object);
                }
                b'[' => {
                    self.started = true;
                    self.check_depth(offset)?;
                    self.stack.push(Container::Array);
                }
                b'}' => self.close(Container::Object, offset, byte)?,
                b']' => self.close(Container::Array, offset, byte)?,
                b',' | b':' => {
                    if self.stack.is_empty() {
                        return Err(StreamError::UnexpectedClosing { offset, byte });
                    }
                    self.primitive = false;
                }
                _ => {
                    self.started = true;
                    self.primitive = true;
                }
            }
        }

        if self.started
            && self.stack.is_empty()
            && !self.in_string
            && self.primitive
            && chunk.last().is_some_and(|b| b.is_ascii_whitespace())
        {
            self.complete = true;
        }

        Ok(self.state())
    }

    pub fn finish(&mut self) -> Result<StreamState, StreamError> {
        if !self.started {
            return Err(StreamError::EmptyInput);
        }
        if self.in_string || !self.stack.is_empty() {
            return Err(StreamError::Incomplete {
                offset: self.bytes_seen,
            });
        }
        if self.primitive {
            self.complete = true;
        }
        Ok(self.state())
    }

    pub fn state(&self) -> StreamState {
        StreamState {
            bytes_seen: self.bytes_seen,
            depth: self.stack.len(),
            complete: self.complete,
            in_string: self.in_string,
        }
    }

    fn close(&mut self, expected: Container, offset: usize, byte: u8) -> Result<(), StreamError> {
        let Some(actual) = self.stack.pop() else {
            return Err(StreamError::UnexpectedClosing { offset, byte });
        };
        if actual != expected {
            return Err(StreamError::MismatchedClosing { offset, byte });
        }
        self.primitive = false;
        if self.stack.is_empty() {
            self.complete = true;
        }
        Ok(())
    }

    fn check_depth(&self, offset: usize) -> Result<(), StreamError> {
        if self.stack.len() >= self.max_depth {
            return Err(StreamError::MaxDepthExceeded {
                offset,
                limit: self.max_depth,
            });
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_one_byte_at_a_time() {
        let input = br#"{"query":"a \"quoted\" value","items":[1,true,null,{"ok":false}]}"#;
        let mut parser = JsonStreamParser::new();
        for byte in input {
            parser.push(std::slice::from_ref(byte)).unwrap();
        }
        assert!(parser.state().complete);
        assert_eq!(parser.state().bytes_seen, input.len());
    }

    #[test]
    fn tracks_partial_state() {
        let mut parser = JsonStreamParser::new();
        let state = parser.push(br#"{"items":[{"name":"hel"#).unwrap();
        assert_eq!(state.depth, 3);
        assert!(state.in_string);
        assert!(!state.complete);
    }

    #[test]
    fn rejects_mismatched_delimiters() {
        let mut parser = JsonStreamParser::new();
        assert!(matches!(
            parser.push(br#"{"x"]"#),
            Err(StreamError::MismatchedClosing { .. })
        ));
    }

    #[test]
    fn finishes_primitives_and_rejects_incomplete_input() {
        let mut primitive = JsonStreamParser::new();
        primitive.push(b"42").unwrap();
        assert!(primitive.finish().unwrap().complete);

        let mut incomplete = JsonStreamParser::new();
        incomplete.push(br#"{"value":"partial"#).unwrap();
        assert!(matches!(
            incomplete.finish(),
            Err(StreamError::Incomplete { .. })
        ));
    }

    #[test]
    fn enforces_byte_and_depth_limits() {
        let mut bytes = JsonStreamParser::with_limits(8, 4);
        assert!(matches!(
            bytes.push(b"12345"),
            Err(StreamError::MaxBytesExceeded {
                offset: 0,
                limit: 4
            })
        ));

        let mut depth = JsonStreamParser::with_limits(2, 1024);
        assert!(matches!(
            depth.push(br#"{"x":[["#),
            Err(StreamError::MaxDepthExceeded {
                offset: 6,
                limit: 2
            })
        ));
    }
}
