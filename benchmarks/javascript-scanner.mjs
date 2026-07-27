export class JavaScriptIncrementalScanner {
  stack = [];
  bytesSeen = 0;
  started = false;
  complete = false;
  inString = false;
  escaped = false;
  primitive = false;

  push(chunk) {
    for (let index = 0; index < chunk.length; index++) {
      const char = chunk.charCodeAt(index);
      this.bytesSeen++;

      if (this.complete) continue;
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (char === 92) this.escaped = true;
        else if (char === 34) {
          this.inString = false;
          if (this.stack.length === 0) this.complete = true;
        }
        continue;
      }

      if (char === 32 || char === 10 || char === 13 || char === 9) continue;
      if (char === 34) {
        this.started = true;
        this.inString = true;
      } else if (char === 123 || char === 91) {
        this.started = true;
        this.stack.push(char);
      } else if (char === 125 || char === 93) {
        this.stack.pop();
        this.primitive = false;
        if (this.stack.length === 0) this.complete = true;
      } else if (char === 44 || char === 58) {
        this.primitive = false;
      } else {
        this.started = true;
        this.primitive = true;
      }
    }
  }
}
