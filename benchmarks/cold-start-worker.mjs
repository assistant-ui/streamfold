import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const started = performance.now();
const core = await import(pathToFileURL(process.argv[2]).href);
const imported = performance.now();
const pool = new core.StructuredStreamPool();
pool.start("cold");
pool.push("cold", '{"city":"Paris"}');
const result = pool.finish("cold");
const finished = performance.now();
assert.deepEqual(result.value, { city: "Paris" });
assert.equal(pool.size, 0);
console.log(
  JSON.stringify({
    importMs: imported - started,
    firstStreamMs: finished - imported,
    totalMs: finished - started,
  }),
);
