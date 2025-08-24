import React from "react";
import { auth } from "./firebase/firebase";
import {
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
} from "firebase/auth";

const AuthCtx = React.createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = React.useState(null);
  React.useEffect(() => {
    const unsub = onAuthStateChanged(auth, setUser);
    return () => unsub();
  }, []);
  return <AuthCtx.Provider value={user}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  return React.useContext(AuthCtx);
}

export async function signInGoogle() {
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider);
}

export async function signOutUser() {
  await signOut(auth);
}
