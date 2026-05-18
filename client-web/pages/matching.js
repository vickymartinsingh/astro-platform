import { useState } from 'react';
import {
  gunaMilan, signFromDOB, ZODIAC, ZODIAC_IN,
} from '@astro/shared';
import Layout from '../components/Layout';
import { useOptionalClient } from '../lib/useAuth';
import { DateField, CityField } from '../components/BirthInputs';

// Kundli / Marriage matching (simplified Guna Milan, /36).
function Person({ label, p, set }) {
  return (
    <div className="surface space-y-3 p-4">
      <div className="font-semibold">{label}</div>
      <input className="input" placeholder="Name" value={p.name}
        onChange={(e) => set({ ...p, name: e.target.value })} />
      <DateField value={p.dob}
        onChange={(dob) =>
          set({ ...p, dob, sign: signFromDOB(dob) || p.sign })} />
      <CityField value={p.place || ''}
        onChange={(place) => set({ ...p, place })} />
      <div>
        <label className="text-sm text-sub-text">Zodiac sign</label>
        <select className="input mt-1" value={p.sign}
          onChange={(e) => set({ ...p, sign: e.target.value })}>
          {ZODIAC.map((z) => {
            const r = ZODIAC_IN[z] || { en: z, dev: '' };
            return (
              <option key={z} value={z}>
                {r.dev} {r.en} ({z})
              </option>
            );
          })}
        </select>
      </div>
    </div>
  );
}

export default function Matching() {
  const { loading } = useOptionalClient();
  const [boy, setBoy] = useState({ name: '', dob: '', sign: 'Aries' });
  const [girl, setGirl] = useState({ name: '', dob: '', sign: 'Libra' });
  const [res, setRes] = useState(null);

  if (loading) {
    return <Layout><div className="surface p-6">Loading…</div></Layout>;
  }

  return (
    <Layout>
      <h1 className="text-2xl font-bold md:text-3xl">Marriage Matching</h1>
      <p className="mb-4 text-sub-text">
        Ashtakoot Guna Milan compatibility (out of 36).
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <Person label="Groom" p={boy} set={setBoy} />
        <Person label="Bride" p={girl} set={setGirl} />
      </div>

      <button onClick={() => setRes(gunaMilan(boy, girl))}
        className="btn-grad mt-4">Match Kundli</button>

      {res && (
        <div className="surface mt-6 p-5">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-sm text-sub-text">Total Guna</div>
              <div className="text-3xl font-bold text-primary">
                {res.total}<span className="text-base text-sub-text">/36</span>
              </div>
            </div>
            <div className="text-right text-sm font-semibold">
              {res.percent}% compatible
            </div>
          </div>
          <div className="my-3 h-2 rounded-full bg-bg-light">
            <div className="h-2 rounded-full bg-gradient-to-r
              from-primary to-[#8B5CF6]"
              style={{ width: `${res.percent}%` }} />
          </div>
          <p className="mb-4 font-medium">{res.verdict}</p>
          <table className="w-full text-sm">
            <thead className="text-left text-sub-text">
              <tr><th className="py-1">Koota</th><th>Meaning</th>
                <th className="text-right">Score</th></tr>
            </thead>
            <tbody>
              {res.rows.map((r) => (
                <tr key={r.name} className="border-t">
                  <td className="py-2 font-medium">{r.name}</td>
                  <td className="text-sub-text">{r.desc}</td>
                  <td className="text-right font-semibold">
                    {r.score}/{r.max}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-sub-text">
            Note: a precise Ashtakoot needs Moon nakshatra. This estimate is
            indicative. Consult an astrologer for a full match.
          </p>
        </div>
      )}
    </Layout>
  );
}
