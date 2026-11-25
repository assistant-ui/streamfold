import "./globals.css";
import { Fold } from "../fold";
import { Install, Replay } from "../playground";

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
        <a className="brand" href="/" aria-label="Streamfold home">
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
          <Fold />
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
