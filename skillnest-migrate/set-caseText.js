// set-caseText.js
const admin = require("firebase-admin");
admin.initializeApp({
  credential: admin.credential.cert(require("./serviceAccount.json")),
});
const db = admin.firestore();

// Usage: node set-caseText.js --id=econ-healthcare-001
const arg = (name) => {
  const m = process.argv.find(a => a.startsWith(`--${name}=`));
  return m ? m.split("=").slice(1).join("=") : "";
};

const id = arg("id") || "econ-healthcare-001";

// ↓ paste your 4 lines here (exactly as you want them to appear)
const NEW_CASETEXT = [
  "A finance ministry considers a per-unit tax on sugary beverages to reduce obesity-related health costs and raise revenue.",
  "Market research suggests demand for branded colas is price-elastic in urban areas with many substitutes, but more inelastic in rural regions with limited alternatives.",
  "Retailers warn pass-through could differ between supermarkets and kirana shops; producers raise reformulation costs and timing.",
  "Public-health advocates expect lower sugar consumption if the tax is salient on shelf labels and paired with information campaigns.",
];

(async () => {
  try {
    const ref = db.collection("caseStudies").doc(id);
    const before = await ref.get();
    if (!before.exists) {
      console.error(`❌ No such caseStudies/${id}`);
      process.exit(2);
    }
    await ref.update({ caseText: NEW_CASETEXT });
    console.log(`✅ Updated caseStudies/${id} caseText to ${NEW_CASETEXT.length} lines.`);
    process.exit(0);
  } catch (e) {
    console.error("❌ Update failed:", e.message);
    process.exit(1);
  }
})();
