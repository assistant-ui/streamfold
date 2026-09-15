import { z } from "zod";

export const weatherSchema = z.object({
  city: z.string(),
  units: z.literal("celsius"),
  days: z.number().int().positive(),
  notes: z.string(),
});
export type WeatherArgs = z.infer<typeof weatherSchema>;
export type WeatherResult = {
  temperature: number;
  humidity: number;
  wind: number;
  condition: string;
  fixture: true;
};
export const forecastSchema = z.object({
  location: z.string(),
  units: z.literal("celsius"),
  hours: z.array(
    z.object({
      time: z.string(),
      temperature: z.number(),
      rainChance: z.number().min(0).max(100),
    }),
  ),
  summary: z.string(),
});
export const itinerarySchema = z.object({
  title: z.string(),
  days: z.array(
    z.object({
      day: z.string(),
      title: z.string(),
      activities: z.array(
        z.object({ time: z.string(), title: z.string(), detail: z.string() }),
      ),
    }),
  ),
  stays: z.array(
    z.object({ name: z.string(), area: z.string(), price: z.string() }),
  ),
  packing: z.array(z.string()),
});
export type ForecastArgs = z.infer<typeof forecastSchema>;
export type ItineraryArgs = z.infer<typeof itinerarySchema>;
export type PreviewResult = { fixture: true; validated: true };

export function resultFor(
  toolName: string,
  value: unknown,
): WeatherResult | PreviewResult {
  if (toolName === "get_weather") {
    const args = weatherSchema.parse(value);
    return {
      temperature: args.city === "Oakland" ? 20 : 17,
      humidity: 74,
      wind: 14,
      condition: "Partly cloudy",
      fixture: true,
    };
  }
  if (toolName === "show_forecast") forecastSchema.parse(value);
  else if (toolName === "plan_trip") itinerarySchema.parse(value);
  else throw new Error(`Unknown fixture tool: ${toolName}`);
  return { fixture: true, validated: true };
}
