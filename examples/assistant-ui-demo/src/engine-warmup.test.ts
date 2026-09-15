import assert from "node:assert/strict";
import test from "node:test";
import { createEngineWarmup } from "./engine-warmup.ts";

test("idle preparation initializes once and reuses readiness across later requests", () => {
  let initialized = 0;
  let time = 0;
  let idle: () => void = () => {};
  const engine = createEngineWarmup(
    () => {
      initialized++;
      time += 5;
    },
    () => time,
  );
  const initial = engine.getSnapshot();
  const cancel = engine.schedule((run) => {
    idle = run;
    return () => {};
  });
  assert.equal(initial.state, "idle");
  assert.equal(initial.attempts, 0);
  assert.equal(initialized, 0);
  assert.equal(engine.getSnapshot().state, "scheduled");
  idle();
  assert.deepEqual(engine.getSnapshot(), {
    state: "ready",
    source: "background",
    durationMs: 5,
    attempts: 1,
  });
  const ready = engine.getSnapshot();
  cancel();
  engine.prepare("first-use");
  engine.schedule(() => {
    throw new Error("Should not schedule after initialization");
  });
  assert.equal(initialized, 1);
  assert.equal(engine.getSnapshot(), ready);
});

test("first use wins the race with idle warm-up without a second initialization", () => {
  let initialized = 0;
  let cancelled = 0;
  let idle: () => void = () => {};
  const engine = createEngineWarmup(() => {
    initialized++;
  });
  engine.schedule((run) => {
    idle = run;
    return () => {
      cancelled++;
    };
  });
  engine.prepare("first-use");
  idle(); // Even a queued callback that arrives after cancellation is harmless.
  assert.equal(cancelled, 1);
  assert.equal(initialized, 1);
  assert.equal(engine.getSnapshot().source, "first-use");
});

test("a failed background attempt can be retried by normal playback", () => {
  let calls = 0;
  const engine = createEngineWarmup(() => {
    if (++calls === 1) throw new Error("Temporary initialization failure");
  });
  assert.equal(engine.prepare("background"), false);
  assert.equal(engine.getSnapshot().state, "failed");
  assert.equal(engine.prepare("first-use"), true);
  assert.equal(engine.getSnapshot().state, "ready");
  assert.equal(engine.getSnapshot().attempts, 2);
});

test("cancelling a pending warm-up keeps the engine available for a later mount", () => {
  let initialized = 0;
  let idle: () => void = () => {};
  const engine = createEngineWarmup(() => {
    initialized++;
  });
  const cancel = engine.schedule((run) => {
    idle = run;
    return () => {};
  });
  cancel();
  idle();
  assert.equal(initialized, 0);
  assert.equal(engine.getSnapshot().state, "idle");
  engine.schedule((run) => {
    idle = run;
    return () => {};
  });
  idle();
  assert.equal(initialized, 1);
});
