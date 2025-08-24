// src/components/Watermark.jsx
import React from "react";

/**
 * Bulletproof Watermark:
 * - Renders 3 fixed layers with inline styles (no CSS class dependency)
 * - Falls back to gradient text if the logo can't load
 * - Has a debug toggle (Alt+W) to outline layers and boost opacity while testing
 *
 * Place your logo at /public/skillnestlogo.png or pass a different URL via props.
 */
export default function Watermark({
  logo = "/skillnestlogo.png",
  show = true,
  corner = true,
  tile = true,
  textOverlay = true,

  // visibility knobs (you can tune later)
  cornerSize = 200,
  cornerOpacity = 0.18,
  tileOpacity = 0.10,
  text = "SkillNestEdu • © All Rights Reserved • You Matter",
  textOpacity = 0.14,
}) {
  const [imgOk, setImgOk] = React.useState(true);
  const [debug, setDebug] = React.useState(false);

  // Preload logo and detect 404
  React.useEffect(() => {
    if (!logo) { setImgOk(false); return; }
    const img = new Image();
    img.onload = () => setImgOk(true);
    img.onerror = () => setImgOk(false);
    img.src = logo;
  }, [logo]);

  // Alt+W toggles debug: outlines + higher opacity (for verification)
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.altKey && (e.key || "").toLowerCase() === "w") {
        setDebug((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!show) return null;

  const baseLayerStyle = {
    position: "fixed",
    inset: 0,
    pointerEvents: "none",
  };

  return (
    <>
      {/* ── Tiled logo layer ───────────────────────────────────────── */}
      {tile && imgOk && (
        <div
          aria-hidden
          style={{
            ...baseLayerStyle,
            zIndex: 20,
            backgroundImage: `url(${logo})`,
            backgroundRepeat: "repeat",
            backgroundPosition: "center",
            backgroundSize: "600px auto",
            opacity: debug ? 0.25 : tileOpacity,
            outline: debug ? "2px dashed #7c3aed" : "none",
          }}
        />
      )}

      {/* ── Diagonal text overlay ─────────────────────────────────── */}
      {textOverlay && (
        <div
          aria-hidden
          style={{
            ...baseLayerStyle,
            zIndex: 30,
            display: "grid",
            placeItems: "center",
            transform: "rotate(-25deg)",
            color: "#111827",
            fontWeight: 700,
            fontSize: 48,
            whiteSpace: "nowrap",
            userSelect: "none",
            opacity: debug ? 0.35 : textOpacity,
            outline: debug ? "2px dashed #22d3ee" : "none",
          }}
        >
          {text}
        </div>
      )}

      {/* ── Corner logo (falls back to brand text if img fails) ───── */}
      {corner && (imgOk ? (
        <img
          src={logo}
          alt=""
          aria-hidden
          style={{
            position: "fixed",
            right: 16,
            bottom: 16,
            width: cornerSize,
            height: "auto",
            zIndex: 40,          // header sits at 50; watermark stays below header
            opacity: debug ? 0.6 : cornerOpacity,
            pointerEvents: "none",
            outline: debug ? "2px dashed #111827" : "none",
          }}
          draggable={false}
        />
      ) : (
        <div
          aria-hidden
          style={{
            position: "fixed",
            right: 16,
            bottom: 16,
            zIndex: 40,
            opacity: debug ? 0.8 : 0.35,
            fontWeight: 800,
            color: "#111827",
            fontSize: 18,
            letterSpacing: 0.2,
            pointerEvents: "none",
            outline: debug ? "2px dashed #111827" : "none",
          }}
        >
          SkillNestEdu
        </div>
      ))}
    </>
  );
}
