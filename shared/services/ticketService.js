// Amazon-style support tickets. Stored as chats/ticket_<id> (+ messages
// subcollection) so the existing permissive chats rules apply (no rules
// redeploy). Each ticket has a human ticket number, a category (used to
// route it to the right team), a subject, timestamps on every message,
// status + a 24h reopen window after close. One ACTIVE ticket per
// category per user; multiple categories allowed.
import {
  doc, setDoc, updateDoc, getDoc, collection, addDoc, query, where,
  orderBy, limit, onSnapshot, getDocs, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { sendPushToUser, sendPushToAdmins } from './pushService.js';
import { queueEmail } from './emailService.js';

async function featureFlag(name, def) {
  try {
    const s = await getDoc(doc(db, 'settings', 'features'));
    const d = s.exists() ? s.data() : {};
    return d[name] === undefined ? def : d[name];
  } catch (_) { return def; }
}
async function lookupEmail(uid) {
  try {
    const s = await getDoc(doc(db, 'users', uid));
    return s.exists() ? (s.data().email || '') : '';
  } catch (_) { return ''; }
}
async function alertAdminsTicket(title, body, route) {
  if ((await featureFlag('admin_notify_tickets', true)) === false) return;
  sendPushToAdmins({ title, body, data: { route: route || '/admin-tickets' } });
}

export const TICKET_CATEGORIES = [
  ['order', 'Order / Consultation', 'Orders Team'],
  ['payment', 'Payment / Wallet / Refund', 'Payments Team'],
  ['astrologer', 'Astrologer / Session quality', 'Quality Team'],
  ['technical', 'App / Technical issue', 'Tech Team'],
  ['account', 'Account / Profile', 'Accounts Team'],
  ['other', 'Something else', 'Support Team'],
];

// Categories shown to ASTROLOGERS (their tickets reach the same admin
// inbox, tagged role='astrologer').
export const ASTRO_TICKET_CATEGORIES = [
  ['customer', 'Customer / Session issue', 'Quality Team'],
  ['login', 'Login / Account access', 'Accounts Team'],
  ['error', 'App error / Bug', 'Tech Team'],
  ['technical', 'Technical / Payout issue', 'Tech Team'],
  ['issues', 'Other issue', 'Support Team'],
];

const ALL_CATEGORIES = [...TICKET_CATEGORIES, ...ASTRO_TICKET_CATEGORIES];

export function categoryLabel(cat) {
  return (ALL_CATEGORIES.find((c) => c[0] === cat) || [])[1] || cat;
}

export const SUPPORT_FAQS = [
  ['How do I get a refund?',
    'Open a ticket under "Payment / Wallet / Refund" with the order '
    + 'selected. Refunds are processed to the wallet within 24-48h.'],
  ['My call/chat dropped. Will I be charged?',
    'The first 40s of any drop is free and disconnected time is not '
    + 'billed. If you were over-charged, raise an Order ticket.'],
  ['How do I add money to the wallet?',
    'Open Wallet from the top bar, choose an amount and pay via UPI or '
    + 'card. Invoices appear in Order history.'],
  ['How long does an astrologer take to accept?',
    'Usually under a minute. If no one accepts, you are not charged.'],
  ['How do I become an astrologer?',
    'Use the Astrologer app to register; our team verifies and '
    + 'approves your profile.'],
];

const REOPEN_MS = 24 * 60 * 60 * 1000;
const ACTIVE = ['open', 'assigned', 'reopened'];

function teamFor(cat) {
  return (ALL_CATEGORIES.find((c) => c[0] === cat) || [])[2]
    || 'Support Team';
}
// 10-digit numeric ticket number. Displayed everywhere as
// "Ticket: #1234567890" so internal teams (dev / hr / support) can
// quote them aloud without spelling. Range 1e9..9.99e9 = 9 billion
// slots, ample for the lifetime of the platform; collisions are
// per-tick so we add millis to defuse a same-millisecond burst.
function genTicketNo() {
  const ms = Date.now() % 1_000_000_000;
  const rand = Math.floor(Math.random() * 1_000_000_000);
  // Concatenate then take a 10-digit window so even monotone seeds
  // never collapse on the same id.
  const n = String(ms + rand).padStart(10, '0').slice(-10);
  return n;
}
function millis(ts) {
  return ts && ts.toMillis ? ts.toMillis()
    : (typeof ts === 'number' ? ts : 0);
}

// A ticket can still be reopened if it was closed within 24h.
export function canReopen(t) {
  if (!t || t.status !== 'closed') return false;
  return Date.now() - millis(t.closedAt) <= REOPEN_MS;
}
// Fully (permanently) closed: closed and the 24h window has passed.
export function isFinalClosed(t) {
  return t && t.status === 'closed' && !canReopen(t);
}
export function isActive(t) {
  return t && (ACTIVE.includes(t.status) || canReopen(t));
}

async function myTicketsOnce(uid) {
  const s = await getDocs(query(collection(db, 'chats'),
    where('isTicket', '==', true), where('userId', '==', uid)));
  return s.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Returns the existing active ticket for this category, or null.
export async function activeTicketForCategory(uid, category) {
  const list = await myTicketsOnce(uid);
  return list.find((t) => t.category === category && isActive(t)) || null;
}

export async function createTicket(uid, data) {
  if (!uid) throw new Error('Please sign in.');
  const category = data.category || 'other';
  const dup = await activeTicketForCategory(uid, category);
  if (dup) {
    const e = new Error(
      `You already have an open ticket (${dup.ticketNo}) for `
      + `"${categoryLabel(category)}". Please continue on that ticket - `
      + 'you cannot open another one for the same issue until it is '
      + 'resolved.');
    e.code = 'DUPLICATE';
    e.ticketNo = dup.ticketNo;
    e.ticketId = dup.id;
    throw e;
  }
  const ticketNo = genTicketNo();
  const id = `ticket_${ticketNo}`;
  const email = data.email || await lookupEmail(uid);
  await setDoc(doc(db, 'chats', id), {
    isTicket: true,
    ticketNo,
    userId: uid,
    email,
    name: data.name || 'User',
    role: data.role || 'client',
    category,
    team: teamFor(category),
    subject: (data.subject || '').slice(0, 120) || 'Support request',
    orderRef: data.orderRef || '',
    status: 'open',
    lastMessage: (data.message || '').slice(0, 120),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await addDoc(collection(db, 'chats', id, 'messages'), {
    senderId: uid, role: 'user',
    text: String(data.message || '').slice(0, 2000),
    createdAt: serverTimestamp(),
  });
  sendPushToUser({
    toUid: uid,
    title: `Ticket ${ticketNo} created`,
    body: `We received your request. Our ${teamFor(category)} will `
      + 'reply here soon.',
    data: { type: 'ticket', route: '/support' },
  });
  alertAdminsTicket(
    `New ${data.role || 'client'} ticket ${ticketNo}`,
    `${data.name || 'User'}: ${(data.subject || '').slice(0, 60)}`);
  if (email) {
    queueEmail({
      to: email, kind: 'ticket_created', ticketId: id, ticketNo,
      vars: { ticketNo, subject: data.subject || 'Support request',
        name: data.name, category },
    });
  }
  return { id, ticketNo };
}

// Raise a ticket WITHOUT being signed in (e.g. an astrologer locked out
// of their account), keyed by their registered email. Always alerts the
// admin team; the ticket row persists when writes are permitted.
export async function createEmailTicket(email, data = {}) {
  const mail = String(email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(mail)) {
    const e = new Error('Enter a valid email.'); e.code = 'BADEMAIL';
    throw e;
  }
  const category = data.category || 'login';
  const ticketNo = genTicketNo();
  const id = `ticket_${ticketNo}`;
  let persisted = false;
  try {
    await setDoc(doc(db, 'chats', id), {
      isTicket: true,
      ticketNo,
      userId: `email:${mail}`,
      email: mail,
      name: data.name || mail,
      role: data.role || 'astrologer',
      category,
      team: teamFor(category),
      subject: (data.subject || '').slice(0, 120) || 'Account access',
      orderRef: '',
      status: 'open',
      lastMessage: (data.message || '').slice(0, 120),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await addDoc(collection(db, 'chats', id, 'messages'), {
      senderId: `email:${mail}`, role: 'user',
      text: String(data.message || '').slice(0, 2000),
      createdAt: serverTimestamp(),
    });
    persisted = true;
  } catch (_) { persisted = false; }
  alertAdminsTicket(
    `New ${data.role || 'astrologer'} ticket ${ticketNo}`,
    `${mail}: ${(data.subject || 'Account access').slice(0, 60)}`);
  queueEmail({
    to: mail, kind: 'ticket_created', ticketId: id, ticketNo,
    vars: { ticketNo, subject: data.subject || 'Account access',
      name: data.name || mail, category },
  });
  return { id, ticketNo, persisted };
}

export function listenMyTickets(uid, cb) {
  return onSnapshot(query(collection(db, 'chats'),
    where('isTicket', '==', true), where('userId', '==', uid)),
  (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => millis(b.updatedAt) - millis(a.updatedAt))));
}

export function listenTicket(id, cb) {
  return onSnapshot(query(
    collection(db, 'chats', id, 'messages'),
    orderBy('createdAt', 'asc'), limit(300)),
  (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export async function getTicket(id) {
  const s = await getDoc(doc(db, 'chats', id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

export async function sendTicketMessage(ticket, senderId, text, asAdmin) {
  const clean = String(text || '').trim();
  if (!ticket || !clean) return;
  const ref = doc(db, 'chats', ticket.id);
  // A user replying to a ticket closed within 24h reopens it; after
  // 24h it is permanently closed and they must open a new ticket.
  if (!asAdmin && ticket.status === 'closed' && !canReopen(ticket)) {
    const e = new Error(
      'This ticket was closed and the 24-hour reopen window has '
      + 'passed. Please open a new ticket.');
    e.code = 'CLOSED';
    throw e;
  }
  await addDoc(collection(db, 'chats', ticket.id, 'messages'), {
    senderId, role: asAdmin ? 'admin' : 'user',
    text: clean.slice(0, 2000),
    createdAt: serverTimestamp(),
  });
  const patch = {
    lastMessage: clean.slice(0, 120),
    updatedAt: serverTimestamp(),
  };
  if (asAdmin) patch.status = 'assigned';
  else if (ticket.status === 'closed') patch.status = 'reopened';
  await updateDoc(ref, patch);
  if (asAdmin) {
    sendPushToUser({
      toUid: ticket.userId,
      title: `Ticket ${ticket.ticketNo} - reply from support`,
      body: clean.slice(0, 120),
      data: { type: 'ticket', route: '/support' },
    });
    if (ticket.email) {
      queueEmail({
        to: ticket.email, kind: 'ticket_reply',
        ticketId: ticket.id, ticketNo: ticket.ticketNo,
        vars: { ticketNo: ticket.ticketNo, subject: ticket.subject,
          name: ticket.name, message: clean },
      });
    }
  } else {
    alertAdminsTicket(
      `Reply on ticket ${ticket.ticketNo}`,
      `${ticket.name || 'User'}: ${clean.slice(0, 60)}`);
  }
}

export async function closeTicket(ticket) {
  if (!ticket) return;
  await updateDoc(doc(db, 'chats', ticket.id), {
    status: 'closed',
    closedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  sendPushToUser({
    toUid: ticket.userId,
    title: `Ticket ${ticket.ticketNo} closed`,
    body: 'If this is not resolved you can reply within 24 hours to '
      + 'reopen it, otherwise please open a new ticket.',
    data: { type: 'ticket', route: '/support' },
  });
  if (ticket.email) {
    queueEmail({
      to: ticket.email, kind: 'ticket_closed',
      ticketId: ticket.id, ticketNo: ticket.ticketNo,
      vars: { ticketNo: ticket.ticketNo, subject: ticket.subject,
        name: ticket.name },
    });
  }
}

// Admin: all tickets, newest first.
export function listenAllTickets(cb) {
  return onSnapshot(query(collection(db, 'chats'),
    where('isTicket', '==', true)),
  (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => millis(b.updatedAt) - millis(a.updatedAt))));
}

// Admin lookup by ticket number OR customer (email/phone/code/uid/name).
export async function searchTickets(termRaw) {
  const term = String(termRaw || '').trim().toLowerCase();
  const s = await getDocs(query(collection(db, 'chats'),
    where('isTicket', '==', true)));
  const all = s.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!term) return all.sort((a, b) =>
    millis(b.updatedAt) - millis(a.updatedAt));
  return all.filter((t) => [t.ticketNo, t.userId, t.name, t.subject,
    t.email, t.phone, t.userCode]
    .some((v) => String(v || '').toLowerCase().includes(term)))
    .sort((a, b) => millis(b.updatedAt) - millis(a.updatedAt));
}
