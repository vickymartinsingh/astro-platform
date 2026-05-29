import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// Play Console tester management.
//
// Lists current testers on a given app+track (read live from the
// Google Play Developer API), lets admin add a new tester email
// (writes to Play Console AND optionally SMTPs the opt-in URL to the
// tester), and remove existing ones.
//
// The Play Store opt-in URL is per-app and per-track; admin pastes
// it once into the form below. Common shapes:
//   internal: https://play.google.com/apps/internaltest/<token>
//   alpha:    https://play.google.com/apps/testing/<package>
//   beta:     https://play.google.com/apps/testing/<package>
// Find these in Play Console under Testing -> <track> -> Testers tab.
//
// Server endpoint: /api/playTesters (push-relay).

const APPS = [
  { id: 'com.astroseer.mobile', name: 'AstroSeer Connect (Customer)' },
  { id: 'com.astroseer.astrologer',
    name: 'AstroSeer for Astrologers' },
  { id: 'com.astroseer.admin', name: 'AstroSeer Admin' },
];
const TRACKS = [
  { id: 'internal', label: 'Internal testing' },
  { id: 'alpha', label: 'Closed testing (Alpha)' },
  { id: 'beta', label: 'Closed testing (Beta)' },
];

function relayUrl() {
  if (typeof process !== 'undefined' && process.env
    && process.env.NEXT_PUBLIC_PUSH_RELAY) {
    return process.env.NEXT_PUBLIC_PUSH_RELAY
      .replace(/\/+$/, '');
  }
  return 'https://astro-platform-push-relay.vercel.app';
}

async function relayCall(body) {
  const r = await fetch(`${relayUrl()}/api/playTesters`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json',
      'x-admin-key': (typeof process !== 'undefined' && process.env
        && process.env.NEXT_PUBLIC_ADMIN_RELAY_KEY) || '' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = (j && j.error) || `HTTP ${r.status}`;
    const e = new Error(msg);
    e.detail = j;
    throw e;
  }
  return j;
}

export default function AdminTesters() {
  const { loading } = useRequireAdmin();
  const [pkg, setPkg] = useState(APPS[0].id);
  const [track, setTrack] = useState('internal');
  const [testers, setTesters] = useState(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [optInUrl, setOptInUrl] = useState('');
  const [sendInvite, setSendInvite] = useState(true);
  const [err, setErr] = useState('');

  async function load() {
    setErr(''); setTesters(null);
    try {
      const r = await relayCall({ action: 'list', package: pkg, track });
      setTesters(r.testers || []);
    } catch (e) {
      setErr(e.message || 'Could not load testers.');
      setTesters([]);
    }
  }

  useEffect(() => { if (!loading) load(); /* eslint-disable-next-line */
  }, [loading, pkg, track]);

  async function addTester() {
    setErr('');
    if (!email.trim()) { setErr('Enter an email.'); return; }
    setBusy(true);
    try {
      const r = await relayCall({
        action: 'add', package: pkg, track,
        email: email.trim(), sendInvite, optInUrl: optInUrl.trim(),
      });
      setTesters(r.testers || []);
      setEmail('');
      if (sendInvite && r.invited) {
        flash('Tester added on Play Console + invite email sent.');
      } else if (sendInvite && r.inviteError) {
        flash(`Added on Play Console. Email send failed: `
          + `${r.inviteError}`);
      } else {
        flash('Tester added on Play Console.');
      }
    } catch (e) {
      setErr(e.message || 'Could not add tester.');
    } finally { setBusy(false); }
  }

  async function removeTester(addr) {
    if (!window.confirm(`Remove ${addr} from Play Console testers?`)) {
      return;
    }
    setBusy(true);
    try {
      const r = await relayCall({
        action: 'remove', package: pkg, track, email: addr,
      });
      setTesters(r.testers || []);
      flash(`Removed ${addr}.`);
    } catch (e) {
      setErr(e.message || 'Could not remove tester.');
    } finally { setBusy(false); }
  }

  if (loading) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }
  return (
    <Layout>
      <div className="card">
        <h2 className="text-lg font-bold">Invite Tester</h2>
        <p className="mt-1 text-sm text-sub-text">
          Add an email to the Play Console testers list for the
          selected app and track. The tester gets an invite email
          with the Play Store opt-in URL automatically.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-xs font-bold uppercase
              text-sub-text">App</label>
            <select className="input mt-1" value={pkg}
              onChange={(e) => setPkg(e.target.value)}>
              {APPS.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold uppercase
              text-sub-text">Track</label>
            <select className="input mt-1" value={track}
              onChange={(e) => setTrack(e.target.value)}>
              {TRACKS.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3">
          <label className="text-xs font-bold uppercase
            text-sub-text">Play Store opt-in URL</label>
          <input className="input mt-1" type="url"
            placeholder="https://play.google.com/apps/internaltest/..."
            value={optInUrl}
            onChange={(e) => setOptInUrl(e.target.value)} />
          <p className="mt-1 text-[11px] text-sub-text">
            Find this in Play Console under Testing -&gt; the chosen
            track -&gt; Testers tab. Required so the invite email
            tells the tester where to install.
          </p>
        </div>

        <div className="mt-3">
          <label className="text-xs font-bold uppercase
            text-sub-text">Tester email</label>
          <div className="mt-1 flex gap-2">
            <input className="input flex-1" type="email"
              placeholder="tester@example.com" value={email}
              onChange={(e) => setEmail(e.target.value)} />
            <button type="button" onClick={addTester}
              disabled={busy}
              className="btn-primary !min-h-0 px-4 py-2 text-sm">
              {busy ? 'Saving...' : 'Add'}
            </button>
          </div>
        </div>

        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={sendInvite}
            onChange={(e) => setSendInvite(e.target.checked)} />
          Also email the tester the opt-in link
        </label>

        {err && (
          <div className="mt-3 rounded-card bg-danger/10 p-3
            text-sm text-danger">
            {err}
          </div>
        )}
      </div>

      <div className="card mt-4">
        <h3 className="text-md font-bold">
          Current testers ({testers ? testers.length : '...'})
        </h3>
        <p className="mt-1 text-[12px] text-sub-text">
          Reading live from Play Console for {pkg} - {track}.
        </p>
        {!testers ? (
          <div className="mt-3 text-sm text-sub-text">Loading...</div>
        ) : testers.length === 0 ? (
          <div className="mt-3 rounded-card bg-bg-light p-3 text-sm
            text-sub-text">
            No testers on this track yet.
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100">
            {testers.map((t) => (
              <li key={t} className="flex items-center justify-between
                py-2 text-sm">
                <span className="font-mono">{t}</span>
                <button type="button"
                  onClick={() => removeTester(t)}
                  disabled={busy}
                  className="text-xs font-bold text-danger
                    hover:underline">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4">
          <button type="button" onClick={load} disabled={busy}
            className="rounded-full border border-primary px-4 py-2
              text-xs font-bold text-primary">
            Refresh from Play Console
          </button>
        </div>
      </div>
    </Layout>
  );
}
