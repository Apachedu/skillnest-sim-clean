import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
  signOut as fbSignOut,
} from "firebase/auth";
import { auth, db } from "../firebase/firebase";
import { doc, getDoc } from "firebase/firestore";

const AuthCtx = createContext(null);
export const useAuth = () => {
  const v = useContext(AuthCtx);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
};

export default function AuthProvider({ children }) {
  const [user, setUser]   = useState(null);
  const [ready, setReady] = useState(false);

  async function syncUserDoc(u) {
    try {
      if (!u) {
        localStorage.removeItem("sn_entitlements");
        localStorage.removeItem("sn_whitelist");
        return;
      }
      const snap = await getDoc(doc(db, "users", u.uid));
      const data = snap.exists() ? snap.data() : {};
      const ent  = data?.entitlements || { BASIC: false, PREMIUM: false };
      const wl   = Array.isArray(data?.caseWhitelist) ? data.caseWhitelist : [];
      localStorage.setItem("sn_entitlements", JSON.stringify(ent));
      localStorage.setItem("sn_whitelist", JSON.stringify(wl));
    } catch (e) {
      console.warn("Entitlement sync failed:", e);
    }
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u || null);
      await syncUserDoc(u);
      setReady(true);
    });
    return () => unsub();
  }, []);

  const value = useMemo(() => ({
    user,
    uid: user?.uid || null,
    ready,
    signInEmail: (email, password) => signInWithEmailAndPassword(auth, email, password),
    signUpEmail: (email, password) => createUserWithEmailAndPassword(auth, email, password),
    signInGuest: () => signInAnonymously(auth),
    signOut: () => fbSignOut(auth),
  }), [user, ready]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
