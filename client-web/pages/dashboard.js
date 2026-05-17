import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { astrologerService, ZODIAC, getHoroscope } from '@astro/shared';
import Layout from '../components/Layout';
import { SkeletonList } from '../components/Skeleton';
import GuidedTour from '../components/GuidedTour';
import AstrologerCard from '../components/AstrologerCard';
import { Icon } from '../components/Icons';
import { useOptionalClient } from '../lib/useAuth';
import { useAstroActions } from '../lib/useAstroActions';
import { useAuthModal } from '../lib/authModal';
import { useSettings } from '../lib/useSettings';

const CATEGORIES = [
  ['Love', 'Love & Relationships'],
  ['Career', 'Career'],
  ['Marriage', 'Marriage'],
  ['Health', 'Health'],
  ['Finance', 'Finance'],
  ['Education', 'Education'],
];

const CUSTOMER_REVIEWS = [
  ['Ananya Sharma', 'Delhi', 5,
    'Very accurate reading about my career. The remedies worked within weeks.'],
  ['Rahul Verma', 'Mumbai', 5,
    'Honest and patient. Helped me take a big decision with confidence.'],
  ['Priya Nair', 'Kochi', 4,
    'Loved the clarity. The astrologer was kind and never rushed me.'],
  ['Vikram Reddy', 'Hyderabad', 5,
    'Marriage matching was detailed and explained simply. Highly recommend.'],
  ['Sneha Patel', 'Ahmedabad', 5,
    'Daily horoscope is spot on. The tarot reading gave me real direction.'],
  ['Arjun Singh', 'Jaipur', 4,
    'Quick to connect, fair pricing, and genuinely helpful guidance.'],
];

export default function Dashboard() {
  const { user, profile, loading } = useOptionalClient();
  const { go } = useAstroActions();
  const { openLogin } = useAuthModal();
  const { freeChatMin } = useSettings();
  const freeMin = profile?.freeUsed ? 0 : freeChatMin;
  const router = useRouter();
  const [list, setList] = useState(null);
  const [showTour, setShowTour] = useState(false);
  const [sign, setSign] = useState('Aries');
  const [when, setWhen] = useState('today');

  useEffect(() => {
    astrologerService.getAstrologers().then(setList).catch(() => setList([]));
  }, []);
  useEffect(() => {
    if (profile && profile.hasSeenTour === false) setShowTour(true);
  }, [profile]);

  if (loading) return <Layout><SkeletonList /></Layout>;

  const topRated = [...(list || [])]
    .sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, 8);
  const reading = getHoroscope(sign, when);
  const openProfile = (a) => router.push(`/astrologer/${a.id}`);

  return (
    <Layout>
      {showTour && user && (
        <GuidedTour uid={user.uid} onClose={() => setShowTour(false)} />
      )}

      {/* Hero */}
      <div className="hero-grad rounded-2xl p-6 text-white md:p-10">
        <h1 className="text-2xl font-bold md:text-4xl">
          The stars have answers
        </h1>
        <p className="mt-2 max-w-lg text-sm opacity-90 md:text-base">
          Speak with verified astrologers on chat, call or video. Clarity on
          love, career, marriage and the road ahead.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href="/astrologers"
            className="rounded-full bg-white px-5 py-2.5 font-semibold
                       text-primary">Browse astrologers</Link>
          {!user && (
            <button onClick={() => openLogin(undefined, { mode: 'signup' })}
              className="rounded-full bg-white/20 px-5 py-2.5 font-semibold">
              Get started
            </button>
          )}
        </div>
      </div>

      {/* Quick actions (Tarot is front and centre on the home page) */}
      <div className="mt-4 grid grid-cols-4 gap-3">
        {[
          ['/tarot', 'Tarot', '🔮'],
          ['/kundli', 'Kundli', '📜'],
          ['/matching', 'Matching', '💞'],
          ['/horoscope', 'Horoscope', '✨'],
        ].map(([href, label, icon]) => (
          <Link key={href} href={href}
            className="surface flex flex-col items-center gap-1 p-3
                       text-center hover:shadow-md">
            <span className="text-2xl">{icon}</span>
            <span className="text-xs font-semibold">{label}</span>
          </Link>
        ))}
      </div>

      {/* Stats */}
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat n={`${(list || []).length || 0}+`} l="Verified Experts" />
        <Stat n="1M+" l="Consultations" />
        <Stat n="4.8" l="Rating Average" />
        <Stat n="12+" l="Languages" />
      </div>

      {/* Your stars today (Today by default, Tomorrow on tap) */}
      <h2 className="mb-3 mt-8 text-lg font-bold">Your stars today</h2>
      <div className="surface p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="badge bg-bg-light text-primary">Daily reading</span>
          <select className="input w-44" value={sign}
            onChange={(e) => setSign(e.target.value)}>
            {ZODIAC.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
          <div className="flex gap-1">
            {['today', 'tomorrow'].map((w) => (
              <button key={w} onClick={() => setWhen(w)}
                className={when === w ? 'pill pill-active' : 'pill'}>
                {w === 'today' ? 'Today' : 'Tomorrow'}
              </button>
            ))}
          </div>
          <Link href="/tarot" className="btn-grad ml-auto">
            Pick your tarot card
          </Link>
        </div>
        <div className="mt-4">
          <Daily
            title={`${sign} - ${when === 'today' ? 'Today' : 'Tomorrow'}, `
              + `${(() => { const d = new Date();
                if (when === 'tomorrow') d.setDate(d.getDate() + 1);
                return d.toLocaleDateString('en-GB', { weekday: 'short',
                  day: '2-digit', month: 'short', year: 'numeric' });
              })()}`}
            h={reading} />
        </div>
      </div>

      {/* Categories */}
      <h2 className="mb-3 mt-8 text-lg font-bold">Browse by category</h2>
      <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
        {CATEGORIES.map(([key, label]) => {
          const Ico = Icon[key] || Icon.Star;
          return (
            <Link key={key}
              href={`/astrologers?skill=${encodeURIComponent(key)}`}
              className="surface flex flex-col items-center gap-2 p-4
                         text-center hover:shadow-md">
              <span className="flex h-11 w-11 items-center justify-center
                rounded-xl bg-bg-light text-dark-text">
                <Ico />
              </span>
              <span className="text-xs font-medium">{label}</span>
            </Link>
          );
        })}
      </div>

      {/* Top rated astrologers */}
      <div className="mb-3 mt-8 flex items-center justify-between">
        <h2 className="text-lg font-bold">Top rated astrologers</h2>
        <Link href="/astrologers"
          className="text-sm font-semibold text-primary">See all</Link>
      </div>
      {list == null ? (
        <SkeletonList count={4} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2
                        lg:grid-cols-4">
          {topRated.map((a) => (
            <AstrologerCard key={a.id} a={a} onOpen={openProfile}
              onAction={go} freeMin={freeMin} />
          ))}
        </div>
      )}

      {/* Customer ratings & reviews */}
      <div className="mb-3 mt-10 flex items-center justify-between">
        <h2 className="text-lg font-bold">What our customers say</h2>
        <span className="text-sm font-semibold text-gold">
          4.8 / 5 average
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CUSTOMER_REVIEWS.map(([name, city, stars, text]) => (
          <div key={name} className="surface p-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold">{name}</div>
              <div className="text-sm text-gold">
                {'★'.repeat(stars)}
                <span className="text-gray-300">
                  {'★'.repeat(5 - stars)}
                </span>
              </div>
            </div>
            <div className="text-xs text-sub-text">{city}</div>
            <p className="mt-2 text-sm text-sub-text">{text}</p>
          </div>
        ))}
      </div>
    </Layout>
  );
}

function Stat({ n, l }) {
  return (
    <div className="surface p-4">
      <div className="text-xl font-bold text-primary">{n}</div>
      <div className="text-xs uppercase tracking-wide text-sub-text">{l}</div>
    </div>
  );
}
function Daily({ title, h }) {
  return (
    <div className="rounded-xl bg-bg-light p-4">
      <div className="mb-1 font-semibold text-primary">{title}</div>
      <p className="text-sm">{h.general}</p>
      <p className="mt-2 text-sm text-sub-text">
        <b className="text-dark-text">Love:</b> {h.love}
      </p>
      <p className="text-sm text-sub-text">
        <b className="text-dark-text">Career:</b> {h.career}
      </p>
      <p className="text-sm text-sub-text">
        <b className="text-dark-text">Health:</b> {h.health}
      </p>
      <div className="mt-2 text-xs text-sub-text">
        Lucky number {h.luckyNumber}, lucky colour {h.luckyColor}
      </div>
    </div>
  );
}
