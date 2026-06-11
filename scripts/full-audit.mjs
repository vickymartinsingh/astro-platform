// Full data audit: for every user check wallet vs transactions,
// sessions billed correctly, orders status vs transactions.
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(readFileSync('D:/Projects/Astro/firebase-key.json', 'utf8'))
  ),
});
const db = admin.firestore();

const [usersSnap, txnsSnap, sessSnap] = await Promise.all([
  db.collection('users').limit(5000).get(),
  db.collection('transactions').limit(10000).get(),
  db.collection('sessions').limit(5000).get(),
]);

const users = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }));
const txns  = txnsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
const sessions = sessSnap.docs.map(d => ({ id: d.id, ...d.data() }));

console.log(`Users: ${users.length}  Transactions: ${txns.length}  Sessions: ${sessions.length}\n`);

const issues = [];

for (const u of users) {
  const uid = u.uid;
  const walletActual = Number(u.wallet || 0);

  // Sum all credit - debit transactions for this user
  const userTxns = txns.filter(t => t.userId === uid);
  const txnBalance = userTxns.reduce((sum, t) => {
    const amt = Number(t.amount || 0);
    return sum + amt; // credits are +, debits are - (stored as negative)
  }, 0);

  const diff = Math.round((walletActual - txnBalance) * 100) / 100;

  // Sessions with cost > 0 but no matching debit transaction
  const userSess = sessions.filter(s => s.userId === uid && s.status === 'ended');
  const unbilledSessions = userSess.filter(s => {
    const cost = Number(s.cost || 0);
    if (cost <= 0) return false;
    const hasTxn = userTxns.some(t => t.referenceId === s.id && Number(t.amount || 0) < 0);
    return !hasTxn;
  });

  // Orders with status ready/paid_generating but no debit transaction
  const ordersSnap = await db.collection('users').doc(uid).collection('orders').get();
  const orders = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const unbilledOrders = orders.filter(o => {
    const st = o.status || '';
    if (st !== 'ready' && st !== 'paid_generating') return false;
    if (o.complimentary) return false;
    const price = Number(o.amount || 0);
    if (price <= 0) return false;
    const hasTxn = userTxns.some(t =>
      t.referenceId === o.id && Number(t.amount || 0) < 0
    );
    return !hasTxn;
  });

  const hasIssue = Math.abs(diff) > 0.5 || unbilledSessions.length > 0 || unbilledOrders.length > 0;
  if (hasIssue) {
    issues.push({ uid, name: u.name, email: u.email, walletActual, txnBalance, diff, unbilledSessions, unbilledOrders });
  }
}

if (issues.length === 0) {
  console.log('All users: wallet balances match transaction ledger. No issues found.');
} else {
  console.log(`Found ${issues.length} user(s) with discrepancies:\n`);
  for (const iss of issues) {
    console.log(`UID: ${iss.uid}  Name: ${iss.name}  Email: ${iss.email}`);
    console.log(`  wallet=₹${iss.walletActual}  txn_sum=₹${Math.round(iss.txnBalance*100)/100}  diff=₹${iss.diff}`);
    if (iss.unbilledSessions.length) {
      iss.unbilledSessions.forEach(s =>
        console.log(`  UNBILLED SESSION: ${s.id} cost=₹${s.cost} type=${s.type}`)
      );
    }
    if (iss.unbilledOrders.length) {
      iss.unbilledOrders.forEach(o =>
        console.log(`  UNBILLED ORDER: ${o.id} kind=${o.kind} amount=₹${o.amount} status=${o.status}`)
      );
    }
    console.log();
  }
}
process.exit(0);
