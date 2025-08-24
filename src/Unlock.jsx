// src/Unlock.jsx
import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { db } from "./firebase/firebase";
import { doc, getDoc } from "firebase/firestore";

const LS_KEY = "sn_entitlements";

function readEntitlements() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; }
  catch { return {}; }
}
function writeEntitlements(next) {
  const payload = { ...next, _ts: Date.now() };
  localStorage.setItem(LS_KEY, JSON.stringify(payload));
  return payload;
}
function clearEntitlements() {
  localStorage.removeItem(LS_KEY);
}

export default function Unlock() {
  const nav = useNavigate();
  const [code, setCode] = React.useState("");
  const [ent, setEnt] = React.useState(readEntitlements());
  const [msg, setMsg] = React.useState("");

  async function apply() {
    setMsg("");
    const raw = String(code || "").trim();
    if (!raw) { setMsg("Enter a code first."); return; }

    try {
      // Code doc id is the code string, e.g. "BASIC-XXXX" or "PREMIUM-XXXX"
      const snap = await getDoc(doc(db, "codes", raw));
      if (!snap.exists()) { setMsg("Invalid code."); return; }
      const data = snap.data() || {};

      if (data.active === false) { setMsg("This code is inactive."); return; }

      // Accept fields: { tier: "BASIC"|"PREMIUM" } or { type: ... }
      const tier = String(data.tier || data.type || "").toUpperCase();

      let next = { BASIC: false, PREMIUM: false };
      if (tier === "PREMIUM") {
        next = { BASIC: true, PREMIUM: true }; // premium implies basic
      } else if (tier === "BASIC") {
        next = { BASIC: true, PREMIUM: false };
      } else {
        setMsg("Code found but missing tier/type (BASIC or PREMIUM).");
        return;
      }

      setEnt(writeEntitlements(next));
      setMsg(`Unlocked: ${tier}.`);
    } catch (e) {
      setMsg(e.message || "Failed to verify code.");
    }
  }

  function grantDemoAll() {
    const next = { BASIC: true, PREMIUM: true, DEMO: true };
    setEnt(writeEntitlements(next));
    setMsg("Demo access granted.");
  }

  function doClear() {
    clearEntitlements();
    setEnt({});
    setMsg("Cleared.");
  }

  return (
    <div className="container">
      <h1 className="brand-heading" style={{ marginBottom: 8 }}>Unlock Access</h1>

      <div className="card" style={{ maxWidth: 480 }}>
        <div style={{ display:"flex", gap:8 }}>
          <input
            value={code}
            onChange={(e)=>setCode(e.target.value)}
            placeholder="Enter unlock code"
            className="input"
            style={{ flex:1 }}
          />
          <button className="btn" onClick={apply}>Apply</button>
        </div>

        <div style={{ display:"flex", gap:8, marginTop:10, flexWrap:"wrap" }}>
          <button className="btn--outline" onClick={grantDemoAll}>Grant DEMO (all)</button>
          <button className="btn--outline" onClick={doClear}>Clear</button>
          <button className="btn" onClick={()=>nav("/")}>Back to Home</button>
        </div>

        <div className="meta" style={{ marginTop:10 }}>
          Current: BASIC={<strong>{String(!!ent.BASIC)}</strong>} • PREMIUM={<strong>{String(!!ent.PREMIUM)}</strong>}
        </div>

        {msg && <div className="meta" style={{ marginTop:8 }}>{msg}</div>}
      </div>

      <div style={{ marginTop:16 }}>
        <Link to="/">← Back to Home</Link>
      </div>
    </div>
  );
}
