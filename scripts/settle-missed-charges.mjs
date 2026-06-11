// Settle missed charges for a user whose chat session and kundli reports
// were never billed (billing bug: startTime was null so endAndSettle
// computed duration=0; prepaid kundli orders were never claimed).
//
// What this script does:
//  1. Finds the user by name or UID.
//  2. Scans their prepaid kundli orders (status: prepaid_generating /
//     prepaid_ready / prepaid) and collects the amounts that should have
//     been charged. Writes an atomic debit + marks each order as 'ready'.
//  3. Finds their zero-billed chat sessions (clientSettled=true, cost=0,
//     startTime non-null OR duration provided by --chat-minutes flag)
//     and debits the correct amount.
//
// Run (dry-run first):
//   node scripts/settle-missed-charges.mjs --name "Shaikh Abdul Mateen"
//   node scripts/settle-missed-charges.mjs --name "Shaikh Abdul Mateen" --apply
//   node scripts/settle-missed-charges.mjs --uid <UID> --chat-minutes 16 --apply
//
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] || true) : def;
}
function flag(name) { return process.argv.includes(`--${name}`); }

const KEY = 'D:/Projects/Astro/firebase-key.json';
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(readFileSync(KEY, 'utf8'))),
});
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const APPLY = flag('apply');
const targetUid = arg('uid', null);
const targetName = arg('name', null);
const chatMinutesOverride = arg('chat-minutes', null);

async function findUser() {
  if (targetUid) return targetUid;
  if (targetName) {
    const q = await db.collection('users')
      .where('name', '==', String(targetName).trim())
      .limit(5).get();
    if (q.empty) {
      // Try case-insensitive partial: fetch all and filter
      const all = await db.collection('users').limit(3000).get();
      const lower = String(targetName).trim().toLowerCase();
      const match = all.docs.find((d) =>
        (d.data().name || '').toLowerCase().includes(lower));
      if (!match) throw new Error(`No user found matching name "${targetName}"`);
      return match.id;
    }
    return q.docs[0].id;
  }
  throw new Error('Pass --uid <UID> or --name "<full name>"');
}

async function run() {
  const uid = await findUser();
  const userSnap = await db.collection('users').doc(uid).get();
  const user = userSnap.data() || {};
  console.log(`\nUser: ${user.name || '(unknown)'} | email: ${user.email || '-'}`);
  console.log(`UID: ${uid}`);
  console.log(`Current wallet: ₹${user.wallet || 0}`);
  console.log(`Mode: ${APPLY ? 'APPLY (real writes)' : 'DRY-RUN (no writes)'}\n`);

  let totalDebit = 0;

  // ── 1. KUNDLI PREPAID ORDERS ─────────────────────────────────────
  console.log('=== Kundli prepaid orders ===');
  const ordersSnap = await db.collection('users').doc(uid)
    .collection('orders').get();
  const prepaidOrders = ordersSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((o) => {
      const st = o.status || '';
      return (st.startsWith('prepaid') || st === 'prepaid_ready'
        || st === 'prepaid_generating' || st === 'prepaid')
        && Number(o.amount) > 0;
    });

  if (prepaidOrders.length === 0) {
    console.log('No unpaid prepaid kundli orders found.\n');
  } else {
    for (const o of prepaidOrders) {
      const price = Number(o.amount);
      console.log(`  Order ${o.id}: kind=${o.kind} status=${o.status} ` +
        `profile="${o.profileName || '-'}" amount=₹${price}`);
      totalDebit += price;

      if (APPLY) {
        await db.runTransaction(async (tx) => {
          const uRef = db.collection('users').doc(uid);
          const uSnap = await tx.get(uRef);
          const wallet = Number((uSnap.data() || {}).wallet || 0);
          if (wallet < price) {
            console.warn(`    WARN: wallet ₹${wallet} < price ₹${price} — ` +
              'debiting what is available');
          }
          const newWallet = Math.max(0, wallet - price);
          tx.update(uRef, {
            wallet: newWallet,
            updatedAt: FieldValue.serverTimestamp(),
          });
          // Mark order as ready (user now owns it)
          const orderRef = db.collection('users').doc(uid)
            .collection('orders').doc(o.id);
          tx.update(orderRef, {
            status: 'ready',
            amount: price,
            claimedAt: FieldValue.serverTimestamp(),
            claimedByScript: true,
          });
          // Ledger row
          const txRef = db.collection('transactions').doc();
          tx.set(txRef, {
            userId: uid,
            amount: -price,
            type: 'debit',
            reason: `kundli report (${o.kind || 'report'}) — settled by admin`,
            referenceId: o.id,
            createdAt: FieldValue.serverTimestamp(),
          });
          // Audit trail
          const auditRef = db.collection('users').doc(uid)
            .collection('walletAudit').doc();
          tx.set(auditRef, {
            before: wallet,
            delta: -price,
            after: newWallet,
            reason: `kundli order settle (${o.id})`,
            source: 'settle-missed-charges script',
            at: FieldValue.serverTimestamp(),
          });
        });
        console.log(`    APPLIED: ₹${price} debited, order marked ready.`);
      }
    }
    console.log();
  }

  // ── 2. ZERO-BILLED CHAT SESSIONS ─────────────────────────────────
  console.log('=== Zero-billed chat sessions ===');
  // Note: clientSettled may be undefined on older sessions — do NOT filter
  // by clientSettled. Only require: status=ended, cost=0, pricePerMinute>0.
  const sessSnap = await db.collection('sessions')
    .where('userId', '==', uid)
    .where('status', '==', 'ended')
    .get();

  const zeroCost = sessSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((s) => Number(s.cost || 0) === 0
      && Number(s.pricePerMinute || 0) > 0);

  if (zeroCost.length === 0 && !chatMinutesOverride) {
    console.log('No zero-billed paid sessions found.\n');
  } else {
    for (const s of zeroCost) {
      // Re-compute duration from stored startTime / endTime if available
      const startMs = s.startTime && s.startTime.toMillis
        ? s.startTime.toMillis()
        : (s.startTime && s.startTime.seconds
          ? s.startTime.seconds * 1000 : 0);
      const endMs = s.endTime && s.endTime.toMillis
        ? s.endTime.toMillis()
        : (s.endTime && s.endTime.seconds
          ? s.endTime.seconds * 1000 : 0);

      let durationSecs = 0;
      if (startMs > 0 && endMs > startMs) {
        durationSecs = Math.floor((endMs - startMs) / 1000);
      } else if (chatMinutesOverride) {
        durationSecs = Number(chatMinutesOverride) * 60;
      }

      const perMin = Number(s.pricePerMinute || 0);
      const billedMins = Math.ceil(durationSecs / 60);
      const cost = billedMins * perMin;

      console.log(`  Session ${s.id}: type=${s.type || 'chat'} ` +
        `astro=${s.astroId || '-'} ` +
        `startTime=${startMs ? new Date(startMs).toISOString() : 'NULL'} ` +
        `endTime=${endMs ? new Date(endMs).toISOString() : 'NULL'} ` +
        `duration=${durationSecs}s (${billedMins}min) ` +
        `rate=₹${perMin}/min cost=₹${cost}`);

      if (cost <= 0) {
        console.log('    SKIP: computed cost is ₹0 ' +
          '(no startTime and no --chat-minutes). ' +
          'Use --chat-minutes <N> to force a duration.');
        continue;
      }

      totalDebit += cost;
      if (APPLY) {
        await db.runTransaction(async (tx) => {
          const uRef = db.collection('users').doc(uid);
          const uSnap = await tx.get(uRef);
          const wallet = Number((uSnap.data() || {}).wallet || 0);
          const newWallet = Math.max(0, wallet - cost);
          tx.update(uRef, {
            wallet: newWallet,
            updatedAt: FieldValue.serverTimestamp(),
          });
          // Update session so admin panels show the corrected cost
          const sRef = db.collection('sessions').doc(s.id);
          tx.update(sRef, {
            cost,
            duration: durationSecs,
            settledByScript: true,
          });
          const txRef = db.collection('transactions').doc();
          tx.set(txRef, {
            userId: uid,
            amount: -cost,
            type: 'debit',
            reason: `${s.type || 'chat'} consultation ${billedMins}min ` +
              `— settled by admin (missing startTime fix)`,
            referenceId: s.id,
            createdAt: FieldValue.serverTimestamp(),
          });
          const auditRef = db.collection('users').doc(uid)
            .collection('walletAudit').doc();
          tx.set(auditRef, {
            before: wallet,
            delta: -cost,
            after: newWallet,
            reason: `chat session settle (${s.id})`,
            source: 'settle-missed-charges script',
            at: FieldValue.serverTimestamp(),
          });
        });
        console.log(`    APPLIED: ₹${cost} debited, session cost corrected.`);
      }
    }

    // Handle case where --chat-minutes was given but no matching session
    if (zeroCost.length === 0 && chatMinutesOverride) {
      console.log('  No ended zero-cost sessions found. ' +
        'If you know the session ID use --session-id to target it directly.');
    }
    console.log();
  }

  // ── SUMMARY ──────────────────────────────────────────────────────
  console.log('=== Summary ===');
  console.log(`Total to debit: ₹${totalDebit}`);
  if (!APPLY) {
    console.log('\nDRY-RUN complete. Re-run with --apply to commit the debits.');
  } else {
    const updatedSnap = await db.collection('users').doc(uid).get();
    const newWallet = (updatedSnap.data() || {}).wallet || 0;
    console.log(`Wallet after: ₹${newWallet}  (was ₹${user.wallet || 0})`);
    console.log('Done.');
  }
  process.exit(0);
}

run().catch((e) => { console.error('FATAL:', e.message || e); process.exit(1); });
