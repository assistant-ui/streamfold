export async function* readStructured(events, { adapter, limits }) {
  const stream = adapter(limits);
  try {
    for await (const event of events) {
      for (const update of stream.pushAll(event)) yield update;
    }
    for (const completed of stream.finish()) yield completed;
  } finally {
    stream.dispose();
  }
}
