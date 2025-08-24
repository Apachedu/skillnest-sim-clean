#!/usr/bin/env node
// Usage:
//   node bulkUpdateCaseText.js               # uses ./caseText.csv
//   node bulkUpdateCaseText.js my.csv        # specify file
//   node bulkUpdateCaseText.js my.csv --dry  # preview only

const fs = require("fs");
const path = require("path");

// csv-parse sync import (try both paths, versions differ)
let parse;
try { ({ parse } = require("csv-parse/sync")); }
catch { ({ parse } = require("csv-parse/lib/sync")); }

const admin = require("firebase-admin");

// ---- Firebase Admin (service account lives next to this script) ----
const keyPath = path.resolve(__dirname, "serviceAccount.json"); // << fixed
if (!fs.existsSync(keyPath)) {
  console.error(`Missing service account JSON at: ${keyPath}`);
  process.exit(1);
}
admin.initializeApp({
  credential: admin.credential.cert(require(keyPath)),
});
const db = admin.firestore();

// ---- Helpers ----
function toParagraphArray(raw) {
  if (raw == null) return [];
  const s = String(raw).trim();
  if (!s) return [];

  // If the cell already contains JSON like ["p1","p2",...]
  if ((s.startsWith("[") && s.endsWith("]")) || (s.startsWith("{") && s.endsWith("}"))) {
    try {
      const j = JSON.parse(s);
      if (Array.isArray(j)) return j.map(String);
    } catch { /* fall through */ }
  }

  // Otherwise split on literal \n\n sequences into paragraphs
  return s.split(/\n\n/g).map(p => p.trim()).filter(Boolean);
}

// ---- Main ----
(async () => {
  try {
    const csvPath = path.resolve(__dirname, process.argv[2] || "caseText.csv");
    const DRY = process.argv.includes("--dry");

    if (!fs.existsSync(csvPath)) {
      console.error(`CSV not found at: ${csvPath}`);
      process.exit(1);
    }

    const csvText = fs.readFileSync(csvPath, "utf8");
    const rows = parse(csvText, { columns: true, skip_empty_lines: true });

    let ok = 0, fail = 0;
    for (const row of rows) {
      const id = String(row.id || "").trim();
      const paras = toParagraphArray(row.caseText);

      if (!id) { fail++; console.warn("Skip row with empty id"); continue; }

      if (DRY) {
        console.log(`[DRY] would update ${id} with ${paras.length} paragraphs`);
        ok++;
        continue;
      }

      try {
        await db.doc(`caseStudies/${id}`).update({ caseText: paras });
        console.log(`✔ updated ${id} (${paras.length} paragraphs)`);
        ok++;
      } catch (e) {
        console.error(`✖ ${id}: ${e.message}`);
        fail++;
      }
    }

    console.log(`\nDone. Updated ${ok}, failed ${fail}.${DRY ? " (dry run)" : ""}`);
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
