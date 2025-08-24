// src/App.jsx
import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import HomePage from "./HomePage";
import CaseStudyPage from "./CaseStudyPage";
import Unlock from "./Unlock";
import SiteHeader from "./components/SiteHeader.jsx";
import Watermark from "./components/Watermark.jsx";
import useAntiCopy from "./hooks/useAntiCopy.js";
import SignIn from "./pages/SignIn.jsx";

export default function App() {
  useAntiCopy();
  return (
    <BrowserRouter>
    <Watermark /> 
      <SiteHeader />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/case/:id" element={<CaseStudyPage />} />
        <Route path="/unlock" element={<Unlock />} />
        <Route path="/signin" element={<SignIn />} />
      </Routes>
    </BrowserRouter>
  );
}
