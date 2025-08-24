// smoke-test.js
const admin = require("firebase-admin");
admin.initializeApp({
  credential: admin.credential.cert(require("./serviceAccount.json")),
});
const db = admin.firestore();

(async () => {
  try {
    const snap = await db.collection("caseStudies").limit(1).get();
    console.log(`OK: connected. Found ${snap.size} caseStudy doc(s).`);
    snap.forEach(d => console.log("Sample doc id:", d.id));
    process.exit(0);
  } catch (e) {
    console.error("❌ Firestore admin failed:", e.message);
    process.exit(1);
  }
})();
