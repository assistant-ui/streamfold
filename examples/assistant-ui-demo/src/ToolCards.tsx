import { useId, useState, type ReactNode } from "react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import {
  Check,
  CloudSun,
  LoaderCircle,
  MapPin,
  X,
  ChartLine,
  Route,
  Backpack,
} from "lucide-react";
import { WeatherWidget } from "./components/tool-ui/weather-widget/runtime";
import { Chart } from "./components/assistant-ui/elements/chart";
import { Timeline } from "./components/assistant-ui/elements/timeline";
import { DataTable } from "./components/assistant-ui/elements/data-table";
import type {
  WeatherArgs,
  WeatherResult,
  ForecastArgs,
  ItineraryArgs,
  PreviewResult,
} from "./tool-data.ts";

type PartialTree<T> = T extends (infer Item)[]
  ? PartialTree<Item>[]
  : T extends object
    ? { [Key in keyof T]?: PartialTree<T[Key]> }
    : T;

function ToolShell({
  name,
  icon,
  complete,
  stopped,
  children,
  testId,
}: {
  name: string;
  icon: ReactNode;
  complete: boolean;
  stopped: boolean;
  children: ReactNode;
  testId: string;
}) {
  return (
    <section
      className="existing-tool"
      data-testid={testId}
      data-complete={complete}
    >
      <header className="existing-tool-heading">
        <span>
          {icon}
          <code>{name}</code>
        </span>
        <span
          className={`tool-state ${complete ? "success" : stopped ? "warning" : "pending"}`}
        >
          {complete ? (
            <Check size={13} />
          ) : stopped ? (
            <X size={13} />
          ) : (
            <LoaderCircle size={13} className="spin" />
          )}
          {complete
            ? "Complete"
            : stopped
              ? "Incomplete"
              : "Receiving arguments"}
        </span>
      </header>
      {children}
    </section>
  );
}

export const WeatherTool: ToolCallMessagePartComponent<
  Partial<WeatherArgs>,
  WeatherResult
> = ({ args, result, status }) => {
  const stopped = status.type === "incomplete";
  return (
    <ToolShell
      name="get_weather"
      icon={<CloudSun size={16} />}
      complete={!!result}
      stopped={stopped}
      testId="weather-tool"
    >
      <div className="weather-argument-strip">
        <span>
          <MapPin size={13} />
          <span data-testid="city">{args.city || "Waiting for location"}</span>
        </span>
        <span>
          {args.days ? `${args.days} days` : "…"} · {args.units || "…"}
        </span>
      </div>
      {result ? (
        <div className="existing-weather" data-testid="weather-result">
          <WeatherWidget
            version="3.1"
            id={`weather-${args.city}`}
            location={{ name: args.city ?? "San Francisco" }}
            units={{ temperature: "celsius" }}
            current={{
              conditionCode: "partly-cloudy",
              temperature: result.temperature,
              tempMin: result.temperature - 4,
              tempMax: result.temperature + 3,
              windSpeed: result.wind,
            }}
            forecast={["Today", "Tue", "Wed", "Thu", "Fri"].map(
              (label, index) => ({
                label,
                conditionCode: index === 2 ? "cloudy" : "partly-cloudy",
                tempMin: result.temperature - 4 + (index % 2),
                tempMax: result.temperature + 2 + (index % 3),
              }),
            )}
            time={{ localTimeOfDay: 0.5 }}
            updatedAt="2026-09-14T12:00:00-07:00"
            effects={{ quality: "low" }}
          />
        </div>
      ) : (
        <div className="weather-waiting">
          <CloudSun size={42} strokeWidth={1} />
          <strong>--°</strong>
          <span>
            {stopped
              ? "No result generated"
              : "Waiting for complete weather arguments"}
          </span>
          <p>
            The existing weather widget appears when the sample result is ready.
          </p>
        </div>
      )}
      <p className="existing-tool-caption">
        {args.notes || "The location and preferences appear as they arrive."}
      </p>
      <p className="fixture-caption">
        Sample forecast · assistant-ui WeatherWidget
      </p>
    </ToolShell>
  );
};

export const ForecastTool: ToolCallMessagePartComponent<
  PartialTree<ForecastArgs>,
  PreviewResult
> = ({ args, result, status }) => {
  const [metric, setMetric] = useState<"temperature" | "rainChance">(
    "temperature",
  );
  const hours = (args.hours ?? []).filter(
    (hour) =>
      typeof hour?.time === "string" && typeof hour?.[metric] === "number",
  );
  const points = hours.map((hour) => hour[metric]!);
  const latest = points.at(-1);
  return (
    <ToolShell
      name="show_forecast"
      icon={<ChartLine size={16} />}
      complete={!!result}
      stopped={status.type === "incomplete"}
      testId="forecast-tool"
    >
      <div className="tool-content-heading">
        <h3>{args.location || "Hourly forecast"}</h3>
        <span>{hours.length} points received</span>
      </div>
      <div className="tool-segments" role="group" aria-label="Forecast metric">
        <button
          aria-pressed={metric === "temperature"}
          onClick={() => setMetric("temperature")}
        >
          Temperature
        </button>
        <button
          aria-pressed={metric === "rainChance"}
          onClick={() => setMetric("rainChance")}
        >
          Rain chance
        </button>
      </div>
      {points.length ? (
        <Chart
          className="stream-chart"
          label={
            metric === "temperature" ? "Hourly temperature" : "Rain chance"
          }
          value={`${latest}${metric === "temperature" ? "°C" : "%"}`}
          points={points}
          visibleCount={points.length}
          variant={metric === "temperature" ? "area" : "bars"}
        />
      ) : (
        <p className="tool-empty">Waiting for the first chart point…</p>
      )}
      <div className="chart-labels" aria-label="Received forecast hours">
        {hours.map((hour, index) => (
          <span key={index}>{hour.time}</span>
        ))}
      </div>
      <p className="existing-tool-caption">
        {args.summary || "The chart grows as nested forecast data arrives."}
      </p>
      <p className="fixture-caption">
        {result ? "Validated sample" : "Partial preview"} · assistant-ui Chart
      </p>
    </ToolShell>
  );
};

export const ItineraryTool: ToolCallMessagePartComponent<
  PartialTree<ItineraryArgs>,
  PreviewResult
> = ({ args, result, status }) => {
  const instanceId = useId();
  const [selectedDay, setSelectedDay] = useState(0);
  const days = (args.days ?? []).filter(
    (day) => typeof day?.day === "string" && day.day,
  );
  const activeDay = Math.min(selectedDay, Math.max(days.length - 1, 0));
  const day = days[activeDay];
  const activities = (day?.activities ?? []).filter(
    (activity) => activity?.title && activity?.time,
  );
  const stays = (args.stays ?? []).filter(
    (stay) => stay?.name && stay?.area && stay?.price,
  );
  const packing = (args.packing ?? []).filter(
    (item) => typeof item === "string" && item,
  );
  return (
    <ToolShell
      name="plan_trip"
      icon={<Route size={16} />}
      complete={!!result}
      stopped={status.type === "incomplete"}
      testId="itinerary-tool"
    >
      <div className="tool-content-heading">
        <h3>{args.title || "Building your itinerary"}</h3>
        <span>{days.length} days received</span>
      </div>
      {!!days.length && (
        <div
          className="tool-segments"
          role="tablist"
          aria-label="Itinerary days"
        >
          {days.map((item, index) => (
            <button
              key={index}
              role="tab"
              aria-selected={index === activeDay}
              tabIndex={index === activeDay ? 0 : -1}
              id={`${instanceId}-day-${index}`}
              aria-controls={`${instanceId}-day-panel`}
              onClick={() => setSelectedDay(index)}
              onKeyDown={(event) => {
                const next =
                  event.key === "ArrowRight"
                    ? (index + 1) % days.length
                    : event.key === "ArrowLeft"
                      ? (index + days.length - 1) % days.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? days.length - 1
                          : undefined;
                if (next !== undefined) {
                  event.preventDefault();
                  setSelectedDay(next);
                  (
                    event.currentTarget.parentElement?.children[
                      next
                    ] as HTMLButtonElement
                  )?.focus();
                }
              }}
            >
              {item.day}
            </button>
          ))}
        </div>
      )}
      <div
        role={days.length ? "tabpanel" : undefined}
        id={`${instanceId}-day-panel`}
        aria-labelledby={
          days.length ? `${instanceId}-day-${activeDay}` : undefined
        }
      >
        {day?.title && <h4 className="day-title">{day.title}</h4>}
        {activities.length ? (
          <Timeline
            className="stream-timeline"
            events={activities.map((item, index) => ({
              id: `${activeDay}-${index}`,
              when: "now",
              time: item.time!,
              title: item.title!,
              ...(item.detail ? { detail: item.detail } : {}),
            }))}
            visibleCount={activities.length}
          />
        ) : (
          <p className="tool-empty">Waiting for itinerary items…</p>
        )}
      </div>
      {!!stays.length && (
        <div className="stay-section">
          <h4>Places to stay</h4>
          <DataTable
            className="stream-stays"
            headings={["Sample stay", "Area", "/ night"]}
            rows={stays.map((stay) => ({
              name: stay.name!,
              context: stay.area!,
              cost: stay.price!,
            }))}
            cycle={0}
          />
          <p className="fixture-caption">
            Fictional stays and prices · no booking available
          </p>
        </div>
      )}
      {!!packing.length && (
        <div className="packing-section">
          <h4>
            <Backpack size={15} />
            Pack for the bay
          </h4>
          <ul>
            {packing.map((item, index) => (
              <li key={index}>
                <Check size={13} />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="fixture-caption">
        {result ? "Validated sample" : "Partial preview"} · assistant-ui
        Timeline & DataTable
      </p>
    </ToolShell>
  );
};
