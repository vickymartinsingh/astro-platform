import { useState, useEffect } from 'react';
import { numerologyService } from '@astro/shared';
import Layout from '../components/Layout';
import { useAuth } from '../lib/useAuth';
import { DateField } from '../components/BirthInputs';

// Chaldean numerology report: personalised per name + DOB.
// Shows life path, destiny, soul, personality, personal year, plus
// full details: health, habits, interests, finance, strengths,
// challenges, advice. Derivation steps shown so the user can see
// how their numbers were computed.
export default function Numerology() {
  const { profile } = useAuth();
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [report, setReport] = useState(null);

  useEffect(() => {
    if (profile?.name) setName(profile.name);
    if (profile?.dob) setDob(profile.dob);
  }, [profile?.name, profile?.dob]);

  // Auto-generate when profile pre-fills.
  useEffect(() => {
    if (profile?.name && profile?.dob) {
      setReport(numerologyService.fullReport({
        name: profile.name,
        dob: profile.dob,
      }));
    }
  }, [profile?.name, profile?.dob]);

  function compute(e) {
    if (e) e.preventDefault();
    if (!name && !dob) return;
    setReport(numerologyService.fullReport({ name, dob }));
  }

  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">Numerology Report</h1>
      <p className="mb-4 text-sm text-sub-text">
        Chaldean numerology, the system widely used in India.
        Enter your full name and date of birth to get a detailed,
        personalised report covering your personality, career, health,
        habits, interests, finances and more.
      </p>

      <form onSubmit={compute} className="card mb-4 space-y-3">
        <label className="block text-sm">
          Full name (as it appears on your documents)
          <input className="input mt-1" value={name}
            placeholder="e.g. Ravi Kumar Sharma"
            onChange={(e) => setName(e.target.value)} />
        </label>
        <DateField value={dob} onChange={setDob} />
        <button type="submit" className="btn-primary w-full">
          Generate my report
        </button>
      </form>

      {report && (
        <div className="space-y-3">
          {/* Headline numbers grid */}
          <div className="card">
            <div className="mb-2 text-[10px] font-bold uppercase
              tracking-wider text-sub-text">Your core numbers</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <BigNum label="Life Path" value={report.lifePath}
                sub={report.lifeTraits?.keyword} />
              <BigNum label="Destiny" value={report.destiny}
                sub={report.destinyTraits?.keyword} />
              <BigNum label="Soul Urge" value={report.soul}
                sub={report.soulTraits?.keyword} />
              <BigNum label="Personality" value={report.personality}
                sub={report.personalityTraits?.keyword} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs
              sm:grid-cols-4">
              <Mini label="Birth day" value={report.birthday} />
              <Mini label={`Personal year (${new Date().getFullYear()})`}
                value={report.personalYear} />
              <Mini label="Lucky numbers"
                value={report.luckyNumbers.join(', ')} />
              <Mini label="Lucky day"
                value={report.lifeTraits?.lucky?.day || '-'} />
            </div>
          </div>

          {/* Quick tools */}
          <ToolStrip name={name} dob={dob} />

          {/* Life Path: most important number */}
          <SectionFull
            title="Life Path"
            n={report.lifePath}
            traits={report.lifeTraits}
            tagline="Your overall life purpose and the main lessons you are here to learn. Calculated from your date of birth."
            derivation={report.lifePathDerivation}
          />

          {/* Destiny */}
          <SectionFull
            title="Destiny / Expression"
            n={report.destiny}
            traits={report.destinyTraits}
            tagline="The work you are here to do in this lifetime. Calculated from all the letters in your full name."
            derivation={report.destinyDerivation}
          />

          {/* Soul Urge */}
          <SectionCore
            title="Soul Urge"
            n={report.soul}
            traits={report.soulTraits}
            tagline="What your heart truly wants deep down. Calculated from the vowels in your name."
          />

          {/* Personality */}
          <SectionCore
            title="Personality"
            n={report.personality}
            traits={report.personalityTraits}
            tagline="How others see you from the outside. Calculated from the consonants in your name."
          />

          {/* Personal year */}
          <SectionCore
            title={`Personal Year ${new Date().getFullYear()}`}
            n={report.personalYear}
            traits={report.yearTraits}
            tagline={`The energy and themes of this current year (${new Date().getFullYear()}) for you.`}
          />

          {/* Combined overview */}
          {report.lifeTraits && report.destinyTraits && (
            <CombinedOverview report={report} />
          )}
        </div>
      )}
    </Layout>
  );
}

// Full section: personality + career + health + habits + interests
// + finance + strengths + challenges + advice + lucky row.
function SectionFull({ title, n, traits, tagline, derivation }) {
  const [open, setOpen] = useState(true);
  if (!traits) return null;
  const l = traits.lucky || {};
  return (
    <div className="overflow-hidden rounded-2xl border border-amber-100
      bg-white">
      {/* Header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2
          border-b border-amber-50 bg-amber-50 px-3 py-2.5">
        <div className="text-left">
          <div className="text-[10px] font-bold uppercase tracking-wider
            text-sub-text">{title}</div>
          <div className="text-base font-bold text-dark-text">
            {n}{' '}
            <span className="text-sm font-medium text-primary">
              {traits.keyword}
            </span>
          </div>
        </div>
        <svg viewBox="0 0 24 24" width="18" height="18"
          className={`shrink-0 transition-transform ${open
            ? 'rotate-180' : ''}`}>
          <path d="M6 9l6 6 6-6" fill="none"
            stroke="#7F2020" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="space-y-0 divide-y divide-gray-50 px-3 pb-3">
          {tagline && (
            <p className="py-2 text-[11px] text-sub-text">{tagline}</p>
          )}
          {derivation && (
            <div className="py-2">
              <div className="mb-1 text-[10px] font-bold uppercase
                tracking-wide text-sub-text">How this number is
                calculated</div>
              <div className="rounded-xl bg-amber-50 px-3 py-2
                font-mono text-[10px] leading-relaxed text-amber-800">
                {derivation}
              </div>
            </div>
          )}
          <RowFull label="Who you are" body={traits.personality} />
          <RowFull label="Career and work" body={traits.career} />
          <RowFull label="Health" body={traits.health} />
          <RowFull label="Daily habits" body={traits.habits} />
          <RowFull label="Interests and hobbies"
            body={traits.interests} />
          <RowFull label="Money and finances" body={traits.finance} />
          <RowFull label="Strengths" body={traits.strengths}
            accent="success" />
          <RowFull label="Challenges" body={traits.challenges}
            accent="warning" />
          <RowFull label="Advice for you" body={traits.advice}
            accent="info" />
          <RowFull label="Love and relationships" body={traits.love} />
          <div className="pt-2">
            <div className="mb-1.5 text-[10px] font-bold uppercase
              tracking-wide text-sub-text">Lucky details</div>
            <div className="grid grid-cols-2 gap-2 text-xs
              sm:grid-cols-4">
              <Chip label="Colour" v={l.color} />
              <Chip label="Day" v={l.day} />
              <Chip label="Stone" v={l.stone} />
              <Chip label="Planet" v={l.planet} />
            </div>
            {Array.isArray(l.friendly) && l.friendly.length > 0 && (
              <p className="mt-2 text-xs text-sub-text">
                Friendly numbers:{' '}
                <b className="text-dark-text">{l.friendly.join(', ')}</b>
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Core section (no health/habits/interests/finance: for secondary
// numbers like Soul Urge and Personality where fewer fields apply).
function SectionCore({ title, n, traits, tagline }) {
  const [open, setOpen] = useState(false);
  if (!traits) return null;
  const l = traits.lucky || {};
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-100
      bg-white">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2
          border-b border-gray-100 bg-gray-50 px-3 py-2.5">
        <div className="text-left">
          <div className="text-[10px] font-bold uppercase tracking-wider
            text-sub-text">{title}</div>
          <div className="text-base font-bold text-dark-text">
            {n}{' '}
            <span className="text-sm font-medium text-sub-text">
              {traits.keyword}
            </span>
          </div>
        </div>
        <svg viewBox="0 0 24 24" width="18" height="18"
          className={`shrink-0 transition-transform ${open
            ? 'rotate-180' : ''}`}>
          <path d="M6 9l6 6 6-6" fill="none"
            stroke="#6B7280" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="space-y-0 divide-y divide-gray-50 px-3 pb-3">
          {tagline && (
            <p className="py-2 text-[11px] text-sub-text">{tagline}</p>
          )}
          <RowFull label="Who you are" body={traits.personality} />
          <RowFull label="Career and work" body={traits.career} />
          <RowFull label="Love and relationships" body={traits.love} />
          <RowFull label="Strengths" body={traits.strengths}
            accent="success" />
          <RowFull label="Challenges" body={traits.challenges}
            accent="warning" />
          <RowFull label="Advice for you" body={traits.advice}
            accent="info" />
          <div className="pt-2">
            <div className="grid grid-cols-2 gap-2 text-xs
              sm:grid-cols-4">
              <Chip label="Lucky colour" v={l.color} />
              <Chip label="Lucky day" v={l.day} />
              <Chip label="Lucky stone" v={l.stone} />
              <Chip label="Planet" v={l.planet} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Summary that merges life path + destiny into a combined statement.
function CombinedOverview({ report }) {
  const lp = report.lifePath;
  const dest = report.destiny;
  const lpKey = report.lifeTraits?.keyword || '';
  const dKey = report.destinyTraits?.keyword || '';
  const sameNumber = lp === dest;
  return (
    <div className="overflow-hidden rounded-2xl border border-primary/20
      bg-white">
      <div className="border-b border-primary/10 bg-primary/5
        px-3 py-2.5">
        <div className="text-[10px] font-bold uppercase tracking-wider
          text-sub-text">Combined reading</div>
        <div className="text-sm font-bold text-dark-text">
          Your full numerology picture
        </div>
      </div>
      <div className="px-3 py-3 text-sm leading-relaxed text-dark-text
        space-y-2">
        {sameNumber ? (
          <p>
            Your Life Path and Destiny are both <b>{lp}</b> ({lpKey}).
            This is a powerful alignment. It means the path you are on
            in life and the work you are meant to do are one and the
            same. You are not fighting against yourself; your purpose
            and your journey are pointing in the same direction.
            Lean into this with confidence.
          </p>
        ) : (
          <p>
            Your Life Path is <b>{lp}</b> ({lpKey}) and your Destiny
            is <b>{dest}</b> ({dKey}). This means your inner journey
            and your external purpose have different flavours. The
            Life Path describes who you are becoming through
            experience, while the Destiny describes the work your
            name is coded to do. When these differ, people often
            feel a gentle tension between how they feel inside and
            what they feel called to do in the world. The key is
            to honour both: develop the qualities of {lp} through
            your personal life and use the energy of {dest} in
            your work and public roles.
          </p>
        )}
        <p>
          Your Soul Urge (<b>{report.soul}</b>) reveals what truly
          makes you feel fulfilled at the deepest level. When your
          daily life aligns with this number, you feel content
          and motivated. When it does not, no amount of external
          success will feel complete.
        </p>
        <p>
          In <b>{new Date().getFullYear()}</b>, you are in a Personal
          Year <b>{report.personalYear}</b> cycle. This shapes the
          overall energy and opportunities available to you this year.
          Use the guidance in the Personal Year section above to
          navigate this period wisely.
        </p>
      </div>
    </div>
  );
}

// Row inside a section.
function RowFull({ label, body, accent }) {
  if (!body) return null;
  const bg = accent === 'success'
    ? 'bg-green-50 text-green-800'
    : accent === 'warning'
      ? 'bg-amber-50 text-amber-800'
      : accent === 'info'
        ? 'bg-blue-50 text-blue-800'
        : '';
  return (
    <div className={`py-2 ${bg ? `rounded-xl px-2 my-1 ${bg}` : ''}`}>
      <div className="text-[10px] font-bold uppercase tracking-wide
        text-sub-text">{label}</div>
      <div className="mt-0.5 text-[13px] leading-relaxed
        text-dark-text">{body}</div>
    </div>
  );
}

const BigNum = ({ label, value, sub }) => (
  <div className="rounded-xl bg-bg-light p-3 text-center">
    <div className="text-[10px] font-bold uppercase tracking-wider
      text-sub-text">{label}</div>
    <div className="mt-0.5 text-3xl font-bold text-primary">
      {value ?? '-'}
    </div>
    {sub && (
      <div className="mt-0.5 text-[9px] leading-tight text-sub-text
        line-clamp-2">{sub}</div>
    )}
  </div>
);
const Mini = ({ label, value }) => (
  <div className="rounded-lg border border-gray-200 p-2 text-xs">
    <div className="text-sub-text">{label}</div>
    <div className="font-semibold">{value ?? '-'}</div>
  </div>
);
const Chip = ({ label, v }) => (
  <div className="rounded-lg bg-bg-light p-2">
    <div className="text-[10px] text-sub-text">{label}</div>
    <div className="text-xs font-semibold">{v || '-'}</div>
  </div>
);

// Sub-tool strip: lucky number checker, name correction, etc.
function ToolStrip({ name, dob }) {
  const ctx = numerologyService.luckyContext({ name, dob });
  const [tool, setTool] = useState('');
  const TOOLS = [
    { id: 'mobile', label: 'Lucky Mobile' },
    { id: 'vehicle', label: 'Lucky Vehicle' },
    { id: 'name', label: 'Name Correction' },
    { id: 'check', label: 'Lucky Name Check' },
  ];
  return (
    <div className="card space-y-2 p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold uppercase tracking-wider
          text-sub-text">Your lucky basics</div>
        <div className="text-[10px] text-sub-text">
          Life path {ctx.lifePath || '-'}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <Chip label="Lucky day" v={ctx.day} />
        <Chip label="Lucky colour" v={ctx.color} />
        <Chip label="Lucky stone" v={ctx.stone} />
        <Chip label="Lucky numbers"
          v={ctx.luckySet.join(', ') || '-'} />
      </div>
      <div className="flex flex-wrap gap-1.5 pt-1">
        {TOOLS.map((t) => (
          <button key={t.id}
            onClick={() => setTool(tool === t.id ? '' : t.id)}
            className={`rounded-full px-3 py-1 text-[11px] font-semibold
              ${tool === t.id
                ? 'bg-primary text-white'
                : 'border border-gray-200 bg-white text-dark-text'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tool === 'mobile' && (
        <NumberChecker label="Enter mobile number"
          placeholder="98765 43210" name={name} dob={dob} />
      )}
      {tool === 'vehicle' && (
        <NumberChecker label="Enter vehicle number / digits"
          placeholder="DL01AB 1234" name={name} dob={dob} />
      )}
      {tool === 'name' && <NameCorrection name={name} dob={dob} />}
      {tool === 'check' && <LuckyNameCheck name={name} dob={dob} />}
    </div>
  );
}

function NumberChecker({ label, placeholder, name, dob }) {
  const [val, setVal] = useState('');
  const result = val
    ? numerologyService.checkNumberLuck(val, { name, dob }) : null;
  const suggestions = numerologyService.suggestLuckyPairs(
    { name, dob }, 6);
  return (
    <div className="space-y-1.5 pt-1">
      <label className="block text-xs font-semibold text-sub-text">
        {label}
        <input className="input mt-1" value={val}
          placeholder={placeholder}
          onChange={(e) => setVal(e.target.value)} />
      </label>
      {result && (
        <div className={`rounded-card p-2 text-xs ${result.ok
          ? 'bg-success/10 text-success'
          : result.friendly
            ? 'bg-amber-50 text-amber-800'
            : 'bg-danger/10 text-danger'}`}>
          {result.message}
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="pt-1 text-[11px] text-sub-text">
          Lucky trailing pairs:{' '}
          <b>{suggestions.join(' · ')}</b>
        </div>
      )}
    </div>
  );
}

function NameCorrection({ name, dob }) {
  const [input, setInput] = useState(name || '');
  useEffect(() => { setInput(name || ''); }, [name]);
  const r = numerologyService.suggestNameCorrection(input, dob);
  return (
    <div className="space-y-1.5 pt-1">
      <label className="block text-xs font-semibold text-sub-text">
        Name to check / adjust
        <input className="input mt-1" value={input}
          placeholder="Full name"
          onChange={(e) => setInput(e.target.value)} />
      </label>
      {r.error && (
        <div className="rounded-card bg-bg-light p-2 text-xs
          text-sub-text">{r.error}</div>
      )}
      {!r.error && (
        <div className={`rounded-card p-2 text-xs ${r.ok
          ? 'bg-success/10 text-success'
          : 'bg-amber-50 text-amber-800'}`}>
          {r.message}
        </div>
      )}
      {r.suggestions && r.suggestions.length > 0 && (
        <ul className="space-y-1 pt-1">
          {r.suggestions.map((s) => (
            <li key={s.name}
              className="flex items-center justify-between
                rounded-card bg-bg-light px-3 py-2 text-sm">
              <span className="font-semibold">{s.name}</span>
              <span className="text-xs text-sub-text">
                destiny{' '}
                <b className="text-primary">{s.destiny}</b>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LuckyNameCheck({ name, dob }) {
  const [input, setInput] = useState('');
  const lp = numerologyService.lifePath(dob);
  const d = input ? numerologyService.destinyNumber(input) : null;
  const match = d && lp && d === lp;
  return (
    <div className="space-y-1.5 pt-1">
      <label className="block text-xs font-semibold text-sub-text">
        Any name (yours, child, brand, business)
        <input className="input mt-1" value={input}
          placeholder="e.g. Aarav Sharma"
          onChange={(e) => setInput(e.target.value)} />
      </label>
      {input && (
        <div className={`rounded-card p-2 text-xs ${match
          ? 'bg-success/10 text-success'
          : 'bg-amber-50 text-amber-800'}`}>
          {match
            ? `Destiny ${d} matches your life path ${lp}. This name `
              + 'is auspicious for you.'
            : `Destiny ${d} vs your life path ${lp || '-'}. This name `
              + 'is workable but not perfectly aligned. Try a small '
              + 'tweak in the Name Correction tool above.'}
        </div>
      )}
    </div>
  );
}
