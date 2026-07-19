import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "~/assets/tailwind.css";
import { installActuationGlow } from "../../lib/actuation";
import { App } from "./App";

const container = document.getElementById("root");
if (!container) {
  throw new Error("TabBurrow dashboard: #root element not found");
}

installActuationGlow();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
