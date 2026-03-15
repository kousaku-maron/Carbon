import React from "react";
import ReactDOM from "react-dom/client";
import { carbonProseCss } from "@carbon/rendering";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import "./polyfills";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <style>{carbonProseCss}</style>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
