import { fixtureEvents, type Scenario } from "./fixtures.ts";
import { benchmarkParsers } from "./parser-benchmark.ts";

const worker = self as unknown as Pick<Worker, "postMessage" | "onmessage">;
worker.onmessage = (event: MessageEvent<{ scenario: Scenario }>) => {
  try {
    const result = benchmarkParsers(fixtureEvents(event.data.scenario), {
      onProgress: (sample) => worker.postMessage({ type: "progress", sample }),
    });
    worker.postMessage({ type: "result", result });
  } catch (error) {
    worker.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
