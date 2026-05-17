import { useEffect, useState } from 'react';
import Link from 'next/link';
import { kundliService, getHoroscope } from '@astro/shared';
import Layout from '../components/Layout';
import { SkeletonList } from '../components/Skeleton';
import ZodiacPicker from '../components/ZodiacPicker';
import { useOptionalClient } from '../lib/useAuth';
import { useSettings } from '../lib/useSettings';

// Public. Always shows Today + Tomorrow via the built-in generator
// (no DB / Cloud Function needed). Logged-in users with a default kundli
// get their sign auto-selected.
export default function Horoscope() {
  const { user, loading } = useOptionalClient();
  const { features } = useSettings();
  const [sign, setSign] = useState('Aries');
  const [when, setWhen] = useState('today');

  useEffect(() => {
    if (!user) return;
    kundliService.getDefaultKundli(user.uid)
      .then((k) => { if (k?.zodiac) setSign(k.zodiac); })
      .catch(() => {});
  }, [user]);

  if (loading) return <Layout><SkeletonList /></Layout>;

  const h = getHoroscope(sign, when);
  const dateStr = (w) => {
    const d = new Date();
    if (w === 'tomorrow') d.setDate(d.getDate() + 1);
    return d.toLocaleDateString('en-GB', {
      weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  };

  return (
    <Layout>
      <h1 className="mb-3 text-2xl font-bold">Horoscope</h1>

      <div className="surface mb-4 p-4">
        <label className="text-sm text-sub-text">Choose your sign</label>
        <div className="mt-2">
          <ZodiacPicker value={sign} onChange={setSign}
            dropdown={features.zodiac_dropdown === true} />
        </div>
        {!user && (
          <p className="mt-2 text-xs text-sub-text">
            <Link href="/signup" className="font-semibold text-primary">
              Sign up
            </Link>{' '}to save your birth details and skip this every time.
          </p>
        )}
      </div>

      <div className="mb-3 flex gap-1">
        {['today', 'tomorrow'].map((w) => (
          <button key={w} onClick={() => setWhen(w)}
            className={when === w ? 'pill pill-active' : 'pill'}>
            {w === 'today' ? 'Today' : 'Tomorrow'}
          </button>
        ))}
      </div>
      <Reading
        title={`${sign} - ${when === 'today' ? 'Today' : 'Tomorrow'}, `
          + `${dateStr(when)}`}
        h={h} />
      <p className="mt-3 text-xs text-sub-text">
        Showing {when === 'today' ? 'Today' : 'Tomorrow'} ({dateStr(when)}).
        Tap Tomorrow to see the next day.
      </p>
    </Layout>
  );
}

function Reading({ title, h }) {
  return (
    <div className="surface p-5">
      <div className="mb-2 font-semibold text-primary">{title}</div>
      <p className="mb-2">{h.general}</p>
      <Row k="Love" v={h.love} />
      <Row k="Career" v={h.career} />
      <Row k="Health" v={h.health} />
      <div className="mt-3 flex gap-4 text-sm text-sub-text">
        <span>Lucky no. <b className="text-dark-text">{h.luckyNumber}</b></span>
        <span>Lucky colour <b className="text-dark-text">{h.luckyColor}</b></span>
      </div>
    </div>
  );
}
function Row({ k, v }) {
  return (
    <p className="mt-1 text-sm">
      <span className="font-semibold">{k}:</span>{' '}
      <span className="text-sub-text">{v}</span>
    </p>
  );
}
