import { useEffect, useState } from 'react';
import { followService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAstrologer } from '../lib/useAuth';

// The astrologer sees ONLY a limited follower card: display picture,
// name, unique ID and the date they started following. Tapping the DP
// shows it a little larger in a popup - never the full customer
// profile.
function fmt(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric' });
}

export default function AstroFollowers() {
  const { user, loading } = useRequireAstrologer();
  const [rows, setRows] = useState(null);
  const [dp, setDp] = useState(null);

  useEffect(() => {
    if (!user) return;
    followService.getFollowers(user.uid)
      .then(setRows).catch(() => setRows([]));
  }, [user]);

  if (loading || rows === null) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }

  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">Followers</h1>
      <p className="mb-3 text-sm text-sub-text">
        People following you. You can see their name and ID only - tap
        the picture to view it. They are notified when you go Live or
        Online.
      </p>
      {rows.length === 0 ? (
        <div className="card text-sub-text">No followers yet.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((f) => (
            <div key={f.uid} className="card flex items-center gap-3">
              <button onClick={() => setDp(f)}
                className="h-12 w-12 shrink-0 overflow-hidden
                  rounded-full bg-bg-light">
                {f.dp ? (
                  <img src={f.dp} alt=""
                    className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center
                    justify-center font-bold text-primary">
                    {(f.name || 'U').charAt(0).toUpperCase()}
                  </span>
                )}
              </button>
              <div className="min-w-0">
                <div className="font-semibold">{f.name}</div>
                <div className="text-xs text-sub-text">
                  Following since {fmt(f.at)}
                </div>
                <div className="text-xs text-sub-text">
                  ID: {f.code || f.uid.slice(0, 6).toUpperCase()}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {dp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center
          bg-black/60 px-6" onClick={() => setDp(null)}>
          <div className="rounded-2xl bg-white p-5 text-center"
            onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto h-40 w-40 overflow-hidden
              rounded-2xl bg-bg-light">
              {dp.dp ? (
                <img src={dp.dp} alt=""
                  className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center
                  justify-center text-5xl font-bold text-primary">
                  {(dp.name || 'U').charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <div className="mt-3 font-semibold">{dp.name}</div>
            <div className="text-xs text-sub-text">
              ID: {dp.code || dp.uid.slice(0, 6).toUpperCase()}
            </div>
            <div className="text-xs text-sub-text">
              Following since {fmt(dp.at)}
            </div>
            <button onClick={() => setDp(null)}
              className="btn-primary mt-4 w-full !min-h-0 py-2 text-sm">
              Close
            </button>
          </div>
        </div>
      )}
    </Layout>
  );
}
