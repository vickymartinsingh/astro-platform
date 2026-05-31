import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  astrologerService, reviewService, zodiacLabel,
  iconsService, horoscopeService, kundliService,
  signFromDOB, userService, db,
} from '@astro/shared';
import { doc, onSnapshot } from 'firebase/firestore';
import Layout from '../components/Layout';
import { SkeletonList } from '../components/Skeleton';
import AstrologerCard from '../components/AstrologerCard';
import ZodiacPicker from '../components/ZodiacPicker';
import ZodiacGlyph from '../components/ZodiacGlyph';
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

// App-wide cache of settings/content so a screen switch paints the
// latest known values instantly (never the stale old ones).
let CONTENT_CACHE;
try {
  if (typeof localStorage !== 'undefined') {
    const s = localStorage.getItem('settings_content');
    if (s) CONTENT_CACHE = JSON.parse(s);
  }
} catch (_) { /* ignore */ }

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
  const [statsCfg, setStatsCfg] = useState(null); // [{n,l}] from admin
  const [catLabels, setCatLabels] = useState({}); // key -> label
  const [txt, setTxt] = useState({}); // content.text overrides (Dev 2.0)
  // Editable copy: admin override (settings/content.text[key]) or default.
  const T = (k, d) => (txt && txt[k] != null && txt[k] !== ''
    ? txt[k] : d);
  useEffect(() => {
    // LIVE so an admin change is reflected immediately and a screen
    // switch / refresh never shows the old content.
    const apply = (d) => {
      if (d.homeHeroTitle || d.homeHeroSubtitle) {
        setHero((h) => ({
          title: d.homeHeroTitle || h.title,
          subtitle: d.homeHeroSubtitle || h.subtitle,
        }));
      }
      setStatsCfg(Array.isArray(d.home_stats) ? d.home_stats : null);
      setCatLabels(d.cat_labels && typeof d.cat_labels === 'object'
        ? d.cat_labels : {});
      setTxt(d.text && typeof d.text === 'object' ? d.text : {});
      setSec({
        quickActions: d.sec_quickActions !== false,
        starsToday: d.sec_starsToday !== false,
        categories: d.sec_categories !== false,
        topRated: d.sec_topRated !== false,
        reviews: d.sec_reviews !== false,
        // Per-device master toggles for the home hero banner ("The
        // stars have answers") and the stats strip. All four default
        // ON. The Firestore snapshot pushes any flip live with no
        // reload required.
        heroMobile: d.home_hero_show_mobile !== false,
        heroDesktop: d.home_hero_show_desktop !== false,
        statsMobile: d.home_stats_show_mobile !== false,
        statsDesktop: d.home_stats_show_desktop !== false,
      });
    };
    if (CONTENT_CACHE) apply(CONTENT_CACHE);
    try {
      return onSnapshot(doc(db, 'settings', 'content'), (s) => {
        const d = s.exists() ? s.data() : {};
        CONTENT_CACHE = d;
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('settings_content', JSON.stringify(d));
          }
        } catch (_) { /* ignore */ }
        apply(d);
      }, () => {});
    } catch (_) {
      setSec({ quickActions: true, starsToday: true,
        categories: true, topRated: true, reviews: true });
      return undefined;
    }
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
  // Default per-tile emoji so a fresh install (no admin icon overrides
  // in settings/icons) doesn't render "undefined" for the new Vedic /
  // Numerology / Palm / Face tiles. Admin can still upload a custom
  // image via /admin-icons - the override always wins.
  const DEFAULT_EMOJI = {
    'qa:tarot': '🃏', 'qa:kundli': '📜', 'qa:matching': '💞',
    'qa:horoscope': '🌞', 'qa:vedic': '🕉️', 'qa:numerology': '🔢',
    'qa:palm': '🖐️', 'qa:face': '👁️',
  };
  const iconNode = (slot) => {
    if (iconsService.isImage(icons[slot])) {
      return (
        <img src={icons[slot]} alt="" className="h-8 w-8 object-contain" />
      );
    }
    const glyph = icons[slot] || DEFAULT_EMOJI[slot] || '✨';
    return <span className="text-2xl leading-none">{glyph}</span>;
  };
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

      {/* Hero. On desktop we cap the inner content to max-w-2xl so the
          gradient panel still spans the layout column but the title /
          subtitle / CTAs sit comfortably on the left instead of
          reading as "empty right half." Visibility is gated on two
          independent admin master toggles (settings/content
          .home_hero_show_mobile and .home_hero_show_desktop) so the
          banner can be hidden on one form factor without affecting
          the other - live, no reload. */}
      {(sec.heroMobile !== false || sec.heroDesktop !== false) && (() => {
        const showMobile = sec.heroMobile !== false;
        const showDesktop = sec.heroDesktop !== false;
        const visibility = showMobile && showDesktop ? ''
          : showMobile ? 'md:hidden' : 'hidden md:block';
        return (
          <div className={`hero-grad rounded-2xl p-6 text-white
            md:px-8 md:py-8 lg:px-10 lg:py-10 ${visibility}`}>
            <div className="max-w-2xl">
              <h1 className="text-2xl font-bold md:text-3xl lg:text-4xl">
                {hero.title}
              </h1>
              <p className="mt-2 max-w-lg text-sm opacity-90 md:text-base">
                {hero.subtitle}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link href="/astrologers"
                  className="rounded-full bg-white px-5 py-2.5
                             font-semibold text-primary">
                  {T('home.browseCta', 'Browse astrologers')}
                </Link>
                {!user && (
                  <button
                    onClick={() => openLogin(undefined, { mode: 'signup' })}
                    className="rounded-full bg-white/20 px-5 py-2.5
                               font-semibold">
                    {T('home.getStarted', 'Get started')}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Quick actions. 4-column grid wraps to two rows of four when
          we have 8+ tiles. Tarot / Kundli / Matching / Horoscope are
          the originals; Vedic / Numerology / Palm / Face are the new
          tiles the user asked for, each pointing at the right entry
          (Vedic + Palm + Face deep-link into /discover so they share
          the AstroSeer feature catalog; Numerology routes to the
          free, on-device Chaldean tool extended with lucky-number,
          name-correction, lucky-day / colour helpers). */}
      {sec.quickActions !== false && (
      <div className="mt-4 grid grid-cols-4 gap-3">
        {[
          ['/tarot', 'Tarot', 'qa:tarot'],
          ['/kundli', 'Kundli', 'qa:kundli'],
          ['/matching', 'Matching', 'qa:matching'],
          ['/horoscope', 'Horoscope', 'qa:horoscope'],
          ['/vedic', 'Vedic', 'qa:vedic'],
          ['/numerology', 'Numerology', 'qa:numerology'],
          ['/palm-reading', 'Palm', 'qa:palm'],
          ['/face-reading', 'Face', 'qa:face'],
        ].map(([href, label, slot]) => (
          <Link key={href} href={href}
            className="surface flex flex-col items-center gap-1 p-3
                       text-center hover:shadow-md">
            {iconNode(slot)}
            <span className="text-xs font-semibold">
              {T(`home.qa.${slot}`, label)}
            </span>
          </Link>
        ))}
      </div>
      )}

      {/* Stats (admin-editable: settings/content.home_stats). Use the
          {experts} placeholder to show the live astrologer count.
          The strip is gated on TWO independent admin master toggles:
          home_stats_show_mobile (default ON) and home_stats_show_desktop
          (default ON). We render the strip twice with responsive
          visibility classes so admins can hide it on one form factor
          without affecting the other - the Firestore snapshot pushes
          the change instantly. */}
      {(() => {
        const DEF = [
          { n: '{experts}+', l: 'Verified Experts' },
          { n: '1M+', l: 'Consultations' },
          { n: '4.8', l: 'Rating Average' },
          { n: '12+', l: 'Languages' },
        ];
        const rows = (Array.isArray(statsCfg) && statsCfg.length
          ? statsCfg : DEF)
          .filter((s) => s && s.show !== false
            && (s.l || s.n));
        if (!rows.length) return null;
        const cnt = (list || []).length || 0;
        const showMobile = sec.statsMobile !== false;
        const showDesktop = sec.statsDesktop !== false;
        if (!showMobile && !showDesktop) return null;
        const StatGrid = ({ visibility }) => (
          <div className={`mt-4 grid grid-cols-2 gap-3
            md:grid-cols-4 ${visibility}`}>
            {rows.map((s) => (
              <Stat key={`${s.l || ''}|${s.n || ''}`}
                n={String(s.n || '').replace('{experts}', String(cnt))}
                l={s.l || ''} />
            ))}
          </div>
        );
        // Mobile-only render when desktop is off, desktop-only when
        // mobile is off, render once with no visibility class when both
        // are on (saves a duplicate DOM tree).
        if (showMobile && showDesktop) return <StatGrid visibility="" />;
        if (showMobile) return <StatGrid visibility="md:hidden" />;
        return <StatGrid visibility="hidden md:grid" />;
      })()}

      {/* Personalised stars (from the user's kundli) + generic
          Horoscope. Admin can revert to a single combined section via
          features.stars_split = false. */}
      {sec.starsToday !== false && (() => {
        const split = features.stars_split !== false;
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
                  {T('home.starsTitle', 'Your stars today')}
                </h2>
                {pSign ? (
                <div className="surface p-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex h-9 w-9 items-center
                      justify-center rounded-full bg-bg-light">
                      {iconsService.isImage(icons[`zod:${pSign}`])
                        ? (
                          <img src={icons[`zod:${pSign}`]} alt=""
                            className="h-6 w-6 object-contain" />
                        ) : (
                          <ZodiacGlyph sign={pSign}
                            className="h-6 w-6 text-gold" />
                        )}
                    </span>
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

            {!split && (
              <>
                <h2 className="mb-3 mt-8 text-lg font-bold">
                  {T('home.starsTitle', 'Your stars today')}
                </h2>
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
                          className={when === w
                            ? 'pill pill-active' : 'pill'}>
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
            )}
          </>
        );
      })()}

      {/* Categories */}
      {sec.categories !== false && (
      <><h2 className="mb-3 mt-8 text-lg font-bold">
        {T('home.catTitle', 'Browse by category')}</h2>
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
            <span className="text-xs font-medium">
              {catLabels[key] || label}
            </span>
          </Link>
        ))}
      </div></>
      )}

      {/* Top rated astrologers */}
      {sec.topRated !== false && (
      <><div className="mb-3 mt-8 flex items-center justify-between">
        <h2 className="text-lg font-bold">
          {T('home.topRatedTitle', 'Top rated astrologers')}</h2>
        <Link href="/astrologers"
          className="text-sm font-semibold text-primary">
          {T('home.seeAll', 'See all')}</Link>
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
