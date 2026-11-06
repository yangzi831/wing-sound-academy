import React from "react";
import ReactDOM from "react-dom/client";
import AcademyRoot from "./academy-ui";
import "./styles.css";
import "./visuals.css";
import "./cloud.css";
import "./academy.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AcademyRoot />
  </React.StrictMode>,
);
