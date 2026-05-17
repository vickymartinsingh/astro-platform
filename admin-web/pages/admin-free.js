import { useEffect, useState } from 'react';
import { db, adminService } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// Free Sessions control. Everything here is live the moment you Save
// (settings/config is read by every session before billing starts):
//  - Master on/off for the whole free-session perk.
//  - Free minutes for chat and for call/video.
//  - Who gets it: only brand-new users, OR every user (one free each).
//  - Specific / old users: paste uid, phone or email - those people
//    ALWAYS get a free session until you remove them from the list.
export default function AdminFree() {
  const { loading } = useRequireAdmin();
  const [c, setC] = useState(null);
  const [grant, setGrant] = useState('');

  useEffect(() => {
    getDoc(doc(db, 'settings', 'config')).then((s) => {
      const d = s.exists() ? s.data() : {};
      setC(d);
      setGrant((Array.isArray(d.free_grant_uids)
        ? d.free_grant_uids : []).join('\n'));
    });
  }, []);

  if (loading || !c) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }

  const enabled = c.free_enabled !== false;
  const chatMin = c.free_chat_seconds == null || c.free_chat_seconds === ''
    ? 5 : Math.round(Number(c.free_chat_seconds) / 60);
  const callMin = c.free_call_seconds == null || c.free_call_seconds === ''
    ? 5 : Math.round(Number(c.free_call_seconds) / 60);
  const scope = c.free_scope === 'all' ? 'all' : 'new';

  function setMin(key, minutes) {
    const m = minutes === '' ? '' : Number(minutes);
    setC({ ...c, [key]: m === '' ? '' : Math.max(0, m) * 60 });
  }

  async function save() {
    const list = grant.split(/[\n,]/).map((x) => x.trim())
      .filter(Boolean);
    await adminService.updateSettings('config', {
      ...c, free_grant_uids: list,
    });
    flash('Free-session rules saved - live across all apps now');
  }

  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">Free Sessions</h1>
      <p className="mb-4 text-sm text-sub-text">
        Control who gets a free consultation and for how long. Changes
        apply instantly to every app on Save - no rebuild.
      </p>

      <div className="card space-y-3">
        <label className="flex items-center justify-between">
          <span className="font-semibold">Enable free sessions</span>
          <input type="checkbox" checked={enabled}
            onChange={(e) => setC({
              ...c, free_enabled: e.target.checked })} />
        </label>
        <p className="text-xs text-sub-text">
          Master switch. Turn off to bill every session from the first
          second for everyone.
        </p>
      </div>

      <div className="card mt-4 space-y-3">
        <div className="font-semibold">Free minutes</div>
        <label className="flex items-center gap-3">
          <span className="w-32 text-sm text-sub-text">Chat (min)</span>
          <input className="input flex-1" type="number" min={0}
            value={chatMin}
            onChange={(e) => setMin('free_chat_seconds',
              e.target.value)} />
        </label>
        <label className="flex items-center gap-3">
          <span className="w-32 text-sm text-sub-text">
            Call / Video (min)
          </span>
          <input className="input flex-1" type="number" min={0}
            value={callMin}
            onChange={(e) => setMin('free_call_seconds',
              e.target.value)} />
        </label>
      </div>

      <div className="card mt-4 space-y-2">
        <div className="font-semibold">Who gets it</div>
        {[
          ['new', 'Only new users',
            'Each user gets one free session on their very first '
            + 'consultation (default).'],
          ['all', 'Every user (one free each)',
            'Every user who has not yet used a free session gets one, '
            + 'including existing users.'],
        ].map(([v, label, desc]) => (
          <label key={v} className="flex items-start gap-3 rounded-card
            border border-gray-200 p-3">
            <input type="radio" name="scope" className="mt-1"
              checked={scope === v}
              onChange={() => setC({ ...c, free_scope: v })} />
            <span>
              <span className="font-semibold">{label}</span>
              <span className="block text-xs text-sub-text">{desc}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="card mt-4 space-y-2">
        <div className="font-semibold">
          Specific / old users (always free)
        </div>
        <p className="text-xs text-sub-text">
          One per line: user ID, phone or email. Anyone listed here ALWAYS
          gets a free session every time, until you remove them. Use this
          to re-grant a free session to old or VIP users.
        </p>
        <textarea className="input" rows={5}
          placeholder={'+919876543210\nuser@example.com\nUID...'}
          value={grant}
          onChange={(e) => setGrant(e.target.value)} />
      </div>

      <button onClick={save} className="btn-primary mt-4 w-full">
        Save free-session rules
      </button>
    </Layout>
  );
}
