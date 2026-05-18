// Email configuration + outbox.
//
// SMTP/IMAP credentials are stored in settings/email (admin-writable per
// rules). Browsers cannot open SMTP/IMAP sockets, so actual send/receive
// must be done by the push-relay (server). This service stores the
// config, renders templates, and writes every message to an outbox
// (chats/ with isEmailDoc - no rules redeploy) so the admin can see
// exactly what was/should be sent, tied to the ticket subject. The relay
// picks up 'queued' rows and flips them to 'sent'.
import {
  doc, getDoc, setDoc, collection, addDoc, query, where,
  onSnapshot, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase.js';

export async function getEmailConfig() {
  try {
    const s = await getDoc(doc(db, 'settings', 'email'));
    return s.exists() ? s.data() : {};
  } catch (_) { return {}; }
}

export async function saveEmailConfig(cfg) {
  await setDoc(doc(db, 'settings', 'email'), {
    ...cfg, updatedAt: serverTimestamp(),
  }, { merge: true });
}

// Built-in templates. kind -> (vars) -> { subject, body }.
const T = {
  ticket_created: (v) => ({
    subject: `[Ticket ${v.ticketNo}] ${v.subject}`,
    body: `Hi ${v.name || 'there'},\n\n`
      + `We have received your support request and created ticket `
      + `${v.ticketNo}.\n\nSubject: ${v.subject}\nCategory: `
      + `${v.category}\n\nOur team will reply here and by email. You `
      + `can also track it in the app.\n\n- AstroConnect Support`,
  }),
  ticket_reply: (v) => ({
    subject: `[Ticket ${v.ticketNo}] Reply from support`,
    body: `Hi ${v.name || 'there'},\n\n${v.message}\n\n`
      + `Ticket: ${v.ticketNo} (${v.subject})\n\n- AstroConnect Support`,
  }),
  ticket_closed: (v) => ({
    subject: `[Ticket ${v.ticketNo}] Closed`,
    body: `Hi ${v.name || 'there'},\n\nYour ticket ${v.ticketNo} `
      + `("${v.subject}") has been closed. If it is not resolved you `
      + `can reply within 24 hours to reopen it.\n\n`
      + `- AstroConnect Support`,
  }),
  astro_status: (v) => ({
    subject: `Astrologer ${v.name} is now ${v.status}`,
    body: `${v.name} (${v.uid}) changed availability to `
      + `${v.status} at ${new Date().toLocaleString()}.`,
  }),
  generic: (v) => ({
    subject: v.subject || 'AstroConnect update',
    body: v.body || '',
  }),
};

export function renderTemplate(kind, vars = {}) {
  return (T[kind] || T.generic)(vars);
}

// Queue an email into the outbox. Best effort, never throws.
export async function queueEmail({
  to, kind, vars, ticketId, ticketNo,
}) {
  try {
    if (!to) return;
    const { subject, body } = renderTemplate(kind, vars || {});
    await addDoc(collection(db, 'chats'), {
      isEmailDoc: true,
      to,
      kind: kind || 'generic',
      subject,
      body,
      ticketId: ticketId || '',
      ticketNo: ticketNo || '',
      status: 'queued',
      ts: Date.now(),
      createdAt: serverTimestamp(),
    });
  } catch (_) { /* ignore */ }
}

export function listenEmails(cb) {
  return onSnapshot(
    query(collection(db, 'chats'), where('isEmailDoc', '==', true)),
    (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))));
}
