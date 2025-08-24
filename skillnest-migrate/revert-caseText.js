// revert-caseText.js
// Usage: node revert-caseText.js backups-caseText-2025-08-22T…json

const fs = require("fs");
const admin = require("firebase-admin");

admin.initializeApp({ credential: admin.credential.applicationDefault() });
const db = admin.firestore();

(async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node revert-caseText.js <backup.json>");
    process.exit(1);
  }
  const rows = JSON.parse(fs.readFileSync(file, "utf8"));
  console.log(`Reverting ${rows.length} docs from ${file}…`);

  let batch = db.batch();
  let ops = 0;

  for (const row of rows) {
    const ref = db.collection("caseStudies").doc(row.id);
    batch.update(ref, { caseText: row.before });
    ops++;
    if (ops >= 450) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops) await batch.commit();
  console.log("✅ Revert complete.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
