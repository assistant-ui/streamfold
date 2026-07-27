import { IncrementalJsonScanner } from "../packages/core/src/index.js";

const repairAndParse = (input) => {
  try {
    return JSON.parse(input);
  } catch {
    let inString = false;
    let escaped = false;
    const stack = [];
    for (let index = 0; index < input.length; index++) {
      const char = input[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
      } else if (char === '"') inString = true;
      else if (char === "{" || char === "[") stack.push(char);
      else if (char === "}" || char === "]") stack.pop();
    }
    let repaired = input;
    if (inString) repaired += '"';
    for (let index = stack.length - 1; index >= 0; index--) {
      repaired += stack[index] === "{" ? "}" : "]";
    }
    try {
      return JSON.parse(repaired);
    } catch {
      return undefined;
    }
  }
};

const checksum = (text) => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

self.onmessage = async (event) => {
  const { kind, payload, chunkSize, batchSize } = event.data;
  const chunks = [];
  for (let offset = 0; offset < payload.length; offset += chunkSize) {
    chunks.push(payload.slice(offset, offset + chunkSize));
  }

  const scanner = kind === "streamfold" ? new IncrementalJsonScanner() : undefined;
  let accumulated = "";
  let visited = 0;
  let streamState;
  const started = performance.now();

  for (let batchStart = 0; batchStart < chunks.length; batchStart += batchSize) {
    const batchEnd = Math.min(batchStart + batchSize, chunks.length);
    for (let index = batchStart; index < batchEnd; index++) {
      const chunk = chunks[index];
      accumulated += chunk;
      if (kind === "baseline") {
        repairAndParse(accumulated);
        visited += accumulated.length;
      } else {
        streamState = scanner.push(chunk);
        visited = streamState.bytesSeen;
      }
    }
    self.postMessage({
      type: "progress",
      received: accumulated.length,
      total: payload.length,
      visited,
      chunk: batchEnd,
      depth: streamState?.depth ?? null,
      tail: accumulated.slice(-420),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const finalValue = JSON.parse(accumulated);
  scanner?.finish();
  scanner?.dispose();
  self.postMessage({
    type: "complete",
    elapsedMs: performance.now() - started,
    total: payload.length,
    visited,
    checksum: checksum(JSON.stringify(finalValue)),
  });
};
