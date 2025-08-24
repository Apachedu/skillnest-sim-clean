import React, { useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";

export default function SignIn() {
  const { signInEmail, signUpEmail, signInGuest } = useAuth();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const nav = useNavigate();
  const loc = useLocation();
  const backTo = loc.state?.from || "/";

  async function run(action) {
    try {
      setErr(""); setBusy(true);
      await action();
      nav(backTo, { replace: true });
    } catch (e) {
      setErr(e?.message || "Failed.");
    } finally {
      setBusy(false);
    }
  }

  function validate() {
    const e = email.trim();
    if (!e) { setErr("Please enter your email."); return null; }
    if (!pw) { setErr("Please enter your password."); return null; }
    return { e, p: pw };
  }

  return (
    <div className="page-wrap">
      <Link to="/" className="back-link">← Back</Link>
      <div className="card" style={{ maxWidth: 460, margin: "0 auto" }}>
        <h2>Sign in</h2>
        <p className="meta" style={{ marginTop: -4 }}>
          Use email/password or continue as guest.
        </p>

        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            const v = validate(); if (!v) return;
            run(() => signInEmail(v.e, v.p));
          }}
        >
          <label className="meta" style={{ display: "block", marginTop: 10 }}>
            Email
          </label>
          <input
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onInput={(e) => setEmail(e.target.value)} // helps with autofill
            placeholder="you@example.com"
          />

          <label className="meta" style={{ display: "block", marginTop: 10 }}>
            Password
          </label>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onInput={(e) => setPw(e.target.value)} // helps with autofill
            placeholder="••••••••"
          />

          {err && <p style={{ color: "crimson" }}>{err}</p>}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <button className="btn" type="submit" disabled={busy}>
              {busy ? "Please wait…" : "Sign in"}
            </button>

            <button
              className="btn--outline"
              type="button"
              disabled={busy}
              onClick={() => {
                const e = email.trim();
                if (!e) return setErr("Please enter your email.");
                if (!pw) return setErr("Please enter your password (min 6 chars).");
                if (pw.length < 6) return setErr("Password must be at least 6 characters.");
                run(() => signUpEmail(e, pw));
              }}
            >
              Create account
            </button>

            <button
              className="btn--outline"
              type="button"
              disabled={busy}
              onClick={() => run(() => signInGuest())}
            >
              Continue as guest
            </button>
          </div>
        </form>

        <p className="meta" style={{ marginTop: 12 }}>
          After signing in, you can redeem an unlock code on the <Link to="/unlock">Unlock</Link> page.
        </p>
      </div>
    </div>
  );
}
