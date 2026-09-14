export const annotateError = (error, details) => {
  try {
    Object.assign(error, details);
  } catch {
    // Preserve an upstream error even when it cannot accept metadata.
  }
  return error;
};

export const isStructuredStreamError = (error) =>
  error instanceof Error && error.streamfold === true;

export const streamError = (error, code, details = {}) =>
  annotateError(error, { streamfold: true, code, ...details });
