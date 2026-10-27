import type { AssistantStreamChunk } from "assistant-stream";

export const scenarios = {
  weather: {
    name: "Weather lookup",
    prompt: "What's the weather like in San Francisco?",
  },
  trip: {
    name: "Complex trip planner",
    prompt:
      "Plan a three-day San Francisco trip: weather, hourly forecast, places to stay, and an itinerary.",
  },
  parallel: {
    name: "Two interleaved calls",
    prompt: "Compare the weather in San Francisco and Oakland.",
  },
  malformed: {
    name: "Malformed JSON",
    prompt: "Run the malformed tool-argument fixture.",
  },
} as const;

export type Scenario = keyof typeof scenarios;

export function fixtureEvents(scenario: Scenario): AssistantStreamChunk[] {
  if (scenario === "trip") return tripEvents();
  const cities =
    scenario === "parallel" ? ["San Francisco", "Oakland"] : ["San Francisco"];
  const argumentsByCall = cities.map((city) => {
    const json = JSON.stringify({
      city,
      units: "celsius",
      days: 3,
      notes: "A light layer for the waterfront.",
    });
    const text =
      scenario === "malformed" ? json.replace('"days":3', '"days":!') : json;
    return text.match(/.{1,5}/g) ?? [];
  });
  const events: AssistantStreamChunk[] = cities.map((_, index) => ({
    type: "part-start",
    path: [index],
    part: {
      type: "tool-call",
      toolCallId: `weather-${index + 1}`,
      toolName: "get_weather",
    },
  }));
  for (
    let chunk = 0;
    chunk < Math.max(...argumentsByCall.map((parts) => parts.length));
    chunk++
  ) {
    argumentsByCall.forEach((parts, index) => {
      const textDelta = parts[chunk];
      if (textDelta !== undefined)
        events.push({ type: "text-delta", path: [index], textDelta });
    });
  }
  cities.forEach((_, index) =>
    events.push({ type: "tool-call-args-text-finish", path: [index] }),
  );
  return events;
}

function tripEvents(): AssistantStreamChunk[] {
  const calls = [
    {
      id: "weather-1",
      name: "get_weather",
      args: {
        city: "San Francisco",
        units: "celsius",
        days: 3,
        notes: "Cool mornings and a breezy waterfront. Bring a light layer.",
      },
    },
    {
      id: "forecast-1",
      name: "show_forecast",
      args: {
        location: "San Francisco",
        units: "celsius",
        hours: [
          { time: "06:00", temperature: 13, rainChance: 12 },
          { time: "08:00", temperature: 14, rainChance: 10 },
          { time: "10:00", temperature: 16, rainChance: 8 },
          { time: "12:00", temperature: 18, rainChance: 5 },
          { time: "14:00", temperature: 20, rainChance: 5 },
          { time: "16:00", temperature: 19, rainChance: 7 },
          { time: "18:00", temperature: 17, rainChance: 10 },
          { time: "20:00", temperature: 15, rainChance: 12 },
        ],
        summary:
          "The warmest window is noon to 4 pm. Keep the waterfront walk for the afternoon.",
      },
    },
    {
      id: "trip-1",
      name: "plan_trip",
      args: {
        title: "Three days by the bay",
        days: [
          {
            day: "Day 1",
            title: "Waterfront & the bridge",
            activities: [
              {
                time: "09:00",
                title: "Breakfast at the Ferry Building",
                detail:
                  "Start with coffee and a slow walk along the Embarcadero.",
              },
              {
                time: "12:00",
                title: "Explore North Beach",
                detail: "Browse the bookshops and stop for a relaxed lunch.",
              },
              {
                time: "15:00",
                title: "Golden Gate waterfront walk",
                detail:
                  "Follow Crissy Field toward the bridge during the warmer afternoon.",
              },
            ],
          },
          {
            day: "Day 2",
            title: "Parks & neighborhood cafés",
            activities: [
              {
                time: "09:30",
                title: "Golden Gate Park",
                detail:
                  "Wander the gardens and choose a museum if the fog lingers.",
              },
              {
                time: "13:00",
                title: "Lunch in the Inner Sunset",
                detail: "Take a café break before exploring the neighborhood.",
              },
              {
                time: "16:00",
                title: "Ocean Beach",
                detail: "Bring a windproof layer for a short coastal walk.",
              },
            ],
          },
          {
            day: "Day 3",
            title: "Art, views & a final good meal",
            activities: [
              {
                time: "10:00",
                title: "Mission District murals",
                detail: "Walk the mural alleys and browse independent shops.",
              },
              {
                time: "13:00",
                title: "Dolores Park picnic",
                detail: "Enjoy the city views if the afternoon is clear.",
              },
              {
                time: "18:00",
                title: "Dinner in Hayes Valley",
                detail:
                  "Finish with a neighborhood dinner and an easy evening stroll.",
              },
            ],
          },
        ],
        stays: [
          { name: "Waterfront stay", area: "Embarcadero", price: "$240" },
          { name: "Neighborhood inn", area: "Hayes Valley", price: "$190" },
          { name: "Parkside guesthouse", area: "Inner Sunset", price: "$160" },
        ],
        packing: [
          "Light windproof jacket",
          "Comfortable walking shoes",
          "Reusable water bottle",
          "Sunglasses and sunscreen",
        ],
      },
    },
  ];
  const pieces = calls.map(
    (call) => JSON.stringify(call.args).match(/.{1,36}/g) ?? [],
  );
  const events: AssistantStreamChunk[] = calls.map((call, index) => ({
    type: "part-start",
    path: [index],
    part: { type: "tool-call", toolCallId: call.id, toolName: call.name },
  }));
  for (
    let chunk = 0;
    chunk < Math.max(...pieces.map((parts) => parts.length));
    chunk++
  ) {
    calls.forEach((_, index) => {
      const textDelta = pieces[index][chunk];
      if (textDelta === undefined) return;
      events.push({ type: "text-delta", path: [index], textDelta });
      if (chunk === pieces[index].length - 1)
        events.push({ type: "tool-call-args-text-finish", path: [index] });
    });
  }
  return events;
}
