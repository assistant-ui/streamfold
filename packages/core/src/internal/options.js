import { streamError } from "./errors.js";

export const DEFAULT_STREAM_LIMITS = Object.freeze({
  maxActiveStreams: 256,
  maxBytes: 16 * 1024 * 1024,
  maxDepth: 128,
});

const MAX_LIMIT = 0xffff_ffff;
// The Rust parser encodes path lengths as 16-bit integers.
const MAX_DEPTH = 0xffff;

const describe = (value) => {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "function") return "a function";
  if (value === null || typeof value !== "object") return String(value);
  return Array.isArray(value) ? "an array" : "an object";
};

export const isOptionsObject = (options) =>
  typeof options === "object" && options !== null && !Array.isArray(options);

const invalidOptions = (issues) => {
  const message = issues.map(({ message }) => message).join("; ");
  const ErrorClass = issues.every(({ range }) => range) ? RangeError : TypeError;
  return streamError(new ErrorClass(message), "INVALID_OPTIONS");
};

export const assertOptionsObject = (options, name = "Streamfold options") => {
  if (options === undefined || isOptionsObject(options)) return;
  throw invalidOptions([
    {
      message: `${name} must be an object or undefined (received ${describe(options)})`,
      range: false,
    },
  ]);
};

const readLimit = (issues, options, name, max) => {
  const value = options[name];
  if (value === undefined) return DEFAULT_STREAM_LIMITS[name];
  if (Number.isSafeInteger(value) && value > 0 && value <= max) return value;
  issues.push({
    message: `${name} must be an integer between 1 and ${max} (received ${describe(value)})`,
    range: true,
  });
  return undefined;
};

const readSnapshots = (issues, options) => {
  const { snapshots = "live" } = options;
  if (snapshots === "live" || snapshots === "immutable") return snapshots;
  issues.push({
    message: `snapshots must be "live" or "immutable" (received ${describe(snapshots)})`,
    range: false,
  });
  return undefined;
};

// Validates every key before throwing so one error reports all problems.
export const normalizeStreamLimits = (options = {}, pool = false) => {
  assertOptionsObject(options);
  const issues = [];
  const limits = {
    maxBytes: readLimit(issues, options, "maxBytes", MAX_LIMIT),
    maxDepth: readLimit(issues, options, "maxDepth", MAX_DEPTH),
  };
  if (pool)
    limits.maxActiveStreams = readLimit(issues, options, "maxActiveStreams", MAX_LIMIT);
  limits.snapshots = readSnapshots(issues, options);
  if (issues.length > 0) throw invalidOptions(issues);
  return limits;
};
