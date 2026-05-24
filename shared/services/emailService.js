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
      + `can also track it in the app.\n\n- AstroSeer Support`,
  }),
  ticket_reply: (v) => ({
    subject: `[Ticket ${v.ticketNo}] Reply from support`,
    body: `Hi ${v.name || 'there'},\n\n${v.message}\n\n`
      + `Ticket: ${v.ticketNo} (${v.subject})\n\n- AstroSeer Support`,
  }),
  ticket_closed: (v) => ({
    subject: `[Ticket ${v.ticketNo}] Closed`,
    body: `Hi ${v.name || 'there'},\n\nYour ticket ${v.ticketNo} `
      + `("${v.subject}") has been closed. If it is not resolved you `
      + `can reply within 24 hours to reopen it.\n\n`
      + `- AstroSeer Support`,
  }),
  astro_status: (v) => ({
    subject: `Astrologer ${v.name} is now ${v.status}`,
    body: `${v.name} (${v.uid}) changed availability to `
      + `${v.status} at ${new Date().toLocaleString()}.`,
  }),
  astro_application_received: (v) => ({
    subject: `[AstroSeer] Application received - reference ${v.token}`,
    body: `Hi ${v.name || 'there'},\n\n`
      + 'Thank you for applying to join AstroSeer as an astrologer. '
      + 'We have received your application and our recruitment team '
      + 'will review it shortly.\n\n'
      + `Your reference token: ${v.token}\n\n`
      + 'You can resume your onboarding (KYC, bank details, '
      + `declaration) at any time using this link:\n${v.onboardUrl}\n\n`
      + 'Next steps:\n'
      + '  1. Screening call by our recruitment team.\n'
      + '  2. KYC documents upload (PAN + Aadhaar).\n'
      + '  3. Bank details for payouts.\n'
      + '  4. Signed code-of-conduct declaration.\n'
      + '  5. Account approval and login credentials.\n\n'
      + 'If you have any questions, just reply to this email.\n\n'
      + '- AstroSeer Recruitment',
  }),
  astro_application_stage: (v) => ({
    subject: `[AstroSeer] Your application moved to "${v.stage}"`,
    body: `Hi ${v.name || 'there'},\n\n`
      + `Your astrologer application (token ${v.token}) is now in `
      + `the "${v.stage}" stage.\n\n`
      + (v.action
        ? `Action required from you:\n  ${v.action}\n\n`
          + `Continue onboarding: ${v.onboardUrl}\n\n`
        : '')
      + (v.note ? `Recruitment note:\n  ${v.note}\n\n` : '')
      + '- AstroSeer Recruitment',
  }),
  astro_application_approved: (v) => ({
    subject: '[AstroSeer] Welcome - your astrologer account is live',
    body: `Hi ${v.name || 'there'},\n\n`
      + 'Congratulations - your application has been approved and '
      + 'your AstroSeer astrologer account is now live.\n\n'
      + `Login email: ${v.email}\n`
      + `Temporary password: ${v.password}\n\n`
      + 'Please log in to the astrologer app, change your password '
      + 'immediately, and complete your profile.\n\n'
      + '- AstroSeer Recruitment',
  }),
  astro_application_rejected: (v) => ({
    subject: '[AstroSeer] Update on your application',
    body: `Hi ${v.name || 'there'},\n\n`
      + 'Thank you for your interest in joining AstroSeer. After '
      + 'careful review we are unable to take your application '
      + 'forward at this time.\n\n'
      + (v.note ? `Reason / feedback:\n  ${v.note}\n\n` : '')
      + 'You are welcome to re-apply in the future as our needs '
      + 'evolve.\n\n'
      + '- AstroSeer Recruitment',
  }),
  generic: (v) => ({
    subject: v.subject || 'AstroSeer update',
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
