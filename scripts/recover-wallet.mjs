// Recover a user's wallet balance by summing all their transaction
// rows. Used when the wallet field drifts away from the truth (e.g.
// a buggy reset, a missed credit, an accidental wipe). Optional
// --apply flag actually writes the recovered value; without it the
// script just prints the diff.
//
// Run:
//   node scripts/recover-wallet.mjs --uid <UID>
//   node scripts/recover-wallet.mjs --uid <UID> --apply
//   node scripts/recover-wallet.mjs --email <email> --apply
//   node scripts/recover-wallet.mjs --all-mismatched   (audit every user)
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] || true) : def;
}
function flag(name) { return process.argv.includes(`--${name}`); }

const KEY = 'D:/Projects/Astro/firebase-key.json';
admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(readFileSync(KEY, 'utf8'))),
});
const db = admin.firestore();

async function resolveUid({ uid, email }) {
  if (uid) return String(uid);
  if (email) {
    const snap = await db.collection('users')
      .where('email', '==', String(email).trim().toLowerCase())
      .limit(1).get();
    if (snap.empty) throw new Error('no user found for that email');
    return snap.docs[0].id;
  }
  return null;
}

async function computeCorrectWallet(uid) {
  // Sum every transactions row for this user. Each transaction has a
  // signed amount: positive for credit (added to wallet), negative
  // for debit (already-negative amount), OR a type field saying
  // "credit" / "debit" with a positive amount that we sign in code.
  const snap = await db.collection('transactions')
    .where('userId', '==', uid)
    .get();
  let total = 0;
  // recRows accumulates the phantom reconciliation rows we wrote on
  // earlier runs - they are credits in the ledger but their delta
  // should NOT be counted toward the "real" balance (they cancel
  // out by definition). Same shape carries the doc IDs so the
  // caller can choose to delete them on apply.
  const recRows = [];
  const breakdown = { credits: 0, debits: 0, count: snap.size,
    reconciliationCount: 0 };
  snap.docs.forEach((d) => {
    const t = d.data() || {};
    const isReconciliation = (t.reason
      && /reconciliation|wallet[ _]recovery/i.test(t.reason))
      || t.referenceId === 'wallet_recovery';
    if (isReconciliation) {
      recRows.push({ id: d.id, ...t });
      breakdown.reconciliationCount += 1;
      return; // skip - do NOT count this row
    }
    const amt = Number(t.amount || 0);
    if (t.type === 'debit' || amt < 0) {
      const signed = amt < 0 ? amt : -Math.abs(amt);
      total += signed;
      breakdown.debits += -signed;
    } else {
      const signed = Math.abs(amt);
      total += signed;
      breakdown.credits += signed;
    }
  });
  return { total, breakdown, recRows };
}

async function recover({ uid, apply }) {
  const u = await db.collection('users').doc(uid).get();
  if (!u.exists) throw new Error(`user ${uid} not found`);
  const data = u.data();
  const currentWallet = Number(data.wallet || 0);
  const { total, breakdown, recRows } = await computeCorrectWallet(uid);
  const recovered = Math.max(0, total);
  const diff = recovered - currentWallet;
  console.log(`\nUser: ${data.name || ''} <${data.email || ''}>`);
  console.log(`  uid               : ${uid}`);
  console.log(`  current wallet    : Rs ${currentWallet}`);
  console.log(`  transactions      : ${breakdown.count}`
    + ` (credits Rs ${breakdown.credits}, debits Rs ${breakdown.debits}`
    + `, reconciliation rows skipped: ${breakdown.reconciliationCount})`);
  console.log(`  recovered wallet  : Rs ${recovered}`
    + ' (real credits - real debits, ignoring reconciliation rows)');
  console.log(`  diff              : ${diff >= 0 ? '+' : ''}Rs ${diff}`);
  const willCleanPhantoms = recRows.length > 0;
  if (!diff && !willCleanPhantoms) {
    console.log('  -> already correct, nothing to do');
    return { uid, currentWallet, recovered, diff };
  }
  if (apply) {
    // We DO NOT write a new "credit" transaction row anymore. Doing
    // so on a previous run is exactly what caused the inflation
    // (operator report 2026-06-06: "U have added the excess amount
    // in the wallet"). The reconciliation row was a real credit in
    // the ledger sum, so the next reconcile counted it again and
    // ballooned the balance. Fix: update wallet field directly and
    // log to walletAudit only. Also DELETE any phantom
    // reconciliation rows from prior buggy runs so the ledger UI
    // (UserTransactionsTab) no longer shows them as bogus credits.
    await db.runTransaction(async (tx) => {
      const ref = db.collection('users').doc(uid);
      const cur = await tx.get(ref);
      tx.update(ref, {
        wallet: recovered,
        walletRecoveredAt:
          admin.firestore.FieldValue.serverTimestamp(),
        walletRecoveredFrom: cur.data().wallet || 0,
      });
      // purge phantom reconciliation rows from prior runs
      for (const r of recRows) {
        tx.delete(db.collection('transactions').doc(r.id));
      }
      tx.set(db.collection('users').doc(uid)
        .collection('walletAudit').doc(), {
        before: currentWallet, delta: diff, after: recovered,
        phantomReconciliationRowsDeleted: recRows.length,
        reason: 'Wallet reconciliation script (v2 - no ledger row)',
        source: 'recover-wallet.mjs',
        at: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    console.log(`  -> APPLIED (deleted ${recRows.length} phantom`
      + ' reconciliation rows; audit logged; NO new ledger row)');
  } else {
    console.log(`  -> dry run (would delete ${recRows.length} phantom`
      + ' reconciliation rows; use --apply to write)');
  }
  return { uid, currentWallet, recovered, diff,
    phantomsRemoved: recRows.length };
}

async function auditAll(apply) {
  const snap = await db.collection('users').get();
  console.log(`Scanning ${snap.size} users for wallet mismatches...`);
  const mismatches = [];
  for (const d of snap.docs) {
    const r = await recover({ uid: d.id, apply });
    if (r.diff || (r.phantomsRemoved && r.phantomsRemoved > 0)) {
      mismatches.push(r);
    }
  }
  console.log(`\n${mismatches.length} mismatches found`
    + (apply ? ', all reconciled' : ' (dry run)'));
}

(async () => {
  if (flag('all-mismatched')) {
    return auditAll(flag('apply'));
  }
  const uid = await resolveUid({
    uid: arg('uid'), email: arg('email'),
  });
  if (!uid) {
    console.error('Pass --uid <UID> or --email <email>');
    process.exit(1);
  }
  await recover({ uid, apply: flag('apply') });
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
