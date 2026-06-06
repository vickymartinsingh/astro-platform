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
    subject: `[AstroSeer] Application received - token ${v.token}`,
    body: `Hi ${v.name || 'there'},\n\n`
      + 'Thank you for applying to join AstroSeer as an astrologer. '
      + 'We have received your application and our recruitment team '
      + 'will review it shortly.\n\n'
      + `Your 6-digit tracking token: ${v.token}\n\n`
      + 'Track your application status any time at:\n'
      + `  ${v.trackingUrl}\n`
      + '(Enter your registered email + this token.)\n\n'
      + 'Resume your onboarding (KYC, bank details, declaration) '
      + `at any time using this link:\n${v.onboardUrl}\n\n`
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
  // Polished kundli report delivery email. Both auto-send (first
  // generation) and admin "Resend via email" share this template.
  // `v.attachmentName` is the PDF filename so the body can name it;
  // the actual base64/PDF bytes are attached server-side in the relay
  // when v.pdfBase64 / v.pdfUrl is present.
  kundli_report_ready: (v) => {
    const name = (v && v.name) || 'there';
    const profileName = (v && v.profileName) || '';
    const kindLabel = (v && v.kindLabel) || 'Vedic Kundli Report';
    const ordersUrl = (v && v.ordersUrl) || 'https://astroseer.in/orders';
    const subject = `Your ${kindLabel} is ready`
      + (profileName ? ` - ${profileName}` : '');
    const text = `Namaste ${name},\n\n`
      + `Your ${kindLabel}${profileName
        ? ` for ${profileName}` : ''} is ready and attached to `
      + 'this email as a PDF.\n\n'
      + 'Inside you will find:\n'
      + '  • Birth, Avakhada and Panchang details\n'
      + '  • Lagna chart and 16 divisional charts\n'
      + '  • Planetary positions, nakshatras and dignities\n'
      + '  • Full Vimshottari dasha tree and current periods\n'
      + '  • Yogas, doshas and ascendant analysis\n\n'
      + `You can also re-download or view this report from your `
      + `Orders any time: ${ordersUrl}\n\n`
      + 'If a particular life area calls for a deeper look, our '
      + 'astrologers are one tap away on the AstroSeer app.\n\n'
      + 'With blessings,\n'
      + 'Team AstroSeer\n'
      + 'support@astroseer.in · astroseer.in';
    const html = renderHtmlEmail({
      preheader: `Your ${kindLabel} is attached to this email.`,
      heading: `Your ${kindLabel} is ready`,
      lead: `Namaste ${escapeHtml(name)}, your `
        + `${escapeHtml(kindLabel)}${profileName
          ? ` for <b>${escapeHtml(profileName)}</b>` : ''} is ready `
        + 'and attached to this email as a PDF.',
      bullets: [
        'Birth, Avakhada and Panchang details',
        'Lagna chart and 16 divisional charts',
        'Planetary positions, nakshatras and dignities',
        'Full Vimshottari dasha tree and current periods',
        'Yogas, doshas and ascendant analysis',
      ],
      ctaLabel: 'View in My Orders',
      ctaUrl: ordersUrl,
      footnote: 'If a particular life area calls for a deeper look, '
        + 'our astrologers are one tap away on the AstroSeer app.',
    });
    return { subject, body: text, html };
  },
  // Same body as the ready template but the subject + opening line
  // make it clear this is a re-send (so customer isn't confused into
  // thinking they were charged twice).
  kundli_report_resend: (v) => {
    const base = T.kundli_report_ready(v);
    return {
      subject: `Re-sending: ${base.subject}`,
      body: `Hi ${(v && v.name) || 'there'},\n\n`
        + 'As requested, we are re-sending your kundli report. '
        + 'No additional charge has been applied.\n\n'
        + base.body,
      html: base.html
        .replace('Namaste',
          'As requested, we are re-sending your kundli report '
          + '(no additional charge has been applied).<br/><br/>Namaste'),
    };
  },
  generic: (v) => ({
    subject: v.subject || 'AstroSeer update',
    body: v.body || '',
    html: v.html || '',
  }),
};

// Tiny helper that escapes any HTML-sensitive characters in user
// supplied strings before we drop them into the template.
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Brand-safe HTML email skeleton with a polished AstroSeer signature
// at the bottom. Inline styles only (most email clients strip
// <style> blocks and external CSS). Keep the markup boring so
// Gmail / Outlook / Apple Mail all render the same.
export function renderHtmlEmail({
  preheader = '', heading = '', lead = '', bullets = [],
  ctaLabel = '', ctaUrl = '', footnote = '',
}) {
  const bulletHtml = bullets.length === 0 ? '' : (
    '<ul style="margin:16px 0;padding-left:20px;color:#1A1A2E;'
    + 'font-size:14px;line-height:1.65">'
    + bullets.map((b) =>
      `<li style="margin:4px 0">${escapeHtml(b)}</li>`).join('')
    + '</ul>');
  const ctaHtml = (!ctaLabel || !ctaUrl) ? '' : (
    '<div style="margin:24px 0;text-align:center">'
    + `<a href="${escapeHtml(ctaUrl)}" `
    + 'style="display:inline-block;padding:12px 28px;border-radius:'
    + '999px;background:#7F2020;color:#ffffff;text-decoration:none;'
    + `font-weight:700;font-size:14px">${escapeHtml(ctaLabel)}</a>`
    + '</div>');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(heading || 'AstroSeer')}</title></head>
<body style="margin:0;padding:0;background:#F5F1EA;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,
  Helvetica,Arial,sans-serif;color:#1A1A2E">
<span style="display:none!important;visibility:hidden;opacity:0;
  height:0;width:0;overflow:hidden">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0"
  cellspacing="0" style="background:#F5F1EA"><tr><td align="center"
  style="padding:24px 12px">
  <table role="presentation" width="600"
    style="max-width:600px;background:#ffffff;border-radius:16px;
    overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.06)">
  <tr><td style="background:linear-gradient(135deg,#7F2020,#A52A2A);
    padding:28px 32px;color:#ffffff">
    <div style="font-size:13px;letter-spacing:2px;text-transform:
      uppercase;opacity:.85">AstroSeer</div>
    <h1 style="margin:6px 0 0 0;font-size:22px;line-height:1.3">
      ${escapeHtml(heading)}</h1>
  </td></tr>
  <tr><td style="padding:28px 32px">
    <p style="margin:0;font-size:15px;line-height:1.6;color:#1A1A2E">
      ${lead}
    </p>
    ${bulletHtml}
    ${ctaHtml}
    ${footnote ? `<p style="margin:16px 0 0 0;font-size:13px;`
      + `line-height:1.6;color:#555">${escapeHtml(footnote)}</p>`
      : ''}
  </td></tr>
  <tr><td style="border-top:1px solid #F0E9D9;padding:20px 32px;
    background:#FBF7EE;font-size:12px;line-height:1.6;color:#4A4A55">
    <div style="font-weight:700;color:#7F2020;font-size:13px;
      margin-bottom:4px">Team AstroSeer</div>
    <div>Vedic astrology, kundli, tarot &amp; consultations</div>
    <div style="margin-top:8px">
      <a href="https://astroseer.in"
        style="color:#7F2020;text-decoration:none">astroseer.in</a>
      &nbsp;·&nbsp;
      <a href="mailto:support@astroseer.in"
        style="color:#7F2020;text-decoration:none">support@astroseer.in</a>
    </div>
    <div style="margin-top:10px;color:#999">
      You received this because you have an account or active order
      with AstroSeer. To stop, reply with "unsubscribe".
    </div>
  </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

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

// Best-effort generic send via the relay. We piggy-back on the same
// /api/emailOtp endpoint (using action: 'send') instead of a separate
// /api/sendEmail route, because Vercel Hobby caps the project at 12
// serverless functions. The relay also writes an audit row into
// chats/{id} (kind, to, subject, status) so the admin email log can
// show what was actually delivered vs. queued.
//
// Returns the relay's JSON ({ ok, messageId, ... }) or throws on
// HTTP error / SMTP failure. Caller decides how to surface that.
function sendEmailEndpoint() {
  const push = (typeof process !== 'undefined' && process.env
    && process.env.NEXT_PUBLIC_PUSH_ENDPOINT) || '';
  // Same endpoint as the OTP request/verify path. The action field
  // routes the call inside the handler.
  return push ? push.replace(/\/sendPush\/?$/, '/emailOtp')
    : 'https://astro-platform-push-relay.vercel.app/api/emailOtp';
}
export async function sendEmail({
  to, kind, vars, attachment, subject, html, text, bcc,
}) {
  const body = { action: 'send', to, kind, vars };
  if (subject) body.subject = subject;
  if (html) body.html = html;
  if (text) body.text = text;
  if (attachment) body.attachment = attachment;
  // Optional BCC list from the caller. The previously hard-coded
  // compliance BCC (vickymartinsingh@outlook.com) has been REMOVED
  // from the relay - it now only honours admin-configured BCC. This
  // array (typically read by callers from settings/config.bcc_emails
  // via the admin's /admin-reports BCC editor) is the ONLY way a
  // BCC address gets attached to outgoing mail.
  if (Array.isArray(bcc) && bcc.length > 0) {
    body.bcc = bcc.map((e) => String(e).trim()).filter(Boolean);
  }
  const r = await fetch(sendEmailEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error
    || `Email send failed (HTTP ${r.status}).`);
  return j;
}

export function listenEmails(cb) {
  return onSnapshot(
    query(collection(db, 'chats'), where('isEmailDoc', '==', true)),
    (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))));
}
