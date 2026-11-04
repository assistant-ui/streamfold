import { createStructuredStream } from "../index.js";

const samePath = (left, right) =>
  left.length === right.length && left.every((key, index) => key === right[index]);

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
