import "./globals.css";
import { Install, Replay } from "../playground";

const repo = "https://github.com/assistant-ui/streamfold";
export const metadata = {
  title: "Streamfold — incremental JSON for AI streams",
  description: "Replay fragmented tool-call JSON and inspect the partial value after each push.",
};

function Fold({ small = false }) {
  return (
    <span className={small ? "fold small" : "fold"} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export default function HomePage() {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header>
        <a className="brand" href="/" aria-label="Streamfold home">
          <Fold small />
          Streamfold
        </a>
        <nav aria-label="Resources">
          <a href={repo + "#readme"}>Docs</a>
          <a href={repo + "/blob/main/API.md"}>API</a>
          <a href={repo}>GitHub ↗</a>
        </nav>
      </header>
      <main id="main">
        <section className="hero">
          <div>
            <span className="label">Streamfold / Rust + Wasm</span>
            <h1>
              JSON, <em>as it arrives.</em>
            </h1>
            <p>Turn fragmented tool-call arguments into live JSON values, one chunk at a time.</p>
            <Install />
          </div>
          <div className="drawing" aria-hidden="true">
            <Fold />
          </div>
        </section>
        <Replay />
      </main>
      <footer>
        <span>assistant-ui / streamfold</span>
        <a href={repo + "/blob/main/LICENSE"}>MIT License ↗</a>
      </footer>
    </>
  );
}
