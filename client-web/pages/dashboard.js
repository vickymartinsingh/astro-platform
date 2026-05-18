import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  astrologerService, reviewService, zodiacLabel,
  iconsService, horoscopeService, kundliService,
  signFromDOB, userService, db,
} from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { SkeletonList } from '../components/Skeleton';
import AstrologerCard from '../components/AstrologerCard';
import ZodiacPicker from '../components/ZodiacPicker';
import { Icon } from '../components/Icons';
import { DateField } from '../components/BirthInputs';
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
  const { freeChatMin, features } = useSettings();
  const freeMin = profile?.freeUsed ? 0 : freeChatMin;
  const router = useRouter();
  const [list, setList] = useState(null);
  const [sign, setSign] = useState('Aries');
  const [when, setWhen] = useState('today');
  const [hero, setHero] = useState({
    title: 'The stars have answers',
    subtitle: 'Speak with verified astrologers on chat, call or video. '
      + 'Clarity on love, career, marriage and the road ahead.',
  });
  const [sec, setSec] = useState({}); // section show/hide from admin
  useEffect(() => {
    getDoc(doc(db, 'settings', 'content')).then((s) => {
      const d = s.exists() ? s.data() : {};
      if (d.homeHeroTitle || d.homeHeroSubtitle) {
        setHero((h) => ({
          title: d.homeHeroTitle || h.title,
          subtitle: d.homeHeroSubtitle || h.subtitle,
        }));
      }
      setSec({
        quickActions: d.sec_quickActions !== false,
        starsToday: d.sec_starsToday !== false,
        categories: d.sec_categories !== false,
        topRated: d.sec_topRated !== false,
        reviews: d.sec_reviews !== false,
      });
    }).catch(() => setSec({
      quickActions: true, starsToday: true, categories: true,
      topRated: true, reviews: true }));
  }, []);

  useEffect(() => {
    astrologerService.getAstrologers().then(setList).catch(() => setList([]));
  }, []);

  const [pubReviews, setPubReviews] = useState(null);
  useEffect(() => {
    reviewService.getPublicPlatformReviews()
      .then(setPubReviews).catch(() => setPubReviews([]));
  }, []);

  const revRef = useRef(null);
  const revStep = (dir) => {
    const el = revRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth,
      behavior: 'smooth' });
  };
  const [icons, setIcons] = useState(iconsService.resolveIcons(null));
  useEffect(() => iconsService.watchIcons(setIcons), []);
  const [horo, setHoro] = useState({});
  useEffect(() => horoscopeService.watchHoroscope(setHoro), []);

  // Personalised "Your stars today" - from the user's saved kundli(s).
  const [kundlis, setKundlis] = useState([]);
  const [kIdx, setKIdx] = useState(0);
  const [pWhen, setPWhen] = useState('today');
  const [dob, setDob] = useState('');
  useEffect(() => { if (profile?.dob) setDob(profile.dob); }, [profile]);
  useEffect(() => {
    if (!user) { setKundlis([]); return; }
    kundliService.getKundliProfiles(user.uid).then((l) => {
      const arr = (Array.isArray(l) ? l : []).slice()
        .sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0));
      setKundlis(arr); setKIdx(0);
    }).catch(() => setKundlis([]));
  }, [user]);

  if (loading) return <Layout><SkeletonList /></Layout>;

  const topRated = [...(list || [])]
    .sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, 8);
  const reading = horoscopeService.resolveHoroscope(sign, when, horo);
  const iconNode = (slot) => (iconsService.isImage(icons[slot])
    ? <img src={icons[slot]} alt="" className="h-8 w-8 object-contain" />
    : <span className="text-2xl leading-none">{icons[slot]}</span>);
  // Category icon: admin image/emoji override, else the built-in
  // monochrome SVG (single theme colour, never a colour emoji).
  const catIcon = (key) => {
    const ov = icons[`cat:${key}`];
    if (iconsService.isImage(ov)) {
      return <img src={ov} alt="" className="h-7 w-7 object-contain" />;
    }
    if (ov) return <span className="text-2xl leading-none">{ov}</span>;
    const C = Icon[key] || Icon.Star;
    return <C className="h-6 w-6 text-primary" />;
  };
  const openProfile = (a) => router.push(`/astrologer/${a.id}`);

  return (
    <Layout>

      {/* Hero */}
      <div className="hero-grad rounded-2xl p-6 text-white md:p-10">
        <h1 className="text-2xl font-bold md:text-4xl">
          {hero.title}
        </h1>
        <p className="mt-2 max-w-lg text-sm opacity-90 md:text-base">
          {hero.subtitle}
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
      {sec.quickActions !== false && (
      <div className="mt-4 grid grid-cols-4 gap-3">
        {[
          ['/tarot', 'Tarot', 'qa:tarot'],
          ['/kundli', 'Kundli', 'qa:kundli'],
          ['/matching', 'Matching', 'qa:matching'],
          ['/horoscope', 'Horoscope', 'qa:horoscope'],
        ].map(([href, label, slot]) => (
          <Link key={href} href={href}
            className="surface flex flex-col items-center gap-1 p-3
                       text-center hover:shadow-md">
            {iconNode(slot)}
            <span className="text-xs font-semibold">{label}</span>
          </Link>
        ))}
      </div>
      )}

      {/* Stats */}
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat n={`${(list || []).length || 0}+`} l="Verified Experts" />
        <Stat n="1M+" l="Consultations" />
        <Stat n="4.8" l="Rating Average" />
        <Stat n="12+" l="Languages" />
      </div>

      {/* Personalised stars (from the user's kundli) + generic
          Horoscope. Admin can revert to a single combined section via
          features.stars_split = false. */}
      {sec.starsToday !== false && (() => {
        const split = features.stars_split !== false;
        const genericHead = split ? 'Horoscope' : 'Your stars today';
        const pk = kundlis[Math.min(kIdx, Math.max(0,
          kundlis.length - 1))] || null;
        const pSign = (pk && pk.zodiac)
          || (dob ? signFromDOB(dob) : null);
        const showPersonal = split && !!user;
        const pReading = pSign
          ? horoscopeService.resolveHoroscope(pSign, pWhen, horo)
          : null;
        const who = (pk && pk.name) || profile?.name || 'You';
        return (
          <>
            {showPersonal && (
              <>
                <h2 className="mb-3 mt-8 text-lg font-bold">
                  Your stars today
                </h2>
                {pSign ? (
                <div className="surface p-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="badge bg-bg-light text-primary">
                      {who} - {zodiacLabel(pSign, true)}
                    </span>
                    {kundlis.length > 1 && (
                      <select
                        className="rounded-card border border-gray-200
                          px-2 py-1 text-sm"
                        value={kIdx}
                        onChange={(e) =>
                          setKIdx(Number(e.target.value))}>
                        {kundlis.map((k, i) => (
                          <option key={k.id} value={i}>
                            {(k.name || 'Kundli')}
                            {k.isDefault ? ' (default)' : ''}
                          </option>
                        ))}
                      </select>
                    )}
                    <div className="flex gap-1">
                      {['today', 'tomorrow'].map((w) => (
                        <button key={w} onClick={() => setPWhen(w)}
                          className={pWhen === w
                            ? 'pill pill-active' : 'pill'}>
                          {w === 'today' ? 'Today' : 'Tomorrow'}
                        </button>
                      ))}
                    </div>
                    <Link href="/kundli"
                      className="ml-auto text-sm font-semibold
                        text-primary">
                      Manage kundli
                    </Link>
                  </div>
                  <div className="mt-4">
                    <Daily
                      title={`${zodiacLabel(pSign, true)} - `
                        + `${pWhen === 'today' ? 'Today' : 'Tomorrow'}, `
                        + `${dateLabel(pWhen)}`}
                      h={pReading} />
                  </div>
                </div>
                ) : (
                <div className="surface p-5">
                  <p className="mb-2 text-sm text-sub-text">
                    Add your date of birth to see your own daily stars.
                  </p>
                  <DateField value={dob} label="Your date of birth"
                    onChange={(v) => {
                      setDob(v);
                      if (user && v) {
                        userService.updateUser(user.uid, { dob: v })
                          .catch(() => {});
                      }
                    }} />
                </div>
                )}
              </>
            )}

            <h2 className="mb-3 mt-8 text-lg font-bold">{genericHead}</h2>
            <div className="surface p-5">
              <div className="mb-3">
                <ZodiacPicker value={sign} onChange={setSign}
                  dropdown={features.zodiac_dropdown === true} />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="badge bg-bg-light text-primary">
                  Daily reading
                </span>
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
                  title={`${zodiacLabel(sign, true)} - `
                    + `${when === 'today' ? 'Today' : 'Tomorrow'}, `
                    + `${dateLabel(when)}`}
                  h={reading} />
              </div>
            </div>
          </>
        );
      })()}

      {/* Categories */}
      {sec.categories !== false && (
      <><h2 className="mb-3 mt-8 text-lg font-bold">Browse by category</h2>
      <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
        {CATEGORIES.map(([key, label]) => (
          <Link key={key}
            href={`/astrologers?skill=${encodeURIComponent(key)}`}
            className="surface flex flex-col items-center gap-2 p-4
                       text-center hover:shadow-md">
            <span className="flex h-11 w-11 items-center justify-center
              rounded-xl bg-bg-light">
              {catIcon(key)}
            </span>
            <span className="text-xs font-medium">{label}</span>
          </Link>
        ))}
      </div></>
      )}

      {/* Top rated astrologers */}
      {sec.topRated !== false && (
      <><div className="mb-3 mt-8 flex items-center justify-between">
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
      )}</>
      )}

      {/* Customer ratings & reviews */}
      {sec.reviews !== false && (
      <><div className="mb-3 mt-10 flex items-center justify-between">
        <h2 className="text-lg font-bold">What our customers say</h2>
        <span className="text-sm font-semibold text-gold">
          4.8 / 5 average
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Previous review"
          onClick={() => revStep(-1)}
          className="flex h-9 w-9 shrink-0 items-center justify-center
            rounded-full bg-bg-light text-lg text-primary">
          ‹
        </button>
        <div ref={revRef}
          className="no-scrollbar flex flex-1 overflow-x-auto"
          style={{ scrollSnapType: 'x mandatory',
            WebkitOverflowScrolling: 'touch' }}>
          {((pubReviews && pubReviews.length)
            ? pubReviews.map((r) => [r.userName, r.city, r.rating,
              r.text])
            : CUSTOMER_REVIEWS
          ).map(([name, city, stars, text]) => (
            <div key={name + '|' + String(text).slice(0, 12)}
              style={{ scrollSnapAlign: 'center' }}
              className="w-full shrink-0 px-1">
              <div className="surface p-4">
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
            </div>
          ))}
        </div>
        <button type="button" aria-label="Next review"
          onClick={() => revStep(1)}
          className="flex h-9 w-9 shrink-0 items-center justify-center
            rounded-full bg-bg-light text-lg text-primary">
          ›
        </button>
      </div></>
      )}
    </Layout>
  );
}

function dateLabel(w) {
  const d = new Date();
  if (w === 'tomorrow') d.setDate(d.getDate() + 1);
  return d.toLocaleDateString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  });
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
