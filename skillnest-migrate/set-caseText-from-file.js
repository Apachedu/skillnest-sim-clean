// node set-caseText-from-file.js --id=econ-sugar-tax-001 --file=./sugar.txt
const fs = require("fs");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(require("./serviceAccount.json")) });
}
const db = admin.firestore();

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k,v] = a.replace(/^--/,"").split("=");
  return [k, v];
}));

(async () => {
  const { id, file } = args;
  if (!id || !file) {
    console.error("Usage: node set-caseText-from-file.js --id=<docId> --file=./file.txt");
    process.exit(1);
  }
  const raw = fs.readFileSync(file, "utf8");
  const parts = raw.split(/\r?\n\s*\r?\n/).map(s => s.trim()).filter(Boolean); // blank line = new paragraph
  if (!parts.length) {
    console.error("No paragraphs found in file (use blank lines to separate).");
    process.exit(1);
  }
  await db.collection("caseStudies").doc(id).update({
    caseText: parts,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`✅ Updated caseStudies/${id} caseText to ${parts.length} paragraphs.`);
})();
