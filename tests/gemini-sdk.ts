import { GoogleGenAI } from "@google/genai";
import { readStructured } from "streamfold";
import { gemini } from "streamfold/gemini";

const client = new GoogleGenAI({ apiKey: "typecheck-only" });
const events = await client.interactions.create({
  model: "gemini-3.8-flash", input: "Weather in Paris?", stream: true,
});
readStructured(events, { integration: gemini });
for await (const event of events) gemini().pushAll(event);
