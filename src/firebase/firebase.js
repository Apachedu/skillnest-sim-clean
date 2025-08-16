// src/firebase/firebase.js
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth, signInAnonymously } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyAifR2QGEN0ZZ3TLDMbPzM2zmWEdZHRS2k",
  authDomain: "skillnestcasestudysim-d6355.firebaseapp.com",
  projectId: "skillnestcasestudysim-d6355",
  storageBucket: "skillnestcasestudysim-d6355.appspot.com",
  messagingSenderId: "874264746569",
  appId: "1:874264746569:web:56fb675a374402373d7d98"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Named exports
export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);

// (Optional) auto sign-in anonymously if you rely on request.auth in rules
if (!auth.currentUser) {
  signInAnonymously(auth).catch((e) => console.warn("Anon sign-in failed:", e?.message || e));
}
