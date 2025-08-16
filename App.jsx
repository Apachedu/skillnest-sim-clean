import React from "react";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import HomePage from "./HomePage.jsx";
import CaseStudyPage from "./CaseStudyPage.jsx";

export default function App() {
  console.log("✅ App.jsx loaded");
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/case/:id" element={<CaseStudyPage />} />
        <Route path="*" element={
          <div style={{padding:20}}>
            <p>Not found.</p>
            <Link to="/">Back home</Link>
          </div>
        } />
      </Routes>
    </BrowserRouter>
  );
}
