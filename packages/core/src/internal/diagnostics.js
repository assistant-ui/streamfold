export const emitDiagnostic = (options, diagnostic) => {
  try {
    if (typeof options?.onDiagnostic === "function") {
      const result = options.onDiagnostic(diagnostic);
      if (typeof result?.then === "function") {
        Promise.resolve(result).catch(() => {});
      }
    }
  } catch {
    // Observability must not interrupt parsing or resource cleanup.
  }
};
