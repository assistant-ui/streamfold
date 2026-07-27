use crate::{StreamError, StreamState, StructuredJsonParser};

const DEPTH_MASK: u32 = 0x00ff_ffff;
const COMPLETE_FLAG: u32 = 1 << 24;
const IN_STRING_FLAG: u32 = 1 << 25;
const ERROR_SHIFT: u32 = 28;

struct WasmParser {
    parser: StructuredJsonParser,
    input: Vec<u8>,
    error_offset: usize,
    error_byte: u8,
}

impl WasmParser {
    fn new(max_depth: usize, max_bytes: usize) -> Self {
        Self {
            parser: StructuredJsonParser::with_limits(max_depth, max_bytes),
            input: Vec::new(),
            error_offset: 0,
            error_byte: 0,
        }
    }

    fn encode(&mut self, result: Result<StreamState, StreamError>) -> u32 {
        match result {
            Ok(state) => encode_state(state),
            Err(error) => {
                let code = match error {
                    StreamError::UnexpectedClosing { offset, byte } => {
                        self.error_offset = offset;
                        self.error_byte = byte;
                        1
                    }
                    StreamError::MismatchedClosing { offset, byte } => {
                        self.error_offset = offset;
                        self.error_byte = byte;
                        2
                    }
                    StreamError::TrailingData { offset } => {
                        self.error_offset = offset;
                        3
                    }
                    StreamError::EmptyInput => {
                        self.error_offset = 0;
                        4
                    }
                    StreamError::Incomplete { offset } => {
                        self.error_offset = offset;
                        5
                    }
                    StreamError::InvalidJson { offset } => {
                        self.error_offset = offset;
                        6
                    }
                    StreamError::MaxBytesExceeded { offset, .. } => {
                        self.error_offset = offset;
                        7
                    }
                    StreamError::MaxDepthExceeded { offset, .. } => {
                        self.error_offset = offset;
                        8
                    }
                };
                encode_state(self.parser.state()) | (code << ERROR_SHIFT)
            }
        }
    }
}

fn encode_state(state: StreamState) -> u32 {
    let depth = u32::try_from(state.depth).unwrap_or(u32::MAX) & DEPTH_MASK;
    depth
        | if state.complete { COMPLETE_FLAG } else { 0 }
        | if state.in_string { IN_STRING_FLAG } else { 0 }
}

fn parser_mut(handle: usize) -> &'static mut WasmParser {
    assert_ne!(handle, 0);
    unsafe { &mut *(handle as *mut WasmParser) }
}

#[unsafe(no_mangle)]
pub extern "C" fn streamfold_parser_new(max_depth: usize, max_bytes: usize) -> usize {
    Box::into_raw(Box::new(WasmParser::new(max_depth, max_bytes))) as usize
}

#[unsafe(no_mangle)]
pub extern "C" fn streamfold_parser_free(handle: usize) {
    if handle != 0 {
        unsafe {
            drop(Box::from_raw(handle as *mut WasmParser));
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn streamfold_parser_input(handle: usize, capacity: usize) -> usize {
    let parser = parser_mut(handle);
    parser.input.resize(capacity, 0);
    parser.input.as_mut_ptr() as usize
}

#[unsafe(no_mangle)]
pub extern "C" fn streamfold_parser_push(handle: usize, length: usize) -> u32 {
    let parser = parser_mut(handle);
    assert!(length <= parser.input.len());
    let result = parser.parser.push(&parser.input[..length]);
    parser.encode(result)
}

#[unsafe(no_mangle)]
pub extern "C" fn streamfold_parser_finish(handle: usize) -> u32 {
    let parser = parser_mut(handle);
    let result = parser.parser.finish();
    parser.encode(result)
}

#[unsafe(no_mangle)]
pub extern "C" fn streamfold_parser_state(handle: usize) -> u32 {
    encode_state(parser_mut(handle).parser.state())
}

#[unsafe(no_mangle)]
pub extern "C" fn streamfold_parser_bytes_seen(handle: usize) -> usize {
    parser_mut(handle).parser.state().bytes_seen
}

#[unsafe(no_mangle)]
pub extern "C" fn streamfold_parser_error_offset(handle: usize) -> usize {
    parser_mut(handle).error_offset
}

#[unsafe(no_mangle)]
pub extern "C" fn streamfold_parser_error_byte(handle: usize) -> u32 {
    parser_mut(handle).error_byte.into()
}

#[unsafe(no_mangle)]
pub extern "C" fn streamfold_parser_output(handle: usize) -> usize {
    parser_mut(handle).parser.patch_bytes().as_ptr() as usize
}

#[unsafe(no_mangle)]
pub extern "C" fn streamfold_parser_output_len(handle: usize) -> usize {
    parser_mut(handle).parser.patch_bytes().len()
}
