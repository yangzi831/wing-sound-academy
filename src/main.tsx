import React from "react";
import ReactDOM from "react-dom/client";
import CloudApp from "./cloud-ui";
import "./styles.css";
import "./visuals.css";
import "./cloud.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <CloudApp />
  </React.StrictMode>,
);
