import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RenderDevPage } from "./RenderDevPage";
import "../ui/styles/base.css";

// Scratch entry for dev.html (Vite multi-page). Not linked from index.html.
const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

createRoot(container).render(
  <StrictMode>
    <RenderDevPage />
  </StrictMode>,
);
