import { useState, useEffect } from 'react';
import { numerologyService } from '@astro/shared';
import Layout from '../components/Layout';
import { useAuth } from '../lib/useAuth';
import { DateField } from '../components/BirthInputs';

// Chaldean numerology report. Free, no API. Pre-fills name + DOB from the
// signed-in profile when available so most users get the result with one
// tap. Shows life path, destiny, soul, personality, current personal
// year and lucky numbers + per-number traits / lucky colour / stone.
export default function Numerology() {
  const { profile } = useAuth();
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [report, setReport] = useState(null);

  useEffect(() => {
    if (profile?.name) setName(profile.name);
    if (profile?.dob) setDob(profile.dob);
  }, [profile?.name, profile?.dob]);

  function compute(e) {
    if (e) e.preventDefault();
    if (!name && !dob) return;
    setReport(numerologyService.fullReport({ name, dob }));
  }

  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">Numerology</h1>
      <p className="mb-4 text-sm text-sub-text">
        Chaldean numerology - the system most commonly used in India.
        Enter your name and date of birth to see your life path, destiny,
        soul urge, lucky numbers and traits.
      </p>

      <form onSubmit={compute} className="card mb-4 space-y-3">
        <label className="block text-sm">
          Full name (as you use it)
          <input className="input mt-1" value={name}
            placeholder="e.g. Ravi Kumar Sharma"
            onChange={(e) => setName(e.target.value)} />
        </label>
        <DateField value={dob} onChange={setDob} />
        <button type="submit" className="btn-primary w-full">
          Generate report
        </button>
      </form>

      {report && (
        <div className="space-y-3">
          {/* Headline numbers */}
          <div className="card">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <BigNum label="Life Path" value={report.lifePath} />
              <BigNum label="Destiny" value={report.destiny} />
              <BigNum label="Soul Urge" value={report.soul} />
              <BigNum label="Personality"
                value={report.personality} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm
              sm:grid-cols-3">
              <Mini label="Birth day" value={report.birthday} />
              <Mini label={`Personal year (${new Date().getFullYear()})`}
                value={report.personalYear} />
              <Mini label="Lucky numbers"
                value={report.luckyNumbers.join(', ')} />
            </div>
          </div>

          <Section title="Life Path" n={report.lifePath}
            traits={report.lifeTraits}
            tagline="Your overall life journey + lessons (from DOB)." />

          <Section title="Destiny / Expression" n={report.destiny}
            traits={report.destinyTraits}
            tagline="The work you're here to do (from full name)." />

          <Section title="Soul Urge" n={report.soul}
            traits={report.soulTraits}
            tagline="What your heart truly desires (vowels in name)." />

          <Section title="Personality" n={report.personality}
            traits={report.personalityTraits}
            tagline="How the world sees you (consonants in name)." />

          <Section title={`Personal Year ${new Date().getFullYear()}`}
            n={report.personalYear} traits={report.yearTraits}
            tagline="The cycle you're currently in." />
        </div>
      )}
    </Layout>
  );
}

const BigNum = ({ label, value }) => (
  <div className="rounded-xl bg-bg-light p-3 text-center">
    <div className="text-[10px] font-bold uppercase tracking-wider
      text-sub-text">{label}</div>
    <div className="mt-0.5 text-3xl font-bold text-primary">
      {value ?? '-'}
    </div>
  </div>
);
const Mini = ({ label, value }) => (
  <div className="rounded-lg border border-gray-200 p-2 text-xs">
    <div className="text-sub-text">{label}</div>
    <div className="font-semibold">{value ?? '-'}</div>
  </div>
);

function Section({ title, n, traits, tagline }) {
  if (!traits) return null;
  const l = traits.lucky || {};
  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider
            text-sub-text">{title}</div>
          <div className="text-lg font-bold text-dark-text">
            {n} <span className="text-sm font-medium text-sub-text">
              {traits.keyword}
            </span>
          </div>
        </div>
      </div>
      {tagline && (
        <p className="mt-1 text-[11px] text-sub-text">{tagline}</p>
      )}
      <Row k="You are" v={traits.personality} />
      <Row k="Career" v={traits.career} />
      <Row k="Love" v={traits.love} />
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <Chip label="Colour" v={l.color} />
        <Chip label="Day" v={l.day} />
        <Chip label="Stone" v={l.stone} />
        <Chip label="Planet" v={l.planet} />
      </div>
      {Array.isArray(l.friendly) && l.friendly.length > 0 && (
        <p className="mt-2 text-xs text-sub-text">
          Friendly numbers: <b>{l.friendly.join(', ')}</b>
        </p>
      )}
    </div>
  );
}
const Row = ({ k, v }) => (
  <div className="mt-2 text-sm">
    <div className="text-[11px] font-bold uppercase tracking-wider
      text-sub-text">{k}</div>
    <div className="text-dark-text">{v}</div>
  </div>
);
const Chip = ({ label, v }) => (
  <div className="rounded-lg bg-bg-light p-2">
    <div className="text-[10px] text-sub-text">{label}</div>
    <div className="font-semibold">{v || '-'}</div>
  </div>
);
