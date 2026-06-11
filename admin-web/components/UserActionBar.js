import { useState, useEffect } from 'react';
import { adminService, authService } from '@astro/shared';
import RefundModal from './RefundModal';
import GiftCardPreview from './GiftCardPreview';

// Action bar that lives on the admin user profile (and could mount on
// the astrologer profile too). Every action has a confirmation modal
// instead of an instant click so a misclick on "Delete" never wipes
// an account. Wallet credits go through adminService.adjustWallet
// which writes a paired transactions/ doc so the customer sees the
// credit in their statement and the dashboard revenue counter stays
// correct.
//
// "Balance" credits the wallet with reason='admin_topup'.
// "Bonus"   credits the wallet with reason='bonus' (excluded from
//           revenue totals downstream).
// "Gift card" creates a fresh card via the relay and shows the code
//           so the admin can copy / email it.
// "Voucher" issues a single-use coupon doc for this customer.
// "Block"   toggles status='blocked' (soft - account stays).
// "Delete"  soft-deletes via adminService.deleteUser (archive trail
//           kept by adminService).
export default function UserActionBar({ uid, user, onChange }) {
  const [modal, setModal] = useState(null); // null | one of the keys
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [success, setSuccess] = useState('');
  // { code, amount } | null - shows the visual gift-card popup with
  // download-as-JPG + redeem instructions when set.
  const [giftCardPreview, setGiftCardPreview] = useState(null);

  const blocked = user?.status === 'blocked' || user?.isBlocked === true;
  const deleted = !!user?.deleted;

  function open(key) {
    setModal(key); setErr(''); setSuccess('');
    setAmount(''); setNote(''); setCode('');
  }
  function close() {
    if (busy) return; setModal(null);
  }

  // transform(out) lets callers map the raw result to the shape
  // the parent's onChange needs. Wallet actions pass
  // (out) => ({ wallet: out?.after }) so the balance stat
  // on the admin profile page immediately reflects the new value.
  async function run(fn, okMsg, transform) {
    setBusy(true); setErr(''); setSuccess('');
    try {
      const out = await fn();
      setSuccess(okMsg || 'Done.');
      if (typeof onChange === 'function') {
        onChange(transform ? transform(out) : out);
      }
    } catch (e) {
      setErr(String((e && e.message) || e));
    } finally { setBusy(false); }
  }

  const walletTransform = (out) => ({ wallet: out?.after });

  async function doManualDebit() {
    const amt = Math.round(Number(amount) || 0);
    if (!amt || amt <= 0) {
      setErr('Enter a positive amount.'); return;
    }
    if (!note.trim()) {
      setErr('Reason is required for a manual debit.'); return;
    }
    await run(
      () => adminService.adjustWallet(uid, -amt,
        `manual_debit: ${note.trim()}`),
      `Deducted ₹${amt} from wallet.`,
      walletTransform,
    );
  }
  async function doAddBalance() {
    const amt = Math.round(Number(amount) || 0);
    if (!amt || amt <= 0) {
      setErr('Enter a positive amount.'); return;
    }
    await run(
      () => adminService.adjustWallet(uid, amt, note || 'admin_topup'),
      `+₹${amt} credited.`,
      walletTransform,
    );
  }
  async function doAddBonus() {
    const amt = Math.round(Number(amount) || 0);
    if (!amt || amt <= 0) {
      setErr('Enter a positive amount.'); return;
    }
    await run(
      () => adminService.adjustWallet(uid, amt,
        `bonus${note ? `: ${note}` : ''}`),
      `Bonus ₹${amt} credited.`,
      walletTransform,
    );
  }
  async function doGiftCard() {
    const amt = Math.round(Number(amount) || 0);
    if (!amt || amt <= 0) {
      setErr('Enter a positive amount.'); return;
    }
    await run(async () => {
      const r = await adminService.createGiftCard(amt);
      const c = (r && (r.code || r.giftCode)) || '';
      setCode(c);
      // Open the visual gift-card popup so the admin can download
      // the JPG + share. Operator 2026-06-06: "make it downloadable
      // in JPG, popup with close button + redeem instructions."
      if (c) setGiftCardPreview({ code: c, amount: amt });
      return r;
    }, 'Gift card created.');
  }
  async function doVoucher() {
    const amt = Math.round(Number(amount) || 0);
    const id = (note || `V${Math.floor(Math.random() * 1e6)
      .toString().padStart(6, '0')}`).toUpperCase();
    if (!amt || amt <= 0) {
      setErr('Enter a positive value.'); return;
    }
    await run(() => adminService.saveCoupon(id, {
      code: id,
      type: 'flat',
      value: amt,
      assignedTo: uid,
      singleUse: true,
      enabled: true,
    }), `Voucher ${id} created for this customer.`);
    setCode(id);
  }
  async function doBlock() {
    await run(() => adminService.blockUser(uid, !blocked),
      blocked ? 'Account unblocked.' : 'Account blocked.');
  }
  async function doDelete() {
    if (deleted) { setErr('Already deleted.'); return; }
    await run(() => adminService.deleteUser(uid),
      'Account soft-deleted. Recoverable from /admin-archive.');
  }
  async function doResetPassword() {
    const target = String(user?.email || '').trim();
    if (!target) {
      setErr('No email on file for this account.'); return;
    }
    await run(() => authService.adminSendPasswordReset(target),
      `Reset link emailed to ${target}.`);
  }

  return (
    <>
      <div className="surface mt-4 flex flex-wrap items-center
        gap-2 p-3">
        <span className="mr-1 text-[11px] font-bold uppercase
          tracking-wider text-sub-text">Actions</span>
        <BarBtn onClick={() => open('balance')} tone="primary">
          + Balance
        </BarBtn>
        <BarBtn onClick={() => open('bonus')} tone="primary">
          + Bonus
        </BarBtn>
        <BarBtn onClick={() => open('debit')} tone="warn">
          Manual Debit
        </BarBtn>
        <BarBtn onClick={() => open('refund')} tone="amber">
          Refund
        </BarBtn>
        <BarBtn onClick={() => open('gift')} tone="amber">
          Gift card
        </BarBtn>
        <BarBtn onClick={() => open('voucher')} tone="amber">
          Voucher
        </BarBtn>
        <BarBtn onClick={() => open('edit')} tone="neutral">
          Edit
        </BarBtn>
        <BarBtn onClick={() => open('roles')} tone="neutral">
          Roles
        </BarBtn>
        <BarBtn onClick={() => open('resetPwd')} tone="neutral">
          Reset password
        </BarBtn>
        <BarBtn onClick={() => open('block')} tone="warn">
          {blocked ? 'Unblock' : 'Block'}
        </BarBtn>
        <BarBtn onClick={() => open('delete')} tone="danger">
          Delete
        </BarBtn>
      </div>

      {modal === 'balance' && (
        <ActionModal title="Add wallet balance"
          subtitle={`Credit ${user?.name || 'this customer'}'s wallet.
            Shows up as a transaction in their statement.`}
          onClose={close} onSubmit={doAddBalance} busy={busy}
          err={err} success={success} cta="Credit balance">
          <AmtField value={amount} onChange={setAmount} />
          <NoteField value={note} onChange={setNote}
            placeholder="Reason (shown in statement)" />
        </ActionModal>
      )}
      {modal === 'bonus' && (
        <ActionModal title="Add bonus"
          subtitle="Wallet bonus is excluded from real-revenue totals."
          onClose={close} onSubmit={doAddBonus} busy={busy}
          err={err} success={success} cta="Add bonus">
          <AmtField value={amount} onChange={setAmount} />
          <NoteField value={note} onChange={setNote}
            placeholder="Bonus reason (welcome, retention, etc)" />
        </ActionModal>
      )}
      {modal === 'debit' && (
        <ActionModal title="Manual wallet debit"
          subtitle={`Deduct money from ${user?.name || 'this customer'}'s `
            + 'wallet. Use this to collect missed charges (kundli '
            + 'reports, chat session under-billed, etc). The debit '
            + 'appears in their transaction statement immediately. '
            + 'Reason is required and is shown to the customer.'}
          onClose={close} onSubmit={doManualDebit} busy={busy}
          err={err} success={success}
          cta="Deduct from wallet" ctaTone="warn">
          <AmtField value={amount} onChange={setAmount} />
          <NoteField value={note} onChange={setNote}
            placeholder="e.g. kundli report (12-month forecast) or chat 16 min" />
        </ActionModal>
      )}
      {modal === 'refund' && (
        <RefundModal uid={uid} user={user}
          onClose={close}
          onDone={(out) => {
            setSuccess(`Refund ₹${out?.after - out?.before} credited.`);
            if (typeof onChange === 'function') onChange(out);
          }} />
      )}
      {giftCardPreview && (
        <GiftCardPreview code={giftCardPreview.code}
          amount={giftCardPreview.amount}
          onClose={() => setGiftCardPreview(null)} />
      )}
      {modal === 'gift' && (
        <ActionModal title="Issue gift card"
          subtitle="Generates a single-use 8-char code. Share it with
            the customer to redeem at any time."
          onClose={close} onSubmit={doGiftCard} busy={busy}
          err={err} success={success} cta="Generate code">
          <AmtField value={amount} onChange={setAmount} />
          {code && (
            <div className="rounded-card bg-bg-light p-3 text-center">
              <div className="text-[10px] uppercase tracking-widest
                text-sub-text">Code</div>
              <div className="font-mono text-2xl font-bold tracking-widest
                text-primary">{code}</div>
              <button onClick={() => { navigator.clipboard
                .writeText(code).catch(() => {}); }}
                className="mt-1 text-xs font-semibold text-primary
                  hover:underline">
                Copy code
              </button>
            </div>
          )}
        </ActionModal>
      )}
      {modal === 'voucher' && (
        <ActionModal title="Issue voucher"
          subtitle="Single-use flat-discount coupon assigned to THIS
            customer. They see it in their offers list."
          onClose={close} onSubmit={doVoucher} busy={busy}
          err={err} success={success} cta="Create voucher">
          <AmtField value={amount} onChange={setAmount} />
          <NoteField value={note} onChange={setNote}
            placeholder="Custom code (optional)" />
          {code && (
            <div className="rounded-card bg-bg-light p-3 text-center">
              <div className="font-mono text-lg font-bold tracking-wider
                text-primary">{code}</div>
            </div>
          )}
        </ActionModal>
      )}
      {modal === 'edit' && (
        <EditModal user={user} uid={uid} onClose={close}
          onSaved={(out) => { setSuccess('Saved.');
            if (typeof onChange === 'function') onChange(out); }} />
      )}
      {modal === 'roles' && (
        <RolesModal user={user} uid={uid} onClose={close}
          onSaved={(out) => { setSuccess('Roles updated.');
            if (typeof onChange === 'function') onChange(out); }} />
      )}
      {modal === 'block' && (
        <ActionModal title={blocked ? 'Unblock account' : 'Block account'}
          subtitle={blocked
            ? 'Customer will be able to sign in and consult again.'
            : 'Soft-block: sign-in still works but consultations are '
              + 'refused. Reversible from this page.'}
          onClose={close} onSubmit={doBlock} busy={busy}
          err={err} success={success}
          cta={blocked ? 'Unblock' : 'Block'} ctaTone="warn" />
      )}
      {modal === 'resetPwd' && (
        <ActionModal title="Send password reset link"
          subtitle={`Email a Firebase password reset link to
            ${user?.email || 'the user'}. They follow the link to
            choose a new password - the old one stops working as
            soon as they save the new one. Use this when a user or
            astrologer says they forgot their password.`}
          onClose={close} onSubmit={doResetPassword} busy={busy}
          err={err} success={success}
          cta="Send reset link" ctaTone="primary" />
      )}
      {modal === 'delete' && (
        <ActionModal title="Delete account"
          subtitle="Soft-delete: account is archived and recoverable from
            /admin-archive. Their kundli + consultation history is
            preserved for compliance."
          onClose={close} onSubmit={doDelete} busy={busy}
          err={err} success={success}
          cta="Delete account" ctaTone="danger" />
      )}
    </>
  );
}

function BarBtn({ children, onClick, tone }) {
  const cls = tone === 'danger'
    ? 'bg-danger text-white hover:bg-danger/90'
    : tone === 'warn'
      ? 'bg-warning text-white hover:bg-warning/90'
      : tone === 'amber'
        ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
        : tone === 'primary'
          ? 'bg-primary text-white hover:bg-primary/90'
          : 'bg-bg-light text-dark-text hover:bg-gray-200';
  return (
    <button onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-bold ${cls}`}>
      {children}
    </button>
  );
}

function ActionModal({ title, subtitle, children, onClose, onSubmit,
  busy, err, success, cta, ctaTone }) {
  const ctaCls = ctaTone === 'danger'
    ? 'bg-danger text-white'
    : ctaTone === 'warn' ? 'bg-warning text-white'
    : 'bg-primary text-white';
  // Auto-close ~1.2s after success so the admin sees confirmation but
  // does not have to manually close (and so the destructive CTA does
  // not stay clickable / repeatable). Fixes a report that after
  // "Account soft-deleted." the Delete button stayed live.
  useEffect(() => {
    if (!success) return undefined;
    const t = setTimeout(() => { try { onClose && onClose(); } catch (_) {} },
      1200);
    return () => clearTimeout(t);
  }, [success, onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center
      bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-card bg-white p-5
        shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold">{title}</h3>
        {subtitle && !success && (
          <p className="mt-1 text-xs text-sub-text">{subtitle}</p>
        )}
        {!success && (
          <div className="mt-3 space-y-3">{children}</div>
        )}
        {err && (
          <div className="mt-3 rounded-card bg-danger/10 p-2
            text-xs font-semibold text-danger">{err}</div>
        )}
        {success && (
          <div className="mt-3 rounded-card bg-emerald-50 p-3
            text-sm font-semibold text-emerald-700 flex items-center
            gap-2">
            <span aria-hidden>{'✓'}</span>{success}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} disabled={busy}
            className="rounded-full bg-bg-light px-4 py-2
              text-sm font-semibold">
            {success ? 'Done' : 'Close'}
          </button>
          {!success && (
            <button onClick={onSubmit} disabled={busy}
              className={`rounded-full px-4 py-2 text-sm font-bold
                ${ctaCls}`}>
              {busy ? 'Working...' : cta}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function AmtField({ value, onChange }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-sub-text">
        Amount (₹)
      </span>
      <input className="input mt-1" type="number" min="1" inputMode="numeric"
        value={value} onChange={(e) => onChange(e.target.value)}
        placeholder="100" />
    </label>
  );
}
function NoteField({ value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-sub-text">Note</span>
      <input className="input mt-1" value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || ''} />
    </label>
  );
}

function EditModal({ user, uid, onClose, onSaved }) {
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function save() {
    setBusy(true); setErr('');
    try {
      const patch = { name, email, phone };
      // Lazy-import userService to avoid circular boot deps.
      const { userService } = await import('@astro/shared');
      await userService.updateUser(uid, patch);
      onSaved && onSaved({ ...user, ...patch });
      onClose();
    } catch (e) { setErr(String((e && e.message) || e)); }
    finally { setBusy(false); }
  }
  return (
    <ActionModal title="Edit profile"
      subtitle="Only basic identity is editable here. Reset other
        fields (kundli, language, dob) from the Reset panel."
      onClose={onClose} onSubmit={save} busy={busy} err={err}
      success="" cta="Save changes">
      <label className="block">
        <span className="text-xs font-semibold text-sub-text">Name</span>
        <input className="input mt-1" value={name}
          onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="block">
        <span className="text-xs font-semibold text-sub-text">Email</span>
        <input className="input mt-1" value={email}
          onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="block">
        <span className="text-xs font-semibold text-sub-text">Phone</span>
        <input className="input mt-1" value={phone}
          onChange={(e) => setPhone(e.target.value)} />
      </label>
    </ActionModal>
  );
}

// Roles editor. The user.roles field is a SET ("client" | "astrologer"
// | "support" | "admin") - one account may hold any combination so the
// same person doesn't have to maintain separate logins for the
// customer app, the astrologer app and the admin panel. setUserRoles
// in adminService writes the primary `role` (admin > astrologer >
// support > client) and the full `roles` set, and provisions the
// astrologer doc automatically when 'astrologer' is in the set.
//
// Per-panel passwords are intentionally NOT separated: Firebase Auth
// is single-account-per-uid. Admin can however reset the password
// here, which applies across every panel that account signs into.
// Anyone needing a panel-specific password should use a separate
// account.
function RolesModal({ user, uid, onClose, onSaved }) {
  const initial = Array.isArray(user?.roles) && user.roles.length
    ? user.roles
    : [user?.role || 'client'];
  const [selected, setSelected] = useState(new Set(initial));
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  function toggle(r) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(r)) next.delete(r); else next.add(r);
      if (!next.has('client') && !next.has('astrologer')
        && !next.has('support') && !next.has('admin')) {
        next.add('client');
      }
      return next;
    });
  }
  async function save() {
    setBusy(true); setErr('');
    try {
      const list = Array.from(selected);
      await adminService.setUserRoles(uid, list);
      if (password.trim()) {
        await adminService.adminUpdateAuthUser(uid,
          { password: password.trim() });
      }
      onSaved && onSaved({ ...user, role: list.includes('admin')
        ? 'admin' : list.includes('astrologer') ? 'astrologer'
        : list.includes('support') ? 'support' : 'client',
        roles: list });
      onClose();
    } catch (e) { setErr(String((e && e.message) || e)); }
    finally { setBusy(false); }
  }

  const ROLE_INFO = [
    ['client', 'Customer', 'Access the customer mobile / web app.'],
    ['astrologer', 'Astrologer',
      'Access the astrologer app + appear in the marketplace.'],
    ['support', 'Support', 'Access the Support portal of /admin.'],
    ['admin', 'Admin', 'Full admin panel access.'],
  ];

  return (
    <ActionModal title="Assign roles"
      subtitle="One account can carry any combination of roles. The
        same login then works across the customer app, astrologer app
        and admin panel - no separate accounts needed."
      onClose={onClose} onSubmit={save} busy={busy} err={err}
      success="" cta="Save roles">
      <div className="space-y-1.5">
        {ROLE_INFO.map(([id, label, hint]) => {
          const on = selected.has(id);
          return (
            <label key={id}
              className={`flex cursor-pointer items-start gap-2
                rounded-card border p-2.5 ${on
                  ? 'border-primary bg-primary/5'
                  : 'border-gray-200 bg-white'}`}>
              <input type="checkbox" checked={on}
                onChange={() => toggle(id)}
                className="mt-0.5" />
              <span className="min-w-0 flex-1">
                <span className="font-semibold text-dark-text">
                  {label}
                </span>
                <span className="block text-[11px] text-sub-text">
                  {hint}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      <div className="mt-3 border-t border-gray-200 pt-3">
        <label className="block">
          <span className="text-xs font-semibold text-sub-text">
            Reset password for this account (optional)
          </span>
          <input type="password" className="input mt-1"
            value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="Leave blank to keep existing password" />
        </label>
        <div className="mt-1 text-[10.5px] text-sub-text">
          Firebase Auth uses one password per account, so this applies
          to every panel this user signs into. If you need a separate
          password for the admin panel only, create a second account.
        </div>
      </div>
    </ActionModal>
  );
}
