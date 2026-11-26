import "./globals.css";
import { Replay } from "../playground";

const repo = "https://github.com/assistant-ui/streamfold";
export const metadata = {
  title: "Streamfold — incremental JSON for AI streams",
  description: "Replay fragmented tool-call JSON and inspect the partial value after each push.",
};

export default function HomePage() {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header>
        <a className="brand" href="/" aria-label="Streamfold home" aria-current="page">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          Streamfold
        </a>
        <nav aria-label="Resources">
          <a href={repo + "#readme"}>Docs</a>
          <a href={repo + "/blob/main/API.md"}>API</a>
          <a href={repo}>
            <img src="/github.svg" alt="" width="14" height="14" className="github-mark" />
            GitHub
          </a>
        </nav>
      </header>
      <main id="main">
        <Replay />
      </main>
      <footer>
        <span>assistant-ui / streamfold</span>
        <div className="footer-links">
          <a id="adapters-title" href={repo + "/blob/v0.1.20/INTEGRATIONS.md#event-adapters"}>
            Integrations
          </a>
          <a href={repo + "/blob/main/LICENSE"}>MIT License ↗</a>
        </div>
      </footer>
    </>
  );
}
