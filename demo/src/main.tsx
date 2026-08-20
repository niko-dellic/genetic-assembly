import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import { WorkspaceProvider } from "./app-state.js";
import "./styles.css";

createRoot(document.querySelector("#root")!).render(<StrictMode><WorkspaceProvider><App /></WorkspaceProvider></StrictMode>);
