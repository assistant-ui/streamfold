import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const port = Number(process.env.PORT ?? 4317);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const server = createServer((request, response) => {
  const requestPath = new URL(request.url, "http://127.0.0.1").pathname;
  const pathname =
    requestPath === "/"
      ? "/dashboard/index.html"
      : requestPath === "/results"
        ? "/artifacts/benchmark-results.json"
        : requestPath;
  const file = normalize(join(root, pathname));
  if (!file.startsWith(root)) {
    response.writeHead(403).end();
    return;
  }
  try {
    statSync(file);
    response.writeHead(200, {
      "content-type": types[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(readFileSync(file));
  } catch {
    response.writeHead(404).end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Streamfold dashboard: http://127.0.0.1:${port}`);
});
