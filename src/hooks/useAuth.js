// src/hooks/useAuth.js
import { useEffect, useState } from "react";
import { auth } from "../firebase/firebase";
import {
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
} from "firebase/auth";

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const off = onAuthStateChanged(auth, (u) => { setUser(u); setLoading(false); });
    return () => off();
  }, []);
  return { user, loading };
}

// --- actions ---
export async function signInWithGoogle() {
  await setPersistence(auth, browserLocalPersistence);
  const prov = new GoogleAuthProvider();
  return signInWithPopup(auth, prov);
}

export async function emailSignIn(email, password) {
  await setPersistence(auth, browserLocalPersistence);
  return signInWithEmailAndPassword(auth, email, password);
}

export async function emailSignUp(email, password, displayName) {
  await setPersistence(auth, browserLocalPersistence);
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName) await updateProfile(cred.user, { displayName });
  return cred;
}

export function signOutUser() { return signOut(auth); }
