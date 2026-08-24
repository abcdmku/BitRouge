import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import "./ui/palette.generated.css";
import "./ui/styles/base.css";
import "./ui/styles/theme.css";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
