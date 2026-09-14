import { defineAdapter, readStructured } from "streamfold";

/** @typedef {{ kind: 'begin' | 'done' | 'cancel', id: string } | { kind: 'piece', id: string, text: string }} WeatherEvent */

export const weatherAdapter = defineAdapter(
  /** @param {WeatherEvent} event */
  (event) => {
    switch (event.kind) {
      case "begin": return [{ type: "start", id: event.id }];
      case "piece": return [{ type: "delta", id: event.id, text: event.text }];
      case "done": return [{ type: "end", id: event.id }];
      case "cancel": return [{ type: "abort", id: event.id }];
      default: throw new TypeError("Unknown weather event");
    }
  },
);

/** @type {WeatherEvent[]} */
export const events = [
  { kind: "begin", id: "weather" },
  { kind: "piece", id: "weather", text: '{"city":"San' },
  { kind: "piece", id: "weather", text: ' Francisco"}' },
  { kind: "done", id: "weather" },
];

/**
 * @param {AsyncIterable<WeatherEvent> | Iterable<WeatherEvent>} source
 * @param {{ signal?: AbortSignal }} [options]
 */
export function readToolInputs(source = events, options = {}) {
  return readStructured(source, {
    adapter: weatherAdapter,
    limits: { snapshots: "immutable" },
    ...options,
  });
}
