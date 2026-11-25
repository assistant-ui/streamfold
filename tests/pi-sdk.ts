import type { AssistantMessageEvent, AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { readStructured } from "streamfold";
import { createStructuredStream, pi } from "streamfold/pi";

declare const event: AssistantMessageEvent;
declare const stream: AssistantMessageEventStream;
createStructuredStream().pushAll(event);
readStructured(stream, { integration: pi });
