import { Columns2, CloudSun, PanelsTopLeft } from "lucide-react";
import assistantUiLogo from "./assets/assistant-ui-logo.svg";
import { Comparison } from "./Comparison.tsx";
import { SingleDemo } from "./SingleDemo.tsx";
import { EngineWarmupStatus } from "./EngineWarmupStatus.tsx";

export function App() {
  const view =
    new URLSearchParams(window.location.search).get("view") ?? "compare";
  const single = view === "single";
  const complex = view === "complex";
  return (
    <>
      <header className="app-header">
        <div className="brand">
          <h1>
            <img
              className="brand-logo"
              src={assistantUiLogo}
              alt="assistant-ui"
              width={180}
              height={30}
            />
          </h1>
          <span className="brand-divider">/</span>
          <span className="lab-name">streamfold</span>
        </div>
        <nav className="view-nav" aria-label="Demo view">
          <a
            href="?view=compare"
            aria-current={!single && !complex ? "page" : undefined}
            title="Compare with and without Streamfold"
            aria-label="Compare"
          >
            <Columns2 size={16} />
            <span>Compare</span>
          </a>
          <a
            href="?view=single"
            aria-current={single ? "page" : undefined}
            title="Single stream inspector"
            aria-label="Single stream"
          >
            <CloudSun size={16} />
            <span>Weather assistant</span>
          </a>
          <a
            href="?view=complex"
            aria-current={complex ? "page" : undefined}
            title="Complex tools example"
            aria-label="Complex tools"
          >
            <PanelsTopLeft size={16} />
            <span>Complex tools</span>
          </a>
        </nav>
      </header>
      <EngineWarmupStatus />
      {single || complex ? (
        <SingleDemo key={view} initialScenario={complex ? "trip" : "weather"} />
      ) : (
        <Comparison />
      )}
    </>
  );
}
