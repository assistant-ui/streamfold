export const emitDiagnostic = (options, diagnostic) => {
  try {
    if (typeof options?.onDiagnostic === "function") {
      options.onDiagnostic(diagnostic);
    }
  } catch {
    // Observability must not interrupt parsing or resource cleanup.
  }
};
