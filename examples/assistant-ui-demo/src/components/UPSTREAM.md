# Existing assistant-ui components

The WeatherWidget runtime and overlay, Chart, Timeline, DataTable, surfaces,
range helpers, and reduced-motion hook are copied from assistant-ui's MIT
licensed source at commit `9a076642648ad4225d3f05ccdc69442023629c51`.

Original paths:

- `apps/docs/components/tool-ui/weather-widget/`
- `apps/docs/hooks/use-reduced-motion.ts`
- `packages/ui/src/components/react/assistant-ui/elements/{chart,timeline,data-table,surfaces}.tsx`
- `packages/ui/src/components/react/assistant-ui/utils/range.ts`

The runtime is already compiled upstream; consumers do not need the weather
authoring build. The generated file is preserved as-is. DataTable accepts
optional column headings here so it can display fictional stays. Local wrapper
styles increase label contrast and size the components for the demo. ToolCards
maps actual parser snapshots into these existing components.

The upstream license is in `ASSISTANT-UI-LICENSE.txt`.
