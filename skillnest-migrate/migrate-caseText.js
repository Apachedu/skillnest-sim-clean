// migrate-caseText.js
// Usage examples:
//   node migrate-caseText.js --dry-run
//   node migrate-caseText.js --tier=premium --published
//   node migrate-caseText.js --tier=premium --limit=10
//
// Writes a backup file backups-caseText-<timestamp>.json

const fs = require("fs");
const admin = require("firebase-admin");

// Use GOOGLE_APPLICATION_CREDENTIALS or point directly to the key file
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});
const db = admin.firestore();

function parseCaseText(raw) {
  // Already an array -> normalize/trim
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x || "").trim()).filter(Boolean);
  }

  // Strings: try JSON first, then newline/sentence fallback
  if (typeof raw === "string") {
    let t = raw.trim();
    if (!t) return [];

    // Replace smart quotes that break JSON
    const smartFixed = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    if (
      (smartFixed.startsWith("[") && smartFixed.endsWith("]")) ||
      (smartFixed.startsWith("{") && smartFixed.endsWith("}"))
    ) {
      try {
        const j = JSON.parse(smartFixed);
        if (Array.isArray(j)) {
          return j.map((x) => String(x || "").trim()).filter(Boolean);
        }
        if (j && Array.isArray(j.paragraphs)) {
          return j.paragraphs.map((x) => String(x || "").trim()).filter(Boolean);
        }
      } catch {
        // fall through
      }
    }

    // If it looks like multiple lines, split by blank lines / newlines
    const byBlank = t.split(/\r?\n\r?\n+/).map((s) => s.trim()).filter(Boolean);
    if (byBlank.length > 1) return byBlank;

    const byLine = t.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (byLine.length > 1) return byLine;

    // Last resort: single paragraph
    return [t];
  }

  // Unknown/empty
  return null;
}

function getArg(flag, def = undefined) {
  const idx = process.argv.findIndex((a) => a.startsWith(`--${flag}`));
  if (idx === -1) return def;
  const eq = process.argv[idx].split("=");
  if (eq.length > 1) return eq[1];
  const nxt = process.argv[idx + 1];
  if (nxt && !nxt.startsWith("--")) return nxt;
  return true;
}

(async function main() {
  const tier = String(getArg("tier", "") || "").trim().toLowerCase(); // e.g. premium
  const published = !!getArg("published", false);
  const dryRun = !!getArg("dry-run", false);
  const limit = Number(getArg("limit", 0)) || 0; // for testing

  let q = db.collection("caseStudies");
  if (tier) q = q.where("accessTier", "==", tier);
  if (published) q = q.where("published", "==", true);

  console.log("▶ Querying caseStudies…", { tier: tier || "(any)", published, dryRun, limit });
  const snap = await q.get();
  console.log(`— found ${snap.size} docs`);

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = `backups-caseText-${ts}.json`;
  const backups = [];

  let processed = 0,
    changed = 0,
    skipped = 0,
    failed = 0;

  let batch = db.batch();
  let ops = 0;

  for (const docSnap of snap.docs) {
    processed++;
    const id = docSnap.id;
    const data = docSnap.data() || {};
    const raw = data.caseText;

    // Only touch if it's not already a decent array of strings
    const next = parseCaseText(raw);

    if (!next) {
      skipped++;
      continue;
    }

    const same =
      Array.isArray(raw) &&
      Array.isArray(next) &&
      JSON.stringify(raw.map(String)) === JSON.stringify(next.map(String));

    if (same) {
      skipped++;
    } else {
      backups.push({ id, before: raw });
      console.log(`✔ ${id}: update caseText -> ${next.length} paragraph(s)`);
      if (!dryRun) {
        batch.update(docSnap.ref, { caseText: next });
        ops++;
        changed++;
        if (ops >= 450) {
          await batch.commit();
          batch = db.batch();
          ops = 0;
        }
      } else {
        changed++;
      }
    }

    if (limit && changed >= limit) break;
  }

  if (!dryRun && ops > 0) await batch.commit();

  fs.writeFileSync(backupFile, JSON.stringify(backups, null, 2));
  console.log(`\n✅ Done. processed=${processed} changed=${changed} skipped=${skipped} failed=${failed}`);
  console.log(`🧷 Backup written to ${backupFile}`);
  if (dryRun) console.log("ℹ️ This was a dry run. Re-run without --dry-run to apply changes.");
})().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
