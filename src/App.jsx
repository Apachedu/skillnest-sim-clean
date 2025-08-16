// src/App.jsx
import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import HomePage from "./HomePage.jsx";
import CaseStudyPage from "./CaseStudyPage.jsx";

// NEW: watermark + anti-copy
import Watermark from "./components/Watermark.jsx";
import useAntiCopy from "./hooks/useAntiCopy.js";

export default function App() {
  // Enable right-click / hotkey blocking globally
  useAntiCopy();

  return (
    <BrowserRouter>
      {/* Global wrapper so watermark overlays all pages */}
      <div className="min-h-dvh relative">
        {/* Persistently render branding + overlays site-wide */}
        <Watermark diagonalLogo={true} textOverlay={true} />

        {/* Your actual routes */}
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/case/:id" element={<CaseStudyPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
