import { createStructuredStream } from "../index.js";

const samePath = (left, right) =>
  left.length === right.length && left.every((key, index) => key === right[index]);

// assistant-stream's grammar for a number that later characters can still complete.
const PARTIAL_NUMBER = /^-?$|^-?(?:0|[1-9]\d*)(?:\.\d*)?$|^-?(?:0|[1-9]\d*)(?:\.\d+)?[eE][+-]?\d*$/;
const NUMBER_CHARACTERS = "0123456789.eE+-";

// Returns the text of the number that ends the input so far, "" when a number
// could start next, or undefined inside a string or a literal such as `true`.
const trailingNumber = (previous, delta, inString) => {
  if (inString) return undefined;
  let start = delta.length;
  while (start > 0 && NUMBER_CHARACTERS.includes(delta[start - 1])) start--;
  const suffix = delta.slice(start);
  const before = delta[start - 1];
  const number =
    before === undefined
      ? previous === undefined
        ? undefined
        : previous + suffix
      : before >= "a" && before <= "z"
        ? undefined
        : suffix;
  // Only the first digit of a digit run affects validity, so runs keep two digits.
  return number?.replace(/(\d)\d+/g, "$1$1");
};

class StreamfoldParser {
  owner = Symbol();

  session;
  args;
  createSnapshot;

  constructor(session, args, createSnapshot) {
    this.createSnapshot = createSnapshot;
    this.session = session;
    this.args = args;
    session.owner = this.owner;
  }

  get currentArgs() {
    return this.args;
  }

  static create(createScanner, text, fallback, createSnapshot) {
    const session = {
      scanner: createScanner(),
      owner: Symbol(),
      containers: [],
      token: undefined,
      number: "",
      closed: false,
    };
    const parser = new StreamfoldParser(session, fallback, createSnapshot);
    return text.length ? parser.append(text) : parser;
  }

  append(delta) {
    const session = this.session;
    if (session.closed || session.owner !== this.owner) return undefined;
    try {
      // Streamfold omits partial patches for a pending surrogate or minus sign.
      if (/[\uD800-\uDFFF]/u.test(delta)) throw new Error("Use native partial parsing");
      const update = session.scanner.push(delta);
      if (delta.endsWith("-") && !update.inString) throw new Error("Use native partial parsing");
      // Streamfold keeps the longest valid prefix of a malformed number until it
      // ends, so `01` reads as 0. Native parsing never surfaces that value.
      session.number = trailingNumber(session.number, delta, update.inString);
      if (session.number !== undefined && !PARTIAL_NUMBER.test(session.number))
        throw new Error("Use native partial parsing");
      this.trackPaths(update);
      const root = update.partialValue;
      if (root === null || Array.isArray(root) || (root !== undefined && typeof root !== "object"))
        throw new Error("Expected object arguments");
      const args =
        root === undefined
          ? this.args
          : this.createSnapshot(root, update.complete ? "complete" : "partial", [
              ...(session.token ?? session.containers.at(-1) ?? []),
            ]);
      const next = new StreamfoldParser(session, args, this.createSnapshot);
      if (update.complete) this.close();
      return next;
    } catch {
      this.close();
      return undefined;
    }
  }

  trackPaths(update) {
    const session = this.session;
    for (const change of update.changes) {
      if (
        change.path.some(
          (key, index) =>
            key === "__proto__" ||
            (key === "prototype" && change.path[index - 1] === "constructor"),
        )
      )
        throw new Error("Unsafe argument key");
      if (change.op === "complete") {
        if (session.token && samePath(session.token, change.path)) session.token = undefined;
        if (session.containers.at(-1) && samePath(session.containers.at(-1), change.path))
          session.containers.pop();
      } else if (change.op === "set") {
        if (change.value !== null && typeof change.value === "object") {
          session.containers.push(change.path);
          session.token = undefined;
        } else {
          session.token =
            typeof change.value === "string" || typeof change.value === "number"
              ? change.path
              : undefined;
        }
      }
    }
  }

  close() {
    this.session.scanner.dispose();
    this.session.closed = true;
  }
}

export const createAssistantStreamBackend = ({ text, fallback, createSnapshot }) =>
  StreamfoldParser.create(
    () => createStructuredStream({ snapshots: "live" }),
    text,
    fallback,
    createSnapshot,
  );
