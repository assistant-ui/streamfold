import { createStructuredStreamPool } from "./index.js";

export function defineAdapter(mapEvent) {
  if (typeof mapEvent !== "function") {
    throw new TypeError("An adapter mapper must be a function");
  }

  return (options) => {
    const pool = createStructuredStreamPool(options);
    let status = "active";
    let failure;

    const disposeActive = () => {
      for (const id of pool.activeIds) pool.abort(id);
    };

    const fail = (error) => {
      failure = error instanceof Error
        ? error
        : new Error("Adapter stream failed", { cause: error });
      disposeActive();
      return failure;
    };

    const assertActive = () => {
      if (failure !== undefined) throw failure;
      if (status !== "active") {
        throw new Error(`Adapter stream has been ${status}`);
      }
    };

    return {
      pushAll(event) {
        assertActive();
        try {
          const operations = mapEvent(event);
          if (!Array.isArray(operations)) {
            throw new TypeError("An adapter mapper must return an array");
          }

          const updates = [];
          for (const operation of operations) {
            if (
              operation === null ||
              typeof operation !== "object" ||
              !("id" in operation)
            ) {
              throw new TypeError("An adapter operation must include an id");
            }
            switch (operation.type) {
              case "start":
                updates.push({ type: "start", ...pool.start(operation.id) });
                break;
              case "delta":
                if (typeof operation.text !== "string") {
                  throw new TypeError("An adapter delta must include text");
                }
                updates.push({ type: "update", ...pool.push(operation.id, operation.text) });
                break;
              case "end":
                updates.push({ type: "complete", ...pool.finish(operation.id) });
                break;
              case "abort":
                pool.abort(operation.id);
                break;
              default:
                throw new TypeError("Unknown adapter operation type");
            }
          }
          return updates;
        } catch (error) {
          throw fail(error);
        }
      },

      finish() {
        if (failure !== undefined) throw failure;
        if (status === "finished") return [];
        assertActive();
        try {
          const completed = pool.activeIds.map((id) => ({ type: "complete", ...pool.finish(id) }));
          status = "finished";
          return completed;
        } catch (error) {
          throw fail(error);
        }
      },

      dispose() {
        disposeActive();
        if (status === "active") status = "disposed";
      },
    };
  };
}
