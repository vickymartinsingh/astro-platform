import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { sessionService, userService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAstrologer } from '../lib/useAuth';

export default function AstroSessions() {
  const router = useRouter();
  const { user, loading } = useRequireAstrologer();
  const [rows, setRows] = useState(null);
  const [all, setAll] = useState(false);

  async function load() {
    const list = await sessionService.getAstrologerSessions(user.uid);
    const withNames = await Promise.all(list.map(async (s) => ({
      ...s, client: (await userService.getUser(s.userId))?.name,
    })));
    setRows(withNames);
  }
  useEffect(() => { if (user) load(); /* eslint-disable-next-line */ },
    [user]);

  if (loading || rows == null) {
    return <Layout><div className="surface p-4">Loading…</div></Layout>;
  }

  const cutoff = Date.now() - 7 * 7 * 864e5;
  const shown = all ? rows : rows.filter((s) =>
    s.createdAt?.toDate && s.createdAt.toDate().getTime() >= cutoff);

  return (
    <Layout>
      <h1 className="mb-3 text-2xl font-bold">My Sessions</h1>
      <div className="surface overflow-x-auto p-2">
        <table className="w-full text-sm">
          <thead className="text-left text-sub-text">
            <tr>
              <th className="p-2">Client</th><th className="p-2">Type</th>
              <th className="p-2">Dur</th><th className="p-2">Gross</th>
              <th className="p-2">Earned</th><th className="p-2">Status</th>
              <th className="p-2">Chat</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="p-2">{s.client || '-'}</td>
                <td className="p-2 capitalize">{s.type}</td>
                <td className="p-2">{Math.round((s.duration || 0) / 60)}m</td>
                <td className="p-2">₹{s.cost || 0}</td>
                <td className="p-2 font-semibold text-success">
                  ₹{s.astrologerEarning || 0}
                </td>
                <td className="p-2 capitalize">{s.status}</td>
                <td className="p-2">
                  <button onClick={() => router.push(`/astro-chat/${s.id}`)}
                    className="font-semibold text-primary">View chat</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!all && (
        <button onClick={() => setAll(true)}
          className="btn-ghost mt-4 w-full">Show all history</button>
      )}
    </Layout>
  );
}
