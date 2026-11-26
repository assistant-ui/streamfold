import { createStructuredStreamPool } from "../index.js";
import { createIntegration } from "./integration.js";

const requireId = (id, field) => {
  if (typeof id !== "string" || !id)
    throw new Error(`Realtime is missing ${field}; pass decoded server events with their IDs.`);
};

export const openAIRealtime = (pool = createStructuredStreamPool(), options) => {
  const pending = new Map();
  const checkOwner = (id, responseId) => {
    requireId(id, "call_id");
    requireId(responseId, "response ID");
    const call = pending.get(id);
    if (call && call.responseId !== responseId)
      throw new Error(`Realtime call ${id} changed response ID; preserve the original call IDs.`);
    return call;
  };
  const finishResponse = (response, calls) => {
    const { id, status, output, status_details: details } = response;
    requireId(id, "response ID");
    if (status !== "completed")
      throw new Error(`Realtime response ${id} ended with status ${status ?? "unknown"}.`, {
        cause: details,
      });

    let update;
    for (const item of output ?? []) {
      if (item.type !== "function_call") continue;
      checkOwner(item.call_id, id);
      if (item.status !== undefined && item.status !== "completed")
        throw new Error(`Realtime call ${item.call_id} ended with status ${item.status}.`);
      if (typeof item.arguments !== "string")
        throw new Error("Realtime function output is missing its final arguments.");
      update = calls.complete(item.call_id, () => item.arguments);
      pending.delete(item.call_id);
    }
    for (const [callId, call] of pending) {
      if (call.responseId !== id) continue;
      if (output !== undefined || typeof call.arguments !== "string" || call.incomplete)
        throw new Error(
          `Realtime response ${id} ended without a completed function call ${callId}.`,
        );
      update = calls.complete(callId, () => call.arguments);
      pending.delete(callId);
    }
    return update;
  };

  const accept = (event, calls) => {
    if (event.type === "error") throw new Error(event.error.message, { cause: event.error });
    if (event.type === "response.done") return finishResponse(event.response, calls);

    let id;
    let initial;
    switch (event.type) {
      case "response.output_item.added":
      case "response.output_item.done":
        if (event.item.type !== "function_call") return;
        id = event.item.call_id;
        if (event.type === "response.output_item.added") initial = event.item.arguments;
        break;
      case "response.function_call_arguments.delta":
      case "response.function_call_arguments.done":
        id = event.call_id;
        break;
      default:
        return;
    }

    let call = checkOwner(id, event.response_id);
    let update;
    if (!call) {
      call = { responseId: event.response_id };
      update = calls.start(id, initial);
      pending.set(id, call);
    }
    if (event.type === "response.function_call_arguments.delta") {
      if (call.arguments !== undefined)
        throw new Error(`Realtime call ${id} received a delta after its final arguments.`);
      return calls.push(id, event.delta);
    }
    if (event.type === "response.function_call_arguments.done") call.arguments = event.arguments;
    if (event.type === "response.output_item.done") {
      call.arguments = event.item.arguments;
      call.incomplete = event.item.status !== undefined && event.item.status !== "completed";
    }
    return update;
  };

  return createIntegration(
    pool,
    accept,
    () => {
      if (pending.size)
        throw new Error(
          "Realtime ended before response.done; consume the complete response or abort it.",
        );
    },
    "openai-realtime",
    options,
    () => pending.clear(),
  );
};
