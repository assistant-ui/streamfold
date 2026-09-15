import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";
import "./tool-styles.css";

createRoot(document.getElementById("root")!).render(<App />);
