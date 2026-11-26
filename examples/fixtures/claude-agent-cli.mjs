import { createInterface } from "node:readline";

const messages = JSON.parse(process.argv[2]);
const send = (message) => console.log(JSON.stringify(message));

// Keep the stalled transport alive even if the SDK closes stdin.
process.channel?.ref();
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.type === "control_request" && message.request.subtype === "initialize") {
    send({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: message.request_id,
        response: {},
      },
    });
  } else if (message.type === "user") {
    messages.forEach(send);
    if (!process.channel) process.stdin.destroy();
  }
});
