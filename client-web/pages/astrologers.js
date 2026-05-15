import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import { astrologerService } from '@astro/shared';
import Layout from '../components/Layout';
import AstrologerCard from '../components/AstrologerCard';
import { SkeletonList, ErrorState, EmptyState } from '../components/Skeleton';
import { useOptionalClient } from '../lib/useAuth';
import { useAstroActions } from '../lib/useAstroActions';
import { getFavorites } from '../lib/favorites';

const PAGE = 12;
const CHIPS = ['All', 'Love', 'Career', 'Marriage', 'Health',
  'Finance', 'Education', 'Vedic', 'Tarot', 'Numerology'];

export default function Astrologers() {
  const { user, loading } = useOptionalClient();
  const router = useRouter();
  const { go } = useAstroActions(user);
  const [all, setAll] = useState(null);
  const [err, setErr] = useState(false);
  const [visible, setVisible] = useState(PAGE);
  const [chip, setChip] = useState('All');
  const [search, setSearch] = useState('');
  const debounced = useRef(null);
  const openProfile = (a) => router.push(`/astrologer/${a.id}`);

  async function load(skill) {
    setErr(false); setAll(null);
    try {
      setAll(await astrologerService.getAstrologers(
        skill && skill !== 'All' ? { skill } : {}));
    } catch { setErr(true); }
  }

  // Honour ?skill= from the dashboard category tiles.
  useEffect(() => {
    if (loading) return;
    const s = typeof router.query.skill === 'string' ? router.query.skill : '';
    if (s && CHIPS.includes(s)) setChip(s);
    load(s || 'All');
    // eslint-disable-next-line
  }, [loading, router.query.skill]);

  useEffect(() => { /* favourites preloaded for future use */
    if (user) getFavorites(user.uid).catch(() => {});
  }, [user]);

  function pickChip(c) {
    setChip(c);
    load(c);
  }
  function onSearch(v) {
    setSearch(v);
    clearTimeout(debounced.current);
    debounced.current = setTimeout(() => {
      astrologerService.getAstrologers(
        chip !== 'All' ? { skill: chip, search: v } : { search: v })
        .then(setAll).catch(() => setErr(true));
    }, 300);
  }

  return (
    <Layout>
      <h1 className="text-2xl font-bold md:text-3xl">Our astrologers</h1>
      <p className="mb-4 text-sub-text">
        {all == null ? 'Loading…' : `${all.length} experts available`}
      </p>

      <div className="surface mb-4 p-3">
        <input className="input mb-3" placeholder="Search by name…"
          value={search} onChange={(e) => onSearch(e.target.value)} />
        <div className="flex gap-2 overflow-x-auto pb-1">
          {CHIPS.map((c) => (
            <button key={c} onClick={() => pickChip(c)}
              className={`whitespace-nowrap ${
                chip === c ? 'pill pill-active' : 'pill'}`}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {err ? (
        <ErrorState onRetry={() => load(chip)} />
      ) : all == null ? (
        <SkeletonList count={6} />
      ) : all.length === 0 ? (
        <EmptyState message="No astrologers match your search." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2
                          lg:grid-cols-4">
            {all.slice(0, visible).map((a) => (
              <AstrologerCard key={a.id} a={a} onOpen={openProfile}
                onChat={(x) => go('chat', x)} />
            ))}
          </div>
          {visible < all.length && (
            <button onClick={() => setVisible((v) => v + PAGE)}
              className="mx-auto mt-6 block rounded-full border
                         border-gray-200 bg-white px-6 py-3 font-semibold">
              Load more
            </button>
          )}
        </>
      )}
    </Layout>
  );
}
