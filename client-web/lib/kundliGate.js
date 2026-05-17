import { createContext, useContext, useState } from 'react';
import { useRouter } from 'next/router';
import { kundliService } from '@astro/shared';
import { useAuth } from './useAuth';
import { useAuthModal } from './authModal';
import { DateField, TimeField, CityField } from '../components/BirthInputs';

// Before any chat/call/video: require login, then make the user choose
// (or add) the kundli that will be shared with the astrologer.
const Ctx = createContext({ requestSession: () => {} });

const BLANK = { name: '', dob: '', tob: '', ampm: 'AM', place: '',
  isDefault: true };

export function KundliGateProvider({ children }) {
  const { user, profile } = useAuth();
  const { openLogin } = useAuthModal();
  const router = useRouter();
  const [pending, setPending] = useState(null); // { type, astro }
  const [profiles, setProfiles] = useState([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [lowBal, setLowBal] = useState(null); // { astro, perMin }

  async function requestSession(type, astro) {
    if (!astro) return;
    const href = type === 'chat'
      ? `/chat/${astro.id}`
      : `/call/${astro.id}?type=${type === 'video' ? 'video' : 'call'}`;
    if (!user) {
      // Popup login, then resume this exact action.
      openLogin(() => requestSession(type, astro));
      return;
    }
    // Wallet gate: a session must be able to fund at least 1 minute,
    // UNLESS this is the user's one free first session.
    const eff = (b) => Math.round(
      (Number(b) || 0) * (1 - (Number(astro.discountPercent) || 0) / 100));
    const perMin = type === 'chat' ? eff(astro.priceChat)
      : type === 'video' ? eff(astro.priceVideo) : eff(astro.priceCall);
    const wallet = Number(profile?.wallet || 0);
    const firstFree = !profile?.freeUsed;
    // Recommended top-up = this astrologer's per-minute price x 5 mins
    // (rounded up to the nearest 10), minimum ₹10.
    const recommend = Math.max(10, Math.ceil((perMin * 5) / 10) * 10);
    if (!firstFree && perMin > 0 && wallet < perMin) {
      setLowBal({ astro, perMin, recommend });
      return;
    }
    const list = await kundliService.getKundliProfiles(user.uid);
    setProfiles(list);
    setForm({ ...BLANK, name: profile?.name || '' });
    setAdding(list.length === 0);
    setPending({ type, astro, href });
  }

  function proceed(kundliId) {
    const { href } = pending;
    const sep = href.includes('?') ? '&' : '?';
    setPending(null);
    router.push(kundliId ? `${href}${sep}kundli=${kundliId}` : href);
  }

  async function saveAndProceed(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const id = await kundliService.saveKundli(user.uid,
        { ...form, isDefault: true });
      proceed(id);
    } finally { setBusy(false); }
  }

  return (
    <Ctx.Provider value={{ requestSession }}>
      {children}
      {lowBal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center
                        bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5
                          text-center">
            <div className="text-lg font-bold">Recharge to connect</div>
            <p className="mt-2 text-sm text-sub-text">
              Your wallet balance is too low to start this
              {' '}{lowBal.astro?.name ? `session with ${lowBal.astro.name}`
                : 'session'} ({`₹${lowBal.perMin}/min`}). We recommend
              recharging at least <b>₹{lowBal.recommend}</b> (about 5
              minutes) to connect with this astrologer.
            </p>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setLowBal(null)}
                className="btn-ghost flex-1">Cancel</button>
              <button onClick={() => { const a = lowBal.recommend;
                setLowBal(null);
                router.push(`/wallet?amt=${a}`); }}
                className="btn-grad flex-1 justify-center">
                Recharge ₹{lowBal.recommend}
              </button>
            </div>
          </div>
        </div>
      )}
      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center
                        bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5">
            <div className="mb-1 text-lg font-bold">
              {adding ? 'Add your birth details' : 'Choose a kundli'}
            </div>
            <p className="mb-3 text-sm text-sub-text">
              This is shared with the astrologer at the start of your
              {' '}{pending.type}.
            </p>

            {!adding && (
              <div className="space-y-2">
                {profiles.map((k) => (
                  <button key={k.id} onClick={() => proceed(k.id)}
                    className="surface flex w-full items-center
                               justify-between p-3 text-left
                               hover:shadow-md">
                    <span>
                      <b>{k.name}</b>{' '}
                      <span className="text-sm text-sub-text">
                        {k.dob} · {k.zodiac}
                      </span>
                    </span>
                    <span className="text-primary">Use →</span>
                  </button>
                ))}
                <button onClick={() => setAdding(true)}
                  className="btn-ghost w-full">+ Add new kundli</button>
              </div>
            )}

            {adding && (
              <form onSubmit={saveAndProceed} className="space-y-2">
                <input className="input" placeholder="Name" value={form.name}
                  onChange={(e) =>
                    setForm({ ...form, name: e.target.value })} required />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <DateField value={form.dob}
                    onChange={(dob) => setForm({ ...form, dob })} />
                  <TimeField value={form.tob} ampm={form.ampm}
                    onChange={(tob, ampm) =>
                      setForm({ ...form, tob, ampm })} />
                  <div className="sm:col-span-2">
                    <CityField value={form.place}
                      onChange={(place) => setForm({ ...form, place })} />
                  </div>
                </div>
                <button className="btn-grad w-full justify-center py-3"
                  disabled={busy}>
                  {busy ? 'Saving…' : 'Save & Continue'}
                </button>
              </form>
            )}

            <button onClick={() => setPending(null)}
              className="mt-3 w-full text-center text-sm text-sub-text">
              Cancel
            </button>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useKundliGate() { return useContext(Ctx); }
