import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  astrologerService, reviewService, zodiacLabel,
  iconsService, horoscopeService, kundliService,
  signFromDOB, userService, db, engagementService,
} from '@astro/shared';
import { doc, onSnapshot } from 'firebase/firestore';
import Layout from '../components/Layout';
import { SkeletonList } from '../components/Skeleton';
import AstrologerCard from '../components/AstrologerCard';
import DailyQuoteBanner from '../components/DailyQuoteBanner';
import ZodiacPicker from '../components/ZodiacPicker';
import ZodiacGlyph from '../components/ZodiacGlyph';
import { Icon } from '../components/Icons';

// Maps engagement tile IDs and tile types to their single-color SVG icons.
// Same visual language as the "Browse by category" icons (stroke-only,
// no emoji, colour = currentColor so the maroon theme applies naturally).
const TILE_ICON_MAP = {
  learn_astrology:      Icon.LearnAstrology,
  vedic_astrology:      Icon.VedicAstrology,
  quiz_game:            Icon.QuizGame,
  manifestation:        Icon.Manifestation,
  astro_comic:          Icon.AstroComic,
  tarot_learning:       Icon.TarotLearning,
  numerology_basics:    Icon.NumerologyBasics,
  crystal_guide:        Icon.CrystalGuide,
  gemstone_guide:       Icon.Gemstone,
  daily_rituals:        Icon.DailyRituals,
  palm_reading:         Icon.PalmReading,
  face_reading:         Icon.FaceReading,
  chakra_healing:       Icon.Star,
  zodiac_compatibility: Icon.Star,
  understanding:        Icon.Understanding,
  // type-level fallbacks
  learn:    Icon.LearnAstrology,
  quiz:     Icon.QuizGame,
  manifest: Icon.Manifestation,
  comic:    Icon.AstroComic,
  tarot:    Icon.TarotLearning,
};

// Sum of all earnable points across all lessons / questions in a tile.
function calcTileMaxPoints(tile) {
  if (tile.type === 'learn' || !tile.type) {
    const ls = tile.content?.lessons || [];
    return ls.reduce((s, l) => s + (l.points || tile.pointsPerActivity || 10), 0);
  }
  if (tile.type === 'quiz') {
    const qs = tile.content?.questions || [];
    return qs.reduce((s, q) => s + (q.points || tile.pointsPerActivity || 15), 0);
  }
  if (tile.type === 'manifest') {
    const as = tile.content?.affirmations || [];
    return as.reduce((s, a) => s + (a.points || tile.pointsPerActivity || 5), 0);
  }
  if (tile.type === 'tarot') {
    const cs = tile.content?.cards || [];
    return cs.reduce((s, c) => s + (c.points || tile.pointsPerActivity || 10), 0);
  }
  return tile.pointsPerActivity || 0;
}
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
    // 2026-06-07: button targets are admin-editable from
    // /admin-home-hero. Defaults preserve the legacy behaviour
    // (primary -> /astrologers, secondary -> open signup modal).
    primaryHref: '/astrologers',
    secondaryHref: '',
    secondarySignup: true,
  });
  const [sec, setSec] = useState({}); // section show/hide from admin
  const [statsCfg, setStatsCfg] = useState(null); // [{n,l}] from admin
  const [catLabels, setCatLabels] = useState({}); // key -> label
  const [txt, setTxt] = useState({}); // content.text overrides (Dev 2.0)
  const [engTiles, setEngTiles] = useState([]);
  const [pointsCfg, setPointsCfg] = useState(null);
  const [userPoints, setUserPoints] = useState(null);
  const [showPointsFaq, setShowPointsFaq] = useState(false);
  const [dcDone, setDcDone] = useState(false);
  const [dcAvail, setDcAvail] = useState(false);
  // Editable copy: admin override (settings/content.text[key]) or default.
  const T = (k, d) => (txt && txt[k] != null && txt[k] !== ''
    ? txt[k] : d);
  useEffect(() => {
    // LIVE so an admin change is reflected immediately and a screen
    // switch / refresh never shows the old content.
    const apply = (d) => {
      if (d.homeHeroTitle || d.homeHeroSubtitle
        || d.hero_btn_primary_href != null
        || d.hero_btn_secondary_href != null
        || d.hero_btn_secondary_signup != null) {
        setHero((h) => ({
          ...h,
          title: d.homeHeroTitle || h.title,
          subtitle: d.homeHeroSubtitle || h.subtitle,
          primaryHref: d.hero_btn_primary_href || h.primaryHref,
          secondaryHref: d.hero_btn_secondary_href != null
            ? d.hero_btn_secondary_href : h.secondaryHref,
          secondarySignup: d.hero_btn_secondary_signup !== false,
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
        engagement: d.sec_engagement !== false,
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
        categories: true, topRated: true, reviews: true,
        engagement: true });
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

  useEffect(() => {
    engagementService.getEngagementConfig().then(({ tiles, pointsConfig }) => {
      setEngTiles((tiles || []).filter((t) => t.enabled).sort((a, b) => a.order - b.order));
      setPointsCfg(pointsConfig || null);
    }).catch(() => {});
    // Daily challenge availability (no user needed for existence check)
    engagementService.getTodayChallenge().then((ch) => {
      if (ch && (ch.questions || []).length > 0) setDcAvail(true);
    }).catch(() => {});
  }, []);
  useEffect(() => {
    if (!user) return;
    // Real-time points listener so the badge updates the moment points
    // are awarded anywhere (another tab, the engage page, daily challenge).
    const ptsRef = doc(db, 'users', user.uid, 'engagement', 'points');
    const unsub = onSnapshot(ptsRef, (snap) => {
      const d = (snap.exists() && snap.data()) || {};
      setUserPoints(Math.max(0,
        Number(d.total || 0) - Number(d.redeemed || 0)));
    }, () => setUserPoints(0));
    const today = new Date().toISOString().slice(0, 10);
    engagementService.getDailyChallengeProgress(user.uid, today)
      .then((p) => { if (p && p.completed) setDcDone(true); })
      .catch(() => {});
    return () => unsub();
  }, [user?.uid]);

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
      if (!dob && arr.length > 0 && arr[0].dob) {
        setDob(arr[0].dob);
        userService.updateUser(user.uid, { dob: arr[0].dob })
          .catch(() => {});
      }
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
              {/* 2026-06-07: primary + secondary buttons are now
                  admin-driven (see /admin-home-hero). Primary always
                  navigates. Secondary either opens the signup modal
                  (legacy default, guest-only) OR navigates to a path
                  the admin set. Empty secondary label hides the
                  button entirely. */}
              <div className="mt-5 flex flex-wrap gap-2">
                <Link href={hero.primaryHref || '/astrologers'}
                  className="rounded-full bg-white px-5 py-2.5
                             font-semibold text-primary">
                  {T('home.browseCta', 'Browse astrologers')}
                </Link>
                {T('home.getStarted', 'Get started') && (() => {
                  if (hero.secondarySignup) {
                    if (user) return null;
                    return (
                      <button
                        onClick={() =>
                          openLogin(undefined, { mode: 'signup' })}
                        className="rounded-full bg-white/20 px-5
                                   py-2.5 font-semibold">
                        {T('home.getStarted', 'Get started')}
                      </button>
                    );
                  }
                  if (!hero.secondaryHref) return null;
                  return (
                    <Link href={hero.secondaryHref}
                      className="rounded-full bg-white/20 px-5 py-2.5
                                 font-semibold text-white">
                      {T('home.getStarted', 'Get started')}
                    </Link>
                  );
                })()}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Daily quote banner ("Hey, Cosmic Explorer"). Self-gating -
          renders nothing unless settings/dailyQuotes.enabled is true,
          so the admin toggle is the single show / hide lever. */}
      <DailyQuoteBanner />

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

      {sec.engagement !== false && engTiles.length > 0 && (
      <>
      {/* Points FAQ modal */}
      {showPointsFaq && (
        <div className="fixed inset-0 z-50 flex items-end justify-center
          bg-black/40 p-4 sm:items-center"
          onClick={() => setShowPointsFaq(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-bold" style={{ color: '#7F2020' }}>
                Points and Wallet
              </h3>
              <button type="button" onClick={() => setShowPointsFaq(false)}
                className="text-gray-400 text-xl leading-none">&times;</button>
            </div>
            <div className="space-y-3 text-sm text-gray-700">
              <div className="rounded-lg bg-amber-50 p-3">
                <div className="font-bold text-amber-800">How to earn points</div>
                <p className="mt-1 text-xs">Complete lessons, answer quiz questions correctly, and finish daily challenges. Points are awarded only for correct answers.</p>
              </div>
              <div className="rounded-lg bg-green-50 p-3">
                <div className="font-bold text-green-800">Converting to wallet</div>
                <p className="mt-1 text-xs">
                  {pointsCfg
                    ? `${(pointsCfg.pointsToInr || 10000).toLocaleString()} points = &#8377;100 wallet credit. Minimum redemption: &#8377;${pointsCfg.minRedemptionInr || 100}.`
                    : '10,000 points = &#8377;100 wallet credit. Minimum redemption: &#8377;100.'}
                </p>
              </div>
              <div className="rounded-lg bg-blue-50 p-3">
                <div className="font-bold text-blue-800">Daily Challenge</div>
                <p className="mt-1 text-xs">Answer 5 astrology questions every day. Earn up to 50 bonus points daily. Challenges reset at midnight.</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3">
                <div className="font-bold text-gray-700">Redeeming points</div>
                <p className="mt-1 text-xs">Go to the Points page, enter the number of points you want to redeem, and the equivalent amount will be added to your wallet instantly.</p>
              </div>
            </div>
            <Link href="/points"
              className="mt-4 block w-full rounded-lg py-2.5 text-center
                text-sm font-bold text-white"
              style={{ backgroundColor: '#7F2020' }}
              onClick={() => setShowPointsFaq(false)}>
              View my points
            </Link>
          </div>
        </div>
      )}
      <div className="mb-3 mt-8 flex items-center justify-between">
        <h2 className="text-lg font-bold">
          {T('home.engageTitle', 'Learn & Earn')}</h2>
        <div className="flex items-center gap-2">
          {user && userPoints != null && (
            <Link href="/points"
              className="rounded-full px-2 py-0.5 text-xs font-bold"
              style={{ backgroundColor: '#7F2020', color: '#FFF8E7' }}>
              {userPoints.toLocaleString()} pts
            </Link>
          )}
          <button type="button" onClick={() => setShowPointsFaq(true)}
            className="rounded-full px-2 py-0.5 text-xs font-semibold"
            style={{ backgroundColor: '#FFF8E7', color: '#D4A12A',
              border: '1px solid #D4A12A' }}>
            {engTiles.reduce((s, t) => s + calcTileMaxPoints(t), 0).toLocaleString()} pts earnable
          </button>
        </div>
      </div>
      <button type="button" onClick={() => setShowPointsFaq(true)}
        className="mb-4 w-full rounded-2xl px-4 py-2.5 text-left text-xs
          font-semibold transition hover:opacity-90"
        style={{ backgroundColor: '#FFF8E7', color: '#D4A12A',
          border: '1px solid #D4A12A' }}>
        Earned points can be converted to wallet balance. Tap to learn how.
      </button>
      {/* Daily Challenge card in grid */}
      {dcAvail && (
        <Link href="/daily-challenge"
          className="mb-4 flex items-center justify-between rounded-2xl
            px-4 py-3 text-white"
          style={{ background: 'linear-gradient(135deg, #7F2020 0%, #4a1212 100%)' }}>
          <div>
            <div className="text-xs font-bold uppercase tracking-widest opacity-70">
              Daily Challenge
            </div>
            <div className="text-sm font-extrabold">
              {dcDone
                ? 'Challenge done today! Come back tomorrow'
                : 'Answer today\'s questions and earn bonus points'}
            </div>
            <div className="mt-1 text-[10px] opacity-60">Up to 50 bonus points per day</div>
          </div>
          <Icon.Star className="h-8 w-8 shrink-0 opacity-60" />
        </Link>
      )}
      <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
        {engTiles.map((tile) => {
          const TileIcon = TILE_ICON_MAP[tile.id] || TILE_ICON_MAP[tile.type]
            || Icon.Star;
          return (
            <Link key={tile.id} href={`/engage/${tile.id}`}
              className="surface relative flex flex-col items-center gap-2
                         rounded-xl p-3 text-center transition hover:shadow-md"
              style={{ borderBottom: '3px solid #D4A12A' }}>
              <span className="flex h-11 w-11 items-center justify-center
                rounded-xl"
                style={{ backgroundColor: '#FFF8E7' }}>
                <TileIcon className="h-6 w-6" style={{ color: '#7F2020' }} />
              </span>
              <span className="w-full text-xs font-bold leading-tight"
                style={{ color: '#7F2020' }}>
                {tile.name}
              </span>
              <span className="w-full text-[10px] leading-snug text-gray-500"
                style={{ display: '-webkit-box', WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {tile.description}
              </span>
              <span className="mt-auto rounded-full px-2 py-0.5 text-[10px] font-bold"
                style={{ backgroundColor: '#7F2020', color: '#FFF8E7' }}>
                +{calcTileMaxPoints(tile)} pts
              </span>
            </Link>
          );
        })}
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
