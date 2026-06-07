import { useState } from 'react';
import { ticketService, storage } from '@astro/shared';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

// Per-entity support ticket modal (2026-06-07 spec).
//
// Caller passes the entity context:
//   kind:        'order' | 'session' | 'payment' (drives issue list)
//   refId:       the orderId / sessionId / paymentId
//   refLabel:    short human label ("Lifetime Report - Order 99576065")
//   open:        boolean
//   onClose:     close handler
//   user:        { uid, profile } so we can stamp name/email on the ticket
//
// The modal builds a ticket via ticketService.createLinkedTicket which
// SKIPS the single-active-per-category guard - so a customer can raise
// one ticket per order without being blocked by an unrelated open one.
//
// Screenshot upload: Firebase Storage path
//   ticketScreenshots/{uid}/{timestamp}_{filename}
// Optional. Single image, up to 5 MB. If the upload fails we still
// allow ticket creation (without a screenshot) and surface a soft
// note - the user shouldn't lose their typed description because the
// network blipped on the image.

const ISSUES_BY_KIND = {
  order: [
    ['pdf_not_received', 'PDF not received'],
    ['wrong_content', 'Wrong content in the report'],
    ['quality', 'Report quality / accuracy issue'],
    ['refund', 'Refund request for this order'],
    ['duplicate_charge', 'Charged twice for this order'],
    ['other', 'Something else'],
  ],
  session: [
    ['no_connect', 'Astrologer did not connect'],
    ['poor_quality', 'Call / chat quality issue'],
    ['short_session', 'Session ended too soon'],
    ['wrong_charge', 'Charged incorrectly for this session'],
    ['behaviour', 'Astrologer behaviour / conduct'],
    ['refund', 'Refund request for this session'],
    ['other', 'Something else'],
  ],
  payment: [
    ['not_credited', 'Recharge not credited to wallet'],
    ['double_charge', 'Card charged twice for one recharge'],
    ['refund_status', 'Refund status / not received'],
    ['other', 'Something else'],
  ],
};

function categoryForKind(kind) {
  if (kind === 'payment') return 'payment';
  if (kind === 'session') return 'astrologer';
  return 'order';
}

export default function SupportTicketModal({
  kind, refId, refLabel, open, onClose, user,
}) {
  const [issueCode, setIssueCode] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');

  const issues = ISSUES_BY_KIND[kind] || ISSUES_BY_KIND.order;
  const refField = kind === 'session' ? 'sessionRef'
    : kind === 'payment' ? 'paymentRef' : 'orderRef';

  function reset() {
    setIssueCode(''); setDescription(''); setFile(null);
    setErr(''); setOkMsg(''); setBusy(false);
  }
  function close() {
    if (busy) return;
    reset();
    if (onClose) onClose();
  }

  function pickIssue(code) {
    setIssueCode(code);
    setErr('');
  }
  function pickFile(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) { setFile(null); return; }
    if (!/^image\//.test(f.type)) {
      setErr('Screenshot must be a PNG or JPG image.');
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setErr('Screenshot is larger than 5 MB. Please crop or compress.');
      return;
    }
    setErr('');
    setFile(f);
  }

  async function uploadScreenshot() {
    if (!file || !user || !user.uid) return '';
    try {
      const safeName = String(file.name || 'screenshot')
        .replace(/[^a-zA-Z0-9.\-_]/g, '_').slice(0, 80);
      const path = `ticketScreenshots/${user.uid}/`
        + `${Date.now()}_${safeName}`;
      const sref = ref(storage, path);
      await uploadBytes(sref, file, { contentType: file.type });
      return await getDownloadURL(sref);
    } catch (e) {
      // Soft failure: ticket can still be created without screenshot.
      return '';
    }
  }

  async function submit(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!user || !user.uid) {
      setErr('Please sign in to raise a support ticket.'); return;
    }
    if (!issueCode) {
      setErr('Pick the issue you are facing.'); return;
    }
    if (!description.trim() || description.trim().length < 8) {
      setErr('Please describe the issue (at least a sentence).'); return;
    }
    setBusy(true); setErr(''); setOkMsg('');
    try {
      let screenshotUrl = '';
      if (file) {
        screenshotUrl = await uploadScreenshot();
      }
      const issueLabel = (issues.find((i) => i[0] === issueCode) || [])[1]
        || 'support request';
      const data = {
        category: categoryForKind(kind),
        linkedKind: kind,
        issueCode,
        issueLabel,
        subject: `${refLabel || refId} - ${issueLabel}`,
        message: description.trim(),
        name: (user.profile && user.profile.name) || 'User',
        email: (user.profile && user.profile.email) || '',
        role: 'client',
        screenshotUrl,
      };
      data[refField] = refId;
      const res = await ticketService.createLinkedTicket(user.uid, data);
      setOkMsg(`Ticket #${res.ticketNo} raised. We will reply on `
        + 'Support shortly.');
      setBusy(false);
      // Auto-close after 2s so the toast stays visible briefly.
      setTimeout(() => { close(); }, 2000);
    } catch (e2) {
      setErr((e2 && e2.message) || 'Could not raise ticket. Try again.');
      setBusy(false);
    }
  }

  if (!open) return null;
  return (
    <div onClick={close}
      style={{
        position: 'fixed', inset: 0, zIndex: 80,
        background: 'rgba(15, 7, 8, 0.55)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        padding: '0', overscrollBehavior: 'contain',
      }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 520, background: '#fff',
          borderTopLeftRadius: 22, borderTopRightRadius: 22,
          padding: '18px 18px 24px',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
          maxHeight: '92vh', overflowY: 'auto',
        }}>
        <div style={{ display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700,
            color: '#2A1A1A' }}>
            Get help
          </h2>
          <button type="button" onClick={close} disabled={busy}
            style={{
              background: 'transparent', border: 0, padding: 6,
              fontSize: 22, lineHeight: 1, color: '#5C4A4A',
              cursor: 'pointer',
            }} aria-label="Close">×</button>
        </div>
        <div style={{ marginBottom: 14, fontSize: 12, color: '#5C4A4A' }}>
          About <b>{refLabel || refId}</b>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700,
            color: '#5C4A4A', textTransform: 'uppercase',
            letterSpacing: 0.5, marginBottom: 6 }}>
            What is the issue?
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {issues.map(([code, label]) => (
              <button key={code} type="button"
                onClick={() => pickIssue(code)}
                style={{
                  padding: '7px 12px', fontSize: 12, fontWeight: 600,
                  borderRadius: 999,
                  border: '1px solid',
                  borderColor: issueCode === code ? '#7F2020' : '#E5D9CC',
                  background: issueCode === code ? '#7F2020' : '#fff',
                  color: issueCode === code ? '#fff' : '#5C4A4A',
                  cursor: 'pointer',
                }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700,
            color: '#5C4A4A', textTransform: 'uppercase',
            letterSpacing: 0.5, marginBottom: 6 }}>
            Tell us what happened
          </div>
          <textarea value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the issue so our team can help quickly…"
            rows={4}
            maxLength={1000}
            style={{
              width: '100%', resize: 'vertical', minHeight: 88,
              padding: '10px 12px', fontSize: 14,
              border: '1px solid #E5D9CC', borderRadius: 12,
              fontFamily: 'inherit', color: '#2A1A1A',
              background: '#FAF7F2',
            }} />
          <div style={{ marginTop: 4, textAlign: 'right',
            fontSize: 10, color: '#9C8B8B' }}>
            {description.length}/1000
          </div>
        </div>

        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700,
            color: '#5C4A4A', textTransform: 'uppercase',
            letterSpacing: 0.5, marginBottom: 6 }}>
            Screenshot (optional)
          </div>
          <label htmlFor="ticketScreenshot"
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 12px', border: '1px dashed #C9B7A2',
              borderRadius: 12, background: '#FFF5EC',
              color: '#7F2020', fontSize: 13, cursor: 'pointer',
            }}>
            <span style={{ fontSize: 18 }}>📷</span>
            <span>{file
              ? `${file.name} (${Math.round(file.size / 1024)} KB)`
              : 'Tap to attach a screenshot (max 5 MB)'}</span>
            <input id="ticketScreenshot" type="file"
              accept="image/png,image/jpeg,image/jpg"
              onChange={pickFile}
              style={{ display: 'none' }} />
          </label>
        </div>

        {err && (
          <div style={{
            marginBottom: 10, padding: '10px 12px',
            borderRadius: 10, fontSize: 13,
            background: '#FEE2E2', color: '#7F1D1D',
          }}>{err}</div>
        )}
        {okMsg && (
          <div style={{
            marginBottom: 10, padding: '10px 12px',
            borderRadius: 10, fontSize: 13,
            background: '#DCFCE7', color: '#14532D',
          }}>{okMsg}</div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" onClick={close} disabled={busy}
            style={{
              flex: 1, padding: '12px 16px', fontSize: 14,
              fontWeight: 600, background: '#fff',
              color: '#7F2020', border: '1px solid #7F2020',
              borderRadius: 999, cursor: 'pointer',
            }}>
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={busy}
            style={{
              flex: 2, padding: '12px 16px', fontSize: 14,
              fontWeight: 700, background: '#7F2020',
              color: '#fff', border: 0,
              borderRadius: 999, cursor: 'pointer',
              opacity: busy ? 0.6 : 1,
            }}>
            {busy ? 'Sending…' : 'Raise ticket'}
          </button>
        </div>
      </div>
    </div>
  );
}
