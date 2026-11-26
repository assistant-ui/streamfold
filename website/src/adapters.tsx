const adapters = [
  ["OpenAI", "openai", "openai"],
  ["Anthropic", "anthropic", "anthropic"],
  ["Gemini", "googlegemini", "gemini"],
  ["Vercel AI SDK", "vercel", "vercel-ai"],
  ["Amazon Bedrock", "amazonwebservices", "bedrock"],
  ["LangChain", "langchain", "langchain"],
] as const;

export function Adapters() {
  return (
    <section className="adapters ruled" aria-labelledby="adapters-title">
      <div className="strip-head">
        <h2 id="adapters-title">Event adapters in v0.1.20</h2>
        <a href="https://github.com/assistant-ui/streamfold/blob/v0.1.20/INTEGRATIONS.md#event-adapters">
          All nine adapters <span aria-hidden="true">→</span>
        </a>
      </div>
      <ul className="adapter-grid">
        {adapters.map(([name, icon, subpath]) => (
          <li key={subpath}>
            <a
              href={`https://github.com/assistant-ui/streamfold/blob/v0.1.20/packages/core/src/${subpath}.d.ts`}
              title={`streamfold/${subpath}`}
            >
              <img src={`/adapters/${icon}.svg`} width="26" height="26" alt="" />
              <span>{name}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
