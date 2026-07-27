export const repairAndParse = (input) => {
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
      } else if (char === '"') {
        inString = true;
      } else if (char === "{" || char === "[") {
        stack.push(char);
      } else if (char === "}" || char === "]") {
        stack.pop();
      }
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
