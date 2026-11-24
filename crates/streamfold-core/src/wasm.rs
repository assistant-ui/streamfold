//! Wasm exports used by `packages/core/src/internal/wasm-runtime.js`.
//!
//! A parser handle is the address of a boxed `WasmParser` from `streamfold_parser_new`.
//! Every other export takes a handle and is `unsafe` because it trusts the caller to
//! pass a live one: returned by `streamfold_parser_new` on the same instance and not yet
//! passed to `streamfold_parser_free`. The JS runtime upholds this by giving each
//! scanner one handle, clearing it after the single free, and refusing calls after
//! dispose. Wasm runs these exports on one thread and none of them calls back into JS,
//! so no two references to the same parser are ever live at once.

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

/// Borrows the parser behind `handle` for the rest of one export call.
///
/// # Safety
///
/// `handle` must be live (see the module docs), and no other reference to the same
/// parser may exist while the returned one is used.
unsafe fn parser_mut<'a>(handle: usize) -> &'a mut WasmParser {
    assert_ne!(handle, 0);
    // SAFETY: a live handle is the pointer `Box::into_raw` returned in
    // `streamfold_parser_new` and has not been freed, so it is aligned and points to an
    // initialized `WasmParser`. The caller guarantees the borrow is unique.
    unsafe { &mut *(handle as *mut WasmParser) }
}

#[unsafe(no_mangle)]
pub extern "C" fn streamfold_parser_new(max_depth: usize, max_bytes: usize) -> usize {
    Box::into_raw(Box::new(WasmParser::new(max_depth, max_bytes))) as usize
}

/// # Safety
///
/// `handle` must be 0 or live, and must not be used again after this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn streamfold_parser_free(handle: usize) {
    if handle != 0 {
        // SAFETY: a live handle came from `Box::into_raw` and has not been freed, and
        // the caller never uses it again, so this reclaims the only owner exactly once.
        unsafe {
            drop(Box::from_raw(handle as *mut WasmParser));
        }
    }
}

/// # Safety
///
/// `handle` must be live (see the module docs).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn streamfold_parser_input(handle: usize, capacity: usize) -> usize {
    // SAFETY: the caller passes a live handle, and this is the only borrow of it.
    let parser = unsafe { parser_mut(handle) };
    parser.input.resize(capacity, 0);
    parser.input.as_mut_ptr() as usize
}

/// # Safety
///
/// `handle` must be live (see the module docs).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn streamfold_parser_push(handle: usize, length: usize) -> u32 {
    // SAFETY: the caller passes a live handle, and this is the only borrow of it.
    let parser = unsafe { parser_mut(handle) };
    assert!(length <= parser.input.len());
    let result = parser.parser.push(&parser.input[..length]);
    parser.encode(result)
}

/// # Safety
///
/// `handle` must be live (see the module docs).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn streamfold_parser_finish(handle: usize) -> u32 {
    // SAFETY: the caller passes a live handle, and this is the only borrow of it.
    let parser = unsafe { parser_mut(handle) };
    parser.input = Vec::new();
    let result = parser.parser.finish();
    parser.encode(result)
}

/// # Safety
///
/// `handle` must be live (see the module docs).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn streamfold_parser_state(handle: usize) -> u32 {
    // SAFETY: the caller passes a live handle, and this is the only borrow of it.
    let parser = unsafe { parser_mut(handle) };
    encode_state(parser.parser.state())
}

/// # Safety
///
/// `handle` must be live (see the module docs).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn streamfold_parser_bytes_seen(handle: usize) -> usize {
    // SAFETY: the caller passes a live handle, and this is the only borrow of it.
    let parser = unsafe { parser_mut(handle) };
    parser.parser.state().bytes_seen
}

/// # Safety
///
/// `handle` must be live (see the module docs).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn streamfold_parser_error_offset(handle: usize) -> usize {
    // SAFETY: the caller passes a live handle, and this is the only borrow of it.
    let parser = unsafe { parser_mut(handle) };
    parser.error_offset
}

/// # Safety
///
/// `handle` must be live (see the module docs).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn streamfold_parser_error_byte(handle: usize) -> u32 {
    // SAFETY: the caller passes a live handle, and this is the only borrow of it.
    let parser = unsafe { parser_mut(handle) };
    parser.error_byte.into()
}

/// # Safety
///
/// `handle` must be live (see the module docs).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn streamfold_parser_output(handle: usize) -> usize {
    // SAFETY: the caller passes a live handle, and this is the only borrow of it.
    let parser = unsafe { parser_mut(handle) };
    parser.parser.patch_bytes().as_ptr() as usize
}

/// # Safety
///
/// `handle` must be live (see the module docs).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn streamfold_parser_output_len(handle: usize) -> usize {
    // SAFETY: the caller passes a live handle, and this is the only borrow of it.
    let parser = unsafe { parser_mut(handle) };
    parser.parser.patch_bytes().len()
}
