// Shared Admin SDK singleton. The Admin SDK bypasses Firestore rules, so
// these are the ONLY code paths allowed to mutate wallet / transactions.
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

module.exports = { admin, db, FieldValue };
