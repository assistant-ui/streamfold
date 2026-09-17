import { useEffect, useMemo, useRef, useState } from "react";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
  useAuiState,
  type ChatModelAdapter,
} from "@assistant-ui/react";
import {
  ArrowUp,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronRight,
  CloudSun,
  Code2,
  Copy,
  ExternalLink,
  LoaderCircle,
  MessageSquare,
  Play,
  RotateCcw,
  Square,
  Terminal,
  TriangleAlert,
} from "lucide-react";
import { dependencies } from "../package.json";
import { scenarios, type Scenario } from "./fixtures.ts";
import { emptyTrace, runFixture, type Trace } from "./model.ts";
import integrationCode from "./model.ts?raw";
import { WeatherTool, ForecastTool, ItineraryTool } from "./ToolCards.tsx";

export function UserMessage() {
  return (
    <MessagePrimitive.Root className="user-message">
      <span className="message-label">You</span>
      <div className="user-bubble">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

export function AssistantMessage() {
  const status = useAuiState((s) => s.message.status);
  return (
    <MessagePrimitive.Root className="assistant-message">
      <div className="message-label">
        <span className="assistant-mark">
          <MessageSquare size={13} />
        </span>
        Assistant
      </div>
      <div className="assistant-content">
        <MessagePrimitive.Parts
          components={{
            tools: {
              by_name: {
                get_weather: WeatherTool,
                show_forecast: ForecastTool,
                plan_trip: ItineraryTool,
              },
            },
          }}
        />
      </div>
      {status?.type === "incomplete" && (
        <div className="message-notice" role="status">
          {status.reason === "cancelled"
            ? "Stopped. Partial arguments were kept; unfinished calls have no result."
            : "The argument stream failed. No result was generated for the unfinished call."}
        </div>
      )}
    </MessagePrimitive.Root>
  );
}

function Inspector({ trace }: { trace: Trace }) {
  const [tab, setTab] = useState<"state" | "events" | "code">("state");
  const [selectedId, setSelectedId] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  const selected =
    trace.calls.find((call) => call.id === selectedId) ?? trace.calls[0];
  const parsed = JSON.stringify(selected?.args ?? {}, null, 2);
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        tab === "code" ? integrationCode : parsed,
      );
      setCopied(true);
      setCopyError(false);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopyError(true);
    }
  }
  return (
    <aside className="inspector" aria-label="Stream inspector">
      <div className="section-heading">
        <div>
          <Terminal size={16} />
          <h2>Stream inspector</h2>
        </div>
        <span className={`connection ${trace.state}`}>
          {trace.state === "streaming" ? (
            <LoaderCircle className="spin" size={12} />
          ) : (
            <span />
          )}
          {trace.state}
        </span>
      </div>
      <div className="metrics">
        <div>
          <span>Input events</span>
          <strong data-testid="input-count">{trace.inputCount}</strong>
        </div>
        <div>
          <span>Parser updates</span>
          <strong>{trace.outputCount}</strong>
        </div>
        <div>
          <span>JSON bytes</span>
          <strong>{trace.bytes}</strong>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="Inspector view">
        {(
          [
            ["state", "Parsed state"],
            ["events", "Event log"],
            ["code", "Integration"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls="inspector-panel"
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={(event) => {
              const tabs = ["state", "events", "code"] as const;
              const index = tabs.indexOf(id);
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % 3
                  : event.key === "ArrowLeft"
                    ? (index + 2) % 3
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? 2
                        : undefined;
              if (next === undefined) return;
              event.preventDefault();
              setTab(tabs[next]);
              document.getElementById(`tab-${tabs[next]}`)?.focus();
            }}
          >
            {label}
            {id === "events" && trace.entries.length > 0 && (
              <span>{trace.entries.length}</span>
            )}
          </button>
        ))}
      </div>
      <div
        className="inspector-scroll"
        role="tabpanel"
        id="inspector-panel"
        aria-labelledby={`tab-${tab}`}
      >
        {tab === "state" && (
          <>
            <div className="call-selector">
              <label htmlFor="call-id">Tool call</label>
              <select
                id="call-id"
                value={selected?.id ?? ""}
                onChange={(event) => setSelectedId(event.target.value)}
                disabled={trace.calls.length < 2}
              >
                {trace.calls.length ? (
                  trace.calls.map((call) => (
                    <option key={call.id}>{call.id}</option>
                  ))
                ) : (
                  <option value="">No calls yet</option>
                )}
              </select>
            </div>
            <div className="code-heading">
              <span>
                <Code2 size={14} />
                partialValue
              </span>
              <button
                className="icon-button"
                title="Copy parsed JSON"
                aria-label="Copy parsed JSON"
                onClick={copy}
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
              </button>
            </div>
            <pre className="json-output" data-testid="parsed-state">
              {parsed}
            </pre>
            <div className="state-flags">
              <span>
                <CheckCheck size={14} />
                Immutable snapshot
              </span>
              <span className={selected?.complete ? "success" : "muted"}>
                {selected?.complete ? "JSON complete" : "JSON partial"}
              </span>
            </div>
            <div className="raw-section">
              <h3>Accumulated argument text</h3>
              <pre data-testid="raw-text">
                {selected?.raw || "No text received"}
              </pre>
            </div>
            <div className="pipeline">
              <span>assistant-stream</span>
              <ChevronRight size={13} />
              <strong>Streamfold</strong>
              <ChevronRight size={13} />
              <span>assistant-ui</span>
            </div>
            <dl className="session-details">
              <div>
                <dt>Integration</dt>
                <dd>assistantUI</dd>
              </div>
              <div>
                <dt>Package</dt>
                <dd>streamfold@{dependencies.streamfold}</dd>
              </div>
              <div>
                <dt>Event source</dt>
                <dd>
                  {trace.sourceClosed
                    ? "Closed"
                    : trace.state === "idle"
                      ? "Not started"
                      : "Open"}
                </dd>
              </div>
            </dl>
          </>
        )}
        {tab === "events" && (
          <div className="event-log">
            {trace.entries.length === 0 && (
              <p className="muted">No events received.</p>
            )}
            {trace.entries.map((entry) => (
              <div
                className={`event-row ${entry.direction}`}
                key={entry.sequence}
              >
                <span className="event-number">
                  {String(entry.sequence).padStart(2, "0")}
                </span>
                {entry.direction === "in" ? (
                  <ArrowDownLeft size={14} />
                ) : (
                  <ArrowUpRight size={14} />
                )}
                <div>
                  <div>
                    <strong>{entry.type}</strong>
                    <span>{entry.id}</span>
                  </div>
                  {entry.text && <code>{entry.text}</code>}
                </div>
              </div>
            ))}
          </div>
        )}
        {tab === "code" && (
          <>
            <div className="code-heading">
              <span>model.ts</span>
              <button
                onClick={copy}
                className="icon-button"
                aria-label="Copy integration source"
                title="Copy integration source"
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
              </button>
            </div>
            <pre className="integration-code">{integrationCode}</pre>
            <a
              className="source-link"
              href={`https://github.com/assistant-ui/streamfold/blob/v${dependencies.streamfold}/examples/assistant-ui.mjs`}
              target="_blank"
              rel="noreferrer"
            >
              Published event adapter example
              <ExternalLink size={13} />
            </a>
          </>
        )}
        {copyError && (
          <p role="alert">Clipboard unavailable. The code is selectable.</p>
        )}
        {trace.error && (
          <div className="error-banner" role="alert">
            <TriangleAlert size={17} />
            <div>
              <strong>Argument parsing failed</strong>
              <p>{trace.error}</p>
            </div>
          </div>
        )}
      </div>
      <footer className="inspector-footer">
        <span className="source-dot" />
        Fixture replay<span>No model or weather API connected</span>
      </footer>
    </aside>
  );
}

function DemoSession({
  onReset,
  scenario,
  onScenario,
  interval,
  onInterval,
}: {
  onReset: () => void;
  scenario: Scenario;
  onScenario: (scenario: Scenario) => void;
  interval: number;
  onInterval: (interval: number) => void;
}) {
  const [trace, setTrace] = useState<Trace>(emptyTrace);
  const model = useMemo<ChatModelAdapter>(
    () => ({
      run: ({ abortSignal }) =>
        runFixture({
          scenario,
          signal: abortSignal,
          interval,
          onTrace: setTrace,
        }),
    }),
    [scenario, interval],
  );
  const runtime = useLocalRuntime(model);
  const busy = trace.state === "streaming";
  const runSample = () =>
    runtime.thread.append({
      role: "user",
      content: [{ type: "text", text: scenarios[scenario].prompt }],
    });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="toolbar">
        <div className="scenario-control">
          <label htmlFor="scenario">Scenario</label>
          <select
            id="scenario"
            value={scenario}
            disabled={busy}
            onChange={(event) => onScenario(event.target.value as Scenario)}
          >
            {Object.entries(scenarios).map(([key, value]) => (
              <option key={key} value={key}>
                {value.name}
              </option>
            ))}
          </select>
        </div>
        <div className="speed-control">
          <label htmlFor="speed">Chunk delay</label>
          <input
            id="speed"
            type="range"
            min="20"
            max="350"
            step="10"
            value={interval}
            disabled={busy}
            onChange={(event) => onInterval(Number(event.target.value))}
          />
          <output htmlFor="speed">{interval} ms</output>
        </div>
        <div className="toolbar-actions">
          <button
            className="icon-button"
            title="Reset conversation"
            aria-label="Reset conversation"
            onClick={onReset}
            disabled={busy}
          >
            <RotateCcw size={17} />
          </button>
          {busy ? (
            <button
              className="primary stop"
              onClick={() => runtime.thread.cancelRun()}
            >
              <Square size={14} fill="currentColor" />
              Stop
            </button>
          ) : (
            <button className="primary" onClick={runSample}>
              <Play size={14} fill="currentColor" />
              {trace.state === "idle" ? "Run sample" : "Run again"}
            </button>
          )}
        </div>
      </div>
      <main
        className={`workspace ${scenario === "trip" ? "complex-workspace" : ""}`}
      >
        <section className="chat-pane" aria-label="Assistant conversation">
          <div className="section-heading">
            <div>
              <MessageSquare size={16} />
              <h2>Conversation</h2>
            </div>
            <span className="minor">@assistant-ui/react</span>
          </div>
          <ThreadPrimitive.Root className="thread">
            <ThreadPrimitive.Viewport className="thread-viewport">
              <ThreadPrimitive.Empty>
                <div className="welcome">
                  <CloudSun size={36} strokeWidth={1.3} />
                  <h2>
                    {scenario === "trip"
                      ? "Three days by the bay"
                      : "San Francisco forecast"}
                  </h2>
                  <p>
                    {scenario === "trip"
                      ? "Weather, charts, stays, and a streamed itinerary"
                      : "San Francisco Bay Area"}
                  </p>
                  <button className="sample-prompt" onClick={runSample}>
                    {scenarios[scenario].prompt}
                    <ArrowUpRight size={17} />
                  </button>
                </div>
              </ThreadPrimitive.Empty>
              <ThreadPrimitive.Messages
                components={{ UserMessage, AssistantMessage }}
              />
            </ThreadPrimitive.Viewport>
            <div className="composer-area">
              <ComposerPrimitive.Root className="composer">
                <ComposerPrimitive.Input
                  aria-label="Message"
                  placeholder="Send a message to replay the selected fixture..."
                  rows={1}
                />
                <ComposerPrimitive.Send
                  className="send-button"
                  title="Send message"
                  aria-label="Send message"
                >
                  <ArrowUp size={18} />
                </ComposerPrimitive.Send>
                <ComposerPrimitive.Cancel
                  className="send-button"
                  title="Stop generation"
                  aria-label="Stop generation"
                >
                  <Square size={15} fill="currentColor" />
                </ComposerPrimitive.Cancel>
              </ComposerPrimitive.Root>
              <div className="composer-caption">
                <span>Local fixture session</span>
                <span>Streamfold + assistant-ui</span>
              </div>
            </div>
          </ThreadPrimitive.Root>
        </section>
        <Inspector trace={trace} />
      </main>
    </AssistantRuntimeProvider>
  );
}

export function SingleDemo({
  initialScenario = "weather",
}: {
  initialScenario?: Scenario;
}) {
  const [session, setSession] = useState(0);
  const [scenario, setScenario] = useState<Scenario>(initialScenario);
  const [interval, setInterval] = useState(110);
  return (
    <DemoSession
      key={session}
      scenario={scenario}
      onScenario={setScenario}
      interval={interval}
      onInterval={setInterval}
      onReset={() => setSession((value) => value + 1)}
    />
  );
}
