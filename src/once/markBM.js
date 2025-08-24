// src/once/markBM.js
import { doc, setDoc } from "firebase/firestore";
import { db } from "../firebase/firebase";

/**
 * Exposes a global function `sn_markBM()` so you can run it once
 * from the browser console.
 */
export function exposeBMTagger(w = window) {
  w.sn_markBM = async function () {
    const ids = [
      "bm-bike-001",
      "bm-ethics-001",
      "bm-leadership-001",
      "bm-motivation-001",
    ];
    const payload = { subject: "Business Management", accessTier: "hidden" };
    for (const id of ids) {
      try {
        await setDoc(doc(db, "caseStudies", id), payload, { merge: true });
        console.log("✅ Updated", id);
      } catch (e) {
        console.error("❌ Failed", id, e);
      }
    }
    console.log("Done.");
  };
}
