import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import { exposeBMTagger } from "./once/markBM.js";
import AuthProvider from "./auth/AuthProvider.jsx";

exposeBMTagger(window);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
