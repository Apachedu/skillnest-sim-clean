// src/components/Watermark.jsx
import React from "react";

export default function Watermark({ diagonalLogo = true, textOverlay = true }) {
  const logoUrl = "/skillnestlogo.png"; // from /public

  return (
    <>
      {/* Bottom-right logo (clear + above content) */}
      <img
        src={logoUrl}
        alt="SkillNestEdu watermark"
        style={{
          position: "fixed",
          right: "1rem",
          bottom: "1rem",
          width: "220px",
          height: "auto",
          opacity: 0.18,           // make it more visible (tweak 0.12–0.25)
          pointerEvents: "none",
          zIndex: 999,
        }}
        aria-hidden="true"
      />

      {/* Optional diagonal tiled logo (very subtle) */}
      {diagonalLogo && (
        <div
          className="skn-bg-logo"
          style={{ backgroundImage: `url(${logoUrl})` }}
          aria-hidden="true"
        />
      )}

      {/* Optional faint diagonal text overlay */}
      {textOverlay && <div className="skn-screenshot-overlay" aria-hidden="true" />}
    </>
  );
}
