// Notify a user whenever their wallet changes (credit OR debit) so both
// clients and astrologers get an in-app notification AND a push, giving
// them a clear money trail. Kept in its own module so there is no
// circular import with pushService.
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase.js';
import { sendPushToUser } from './pushService.js';

export async function notifyWallet(uid, amount, reason) {
  const amt = Number(amount);
  if (!uid || !amt) return;
  const credit = amt >= 0;
  const abs = Math.abs(amt);
  const human = reason || (credit ? 'credit' : 'debit');
  const title = credit ? 'Money added to your wallet'
    : 'Amount debited from your wallet';
  const body = credit
    ? `+ Rs ${abs} added to your wallet (${human}).`
    : `- Rs ${abs} debited from your wallet (${human}).`;
  try {
    await addDoc(collection(db, 'notifications'), {
      userId: uid,
      title,
      message: body,
      type: 'wallet',
      read: false,
      createdAt: serverTimestamp(),
    });
  } catch (_) { /* never block the wallet write on the notification */ }
  try {
    await sendPushToUser({
      toUid: uid,
      title,
      body,
      data: { type: 'wallet', route: '/transactions' },
    });
  } catch (_) {}
}
