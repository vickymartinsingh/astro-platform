import { useState } from 'react';
import { emailService } from '@astro/shared';

// "Send to email" popup used on /orders. Customer types (or accepts
// the prefilled) recipient address, hits Send, and the PDF is
// shipped as an attachment via the relay's /api/emailOtp send
// action - same SMTP path the OTP + welcome mail use, so there is
// no second mail server to wire up. On success the modal flips to
// a green "Email sent successfully" panel.
//
// The PDF bytes are pulled inline (fetch -> blob -> base64) so this
// works for both pdfBase64 orders (already inline) and cloud-stored
// orders (signed URL). Vercel Hobby caps the request body at 4.5
// MB; if the encoded PDF is larger we fall back to sending a
// link-only mail without attachment (still successful, the customer
// gets the file).
async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('FileReader failed'));
    r.onload = () => {
      const s = String(r.result || '');
      const idx = s.indexOf(',');
      resolve(idx >= 0 ? s.slice(idx + 1) : s);
    };
    r.readAsDataURL(blob);
  });
}

export default function SendPdfByEmailModal({ order, defaultEmail,
  onClose }) {
  const [to, setTo] = useState(defaultEmail || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);

  async function resolvePdfBase64() {
    if (order && order.pdfBase64) {
      return { contentBase64: order.pdfBase64,
        filename: order.pdfName || 'AstroSeer-Kundli.pdf' };
    }
    const url = order && order.pdfUrl && order.pdfUrl !== 'inline'
      ? order.pdfUrl : '';
    if (!url) return null;
    try {
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const blob = await resp.blob();
      // 4.5 MB safety (Vercel body cap). 1 base64 byte ~= 0.75 binary
      // byte so we compare against 3.3 MB of raw PDF.
      if (blob.size > 3.3 * 1024 * 1024) return { tooLarge: true, url };
      const b64 = await blobToBase64(blob);
      return { contentBase64: b64,
        filename: order.pdfName || 'AstroSeer-Kundli.pdf' };
    } catch (_) { return null; }
  }

  async function send() {
    setErr('');
    const t = (to || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) {
      setErr('Enter a valid email address.'); return;
    }
    setBusy(true);
    try {
      const att = await resolvePdfBase64();
      const url = order.pdfUrl && order.pdfUrl !== 'inline'
        ? order.pdfUrl : '';
      // Plain-text fallback (renders if HTML disabled).
      const text = `Hi,\n\nYour AstroSeer report${
        order.kind ? ` (${order.kind})` : ''} is attached.${
        url ? `\n\nDirect download link: ${url}` : ''}\n\n`
        + 'Order ID: ' + (order.id || '–') + '\n\n'
        + 'Thank you for choosing AstroSeer.';
      const html = `<div style="font-family:Arial,sans-serif;`
        + `font-size:14px;color:#222;line-height:1.5">`
        + `<p>Hi,</p>`
        + `<p>Your AstroSeer report is attached to this email`
        + (url ? ` and also available at <a href="${url}">this link</a>` : '')
        + `.</p>`
        + `<p><b>Order:</b> ${order.id || '–'}<br>`
        + `<b>Report:</b> ${order.kind || '–'}</p>`
        + `<p>Thank you for choosing AstroSeer.</p>`
        + `</div>`;
      const payload = {
        to: t,
        subject: 'Your AstroSeer Kundli Report',
        text, html,
      };
      if (att && !att.tooLarge) {
        payload.attachment = {
          filename: att.filename,
          contentType: 'application/pdf',
          contentBase64: att.contentBase64,
        };
      }
      await emailService.sendEmail(payload);
      setSent(true);
    } catch (e) {
      setErr(String((e && e.message) || e));
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[2147483646] flex items-center
      justify-center bg-black/55 p-4"
      role="dialog" aria-modal="true" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl
        bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {sent ? (
          <div className="p-6 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center
              rounded-full bg-emerald-100 text-emerald-700">
              <svg width="22" height="22" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="3"
                strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h3 className="mt-3 text-lg font-bold text-dark-text">
              Email sent successfully
            </h3>
            <p className="mt-1 text-sm text-sub-text">
              Your report has been delivered to{' '}
              <b className="text-dark-text">{to}</b>. Check the inbox
              (and Spam folder if it does not appear in a minute).
            </p>
            <button onClick={onClose}
              className="mt-4 rounded-full bg-primary px-5 py-2
                text-sm font-bold text-white">
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="bg-primary px-5 py-4 text-white">
              <div className="text-[11px] font-bold uppercase
                tracking-widest opacity-80">
                Send report
              </div>
              <h3 className="mt-0.5 text-lg font-bold">
                Email this PDF
              </h3>
            </div>
            <div className="space-y-3 p-5">
              <p className="text-xs text-sub-text">
                We will email a copy of <b>{order.pdfName
                  || 'this report'}</b> to the verified email on your
                account. This is locked to your own address so paid
                reports are not forwarded to unverified third parties.
              </p>
              <label className="block">
                <span className="text-xs font-semibold text-sub-text">
                  Recipient email
                </span>
                {/* Locked field: customers can only ship the PDF to
                    the verified email on their own account. Keeps
                    paid reports off the open internet via this
                    convenience modal. Customer-care can still relay
                    a copy from admin if a genuine re-target is
                    needed. */}
                <input type="email" value={to}
                  readOnly disabled
                  className="input mt-1 w-full cursor-not-allowed
                    bg-bg-light text-sub-text"
                  aria-readonly="true" />
                <div className="mt-1 flex items-center gap-1
                  text-[10px] font-semibold text-sub-text">
                  <svg width="11" height="11" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="2.4"
                    strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11"
                      rx="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  Locked to your verified account email
                </div>
              </label>
              {err && (
                <div className="rounded-card bg-danger/10 px-3 py-2
                  text-xs font-semibold text-danger">
                  {err}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={onClose} disabled={busy}
                  className="rounded-full bg-bg-light px-4 py-2
                    text-sm font-semibold">
                  Cancel
                </button>
                <button onClick={send} disabled={busy}
                  className="rounded-full bg-primary px-5 py-2
                    text-sm font-bold text-white disabled:opacity-60">
                  {busy ? 'Sending...' : 'Send email'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
