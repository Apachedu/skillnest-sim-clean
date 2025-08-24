// src/firebase/firebase.js
import { initializeApp } from 'firebase/app';
import { initializeFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyAifR2QGEN0ZZ3TLDMbPzM2zmWEdZHRS2k",
  authDomain: "skillnestcasestudysim-d6355.firebaseapp.com",
  projectId: "skillnestcasestudysim-d6355",
  storageBucket: "skillnestcasestudysim-d6355.appspot.com",
  messagingSenderId: "874264746569",
  appId: "1:874264746569:web:56fb675a374402373d7d98"
};

const app = initializeApp(firebaseConfig);

// 👇 Important: use long-polling (fixes 400 Listen / ERR_FAILED in some networks)
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  useFetchStreams: false,
});

export const auth = getAuth(app);
export const storage = getStorage(app);
