import { HttpAgent, type AgentSubscriber } from "@ag-ui/client";
import type { BaseEvent, ToolCallArgsEvent } from "@ag-ui/core";
import { createStructuredStreamPool, readStructured } from "streamfold";
import { agUI } from "streamfold/ag-ui";

declare const events: AsyncIterable<BaseEvent>;
declare const argument: ToolCallArgsEvent;
readStructured(events, { integration: agUI });
const stream = agUI();
stream.pushAll(argument);
const subscriber = {
  onEvent({ event }) {
    stream.pushAll(event);
  },
} satisfies AgentSubscriber;
const agent = new HttpAgent({ url: "https://example.invalid/ag-ui" });
agent.runAgent({}, subscriber);

declare function consume(update: ReturnType<typeof stream.pushAll>[number]): void;
async function consumeAgent(agent: HttpAgent) {
  const pool = createStructuredStreamPool({ snapshots: "immutable" });
  const stream = agUI(pool);
  const errors: unknown[] = [];
  try {
    await agent.runAgent(
      {},
      {
        onEvent({ event, agent }) {
          if (errors.length) return;
          try {
            for (const update of stream.pushAll(event)) consume(update);
          } catch (error) {
            errors.push(error);
            agent.abortRun();
          }
        },
      },
    );
    if (errors.length) throw errors[0];
  } finally {
    for (const id of pool.activeIds) pool.abort(id);
  }
}
void consumeAgent;
