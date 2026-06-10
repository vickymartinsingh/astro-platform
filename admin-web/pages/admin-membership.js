import { useEffect, useState, useCallback } from 'react';
import { membershipService, REPORT_TYPES } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// /admin-membership
//
// Full management console for the membership tier system. Admins can
// enable/disable the membership feature, manage tiers (name, price,
// colour, icon, benefits), reorder or remove tiers, and maintain the
// customer-facing FAQ. Everything persists to settings/membership and
// takes effect immediately on client refresh.
//
// Sections:
//   1. Global toggle (enable / disable membership)
//   2. Tiers editor (card per tier with benefits)
//   3. FAQ editor (Q&A pairs)
//   4. Sticky save bar when dirty

function uid() {
  return 'tier_' + Date.now().toString(36) + '_'
    + Math.random().toString(36).slice(2, 8);
}

export default function AdminMembership() {
  const { loading } = useRequireAdmin();
  const [cfg, setCfg] = useState(null);
  const [enabled, setEnabled] = useState(true);
  const [tiers, setTiers] = useState([]);
  const [faq, setFaq] = useState([]);
  const [savedJson, setSavedJson] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState({});

  const load = useCallback(async () => {
    try {
      const data = await membershipService.getMembershipConfig();
      setEnabled(data.enabled !== false);
      setTiers(data.tiers || []);
      setFaq(data.faq || []);
      setSavedJson(JSON.stringify(data));
      setCfg(data);
    } catch (e) {
      flash('Failed to load membership config.', 'error');
    }
  }, []);

  useEffect(() => { if (!loading) load(); }, [loading, load]);

  if (loading || !cfg) {
    return <Layout><div className="surface p-6">Loading...</div></Layout>;
  }

  const currentJson = JSON.stringify({ enabled, tiers, faq });
  const dirty = currentJson !== savedJson;

  // -- Tier helpers --
  function setTier(idx, patch) {
    setTiers((prev) => prev.map((t, i) =>
      i === idx ? { ...t, ...patch } : t));
  }
  function setTierBenefit(idx, key, value) {
    setTiers((prev) => prev.map((t, i) => {
      if (i !== idx) return t;
      return { ...t, benefits: { ...t.benefits, [key]: value } };
    }));
  }
  function moveTier(idx, dir) {
    setTiers((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next.map((t, i) => ({ ...t, order: i }));
    });
  }
  function removeTier(idx) {
    if (!window.confirm('Remove this tier? This cannot be undone.')) return;
    setTiers((prev) => prev.filter((_, i) => i !== idx)
      .map((t, i) => ({ ...t, order: i })));
    setExpanded((prev) => { const n = { ...prev }; delete n[idx]; return n; });
  }
  function addTier() {
    const t = {
      id: uid(),
      name: 'New Tier',
      price: 0,
      color: '#7F2020',
      icon: '⭐',
      benefits: {
        freeReports: [],
        callMinutes: 0,
        callRateCap: 0,
        prioritySupport: false,
        discountPercent: 0,
        customBenefits: [],
      },
      order: tiers.length,
    };
    setTiers((prev) => [...prev, t]);
    setExpanded((prev) => ({ ...prev, [tiers.length]: true }));
  }
  function loadDefaults() {
    if (!window.confirm(
      'Replace all tiers and FAQ with the built-in defaults? '
      + 'Your current configuration will be overwritten.',
    )) return;
    const defaults = membershipService.getDefaultConfig();
    setEnabled(defaults.enabled !== false);
    setTiers(defaults.tiers || []);
    setFaq(defaults.faq || []);
    flash('Default config loaded. Save to persist.');
  }
  function toggleExpand(idx) {
    setExpanded((prev) => ({ ...prev, [idx]: !prev[idx] }));
  }

  // -- FAQ helpers --
  function setFaqItem(idx, patch) {
    setFaq((prev) => prev.map((f, i) =>
      i === idx ? { ...f, ...patch } : f));
  }
  function addFaqItem() {
    setFaq((prev) => [...prev, { q: '', a: '' }]);
  }
  function removeFaqItem(idx) {
    setFaq((prev) => prev.filter((_, i) => i !== idx));
  }

  // -- Custom benefits helpers --
  function addCustomBenefit(tierIdx) {
    setTiers((prev) => prev.map((t, i) => {
      if (i !== tierIdx) return t;
      const cb = [...(t.benefits?.customBenefits || []),
        { label: '', description: '' }];
      return { ...t, benefits: { ...t.benefits, customBenefits: cb } };
    }));
  }
  function setCustomBenefit(tierIdx, cbIdx, patch) {
    setTiers((prev) => prev.map((t, i) => {
      if (i !== tierIdx) return t;
      const cb = (t.benefits?.customBenefits || []).map((c, j) =>
        j === cbIdx ? { ...c, ...patch } : c);
      return { ...t, benefits: { ...t.benefits, customBenefits: cb } };
    }));
  }
  function removeCustomBenefit(tierIdx, cbIdx) {
    setTiers((prev) => prev.map((t, i) => {
      if (i !== tierIdx) return t;
      const cb = (t.benefits?.customBenefits || []).filter((_, j) => j !== cbIdx);
      return { ...t, benefits: { ...t.benefits, customBenefits: cb } };
    }));
  }

  // -- Free reports toggle --
  function toggleFreeReport(tierIdx, reportId) {
    setTiers((prev) => prev.map((t, i) => {
      if (i !== tierIdx) return t;
      const current = t.benefits?.freeReports || [];
      const next = current.includes(reportId)
        ? current.filter((r) => r !== reportId)
        : [...current, reportId];
      return { ...t, benefits: { ...t.benefits, freeReports: next } };
    }));
  }

  // -- Save --
  async function save() {
    setBusy(true);
    try {
      await membershipService.saveMembershipConfig({
        enabled: !!enabled,
        tiers: tiers.map((t, i) => ({ ...t, order: i })),
        faq,
      });
      const data = { enabled, tiers, faq };
      setSavedJson(JSON.stringify(data));
      flash('Membership config saved. Changes are live.');
    } catch (e) {
      flash(`Save failed: ${e.message || e}`, 'error');
    } finally { setBusy(false); }
  }

  return (
    <Layout>
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#7F2020' }}>
            Membership
          </h1>
          <p className="mt-0.5 text-sm text-sub-text">
            Manage membership tiers, benefits, and FAQ. All changes
            take effect immediately.
          </p>
        </div>
        <button onClick={save} disabled={!dirty || busy}
          className="rounded-full px-5 py-2 text-sm font-bold text-white
            disabled:opacity-50"
          style={{ backgroundColor: dirty ? '#7F2020' : '#999' }}>
          {busy ? 'Saving...' : (dirty ? 'Save changes' : 'All saved')}
        </button>
      </div>

      {/* 1. Global Toggle */}
      <Section title="Membership system">
        <div className="flex items-center gap-3">
          <Toggle on={!!enabled} onChange={(v) => setEnabled(v)} />
          <span className={`text-sm font-semibold ${
            enabled ? 'text-emerald-700' : 'text-sub-text'
          }`}>
            {enabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-sub-text">
          When disabled, customers cannot subscribe or renew any tier.
          Existing memberships remain active until they expire.
        </p>
      </Section>

      {/* 2. Tiers Editor */}
      <Section title="Tiers"
        right={
          <div className="flex gap-2">
            <button onClick={loadDefaults}
              className="rounded-full border px-3 py-1 text-[11px]
                font-bold hover:bg-gray-50"
              style={{ borderColor: '#D4A12A', color: '#D4A12A' }}>
              Load defaults
            </button>
            <button onClick={addTier}
              className="rounded-full px-3 py-1 text-[11px] font-bold
                text-white"
              style={{ backgroundColor: '#7F2020' }}>
              + Add tier
            </button>
          </div>
        }>
        {tiers.length === 0 && (
          <p className="py-4 text-center text-sm text-sub-text">
            No tiers yet. Click "Add tier" or "Load defaults" to begin.
          </p>
        )}
        <div className="space-y-2">
          {tiers.map((tier, idx) => (
            <div key={tier.id || idx}
              className="rounded-card border border-gray-200 bg-white">
              {/* Tier header row */}
              <div className="flex flex-wrap items-center gap-2 p-3">
                {/* Move arrows */}
                <div className="flex flex-col gap-0.5">
                  <button onClick={() => moveTier(idx, -1)}
                    disabled={idx === 0}
                    className="grid h-5 w-5 place-items-center rounded
                      text-[10px] hover:bg-gray-100 disabled:opacity-30"
                    title="Move up">&#9650;</button>
                  <button onClick={() => moveTier(idx, 1)}
                    disabled={idx === tiers.length - 1}
                    className="grid h-5 w-5 place-items-center rounded
                      text-[10px] hover:bg-gray-100 disabled:opacity-30"
                    title="Move down">&#9660;</button>
                </div>

                {/* Color indicator */}
                <span className="h-6 w-6 shrink-0 rounded-full border
                  border-gray-200"
                  style={{ backgroundColor: tier.color || '#7F2020' }} />

                {/* Icon */}
                <input className="w-10 rounded border border-gray-200
                  bg-gray-50 px-1 py-0.5 text-center text-lg"
                  value={tier.icon || ''}
                  onChange={(e) => setTier(idx, { icon: e.target.value })}
                  title="Icon (emoji)" />

                {/* Name */}
                <input className="input min-w-0 flex-1 text-sm font-semibold"
                  value={tier.name || ''}
                  onChange={(e) => setTier(idx, { name: e.target.value })}
                  placeholder="Tier name" />

                {/* Price */}
                <label className="flex items-center gap-1 text-[11px]
                  text-sub-text">
                  <span>INR/mo:</span>
                  <input className="input w-20 text-xs" type="number"
                    min="0"
                    value={tier.price || 0}
                    onChange={(e) => setTier(idx, {
                      price: Number(e.target.value) || 0,
                    })} />
                </label>

                {/* Expand/collapse */}
                <button onClick={() => toggleExpand(idx)}
                  className="grid h-7 w-7 place-items-center rounded
                    hover:bg-gray-100 text-sm"
                  title={expanded[idx] ? 'Collapse' : 'Expand benefits editor'}>
                  {expanded[idx] ? '▾' : '▸'}
                </button>

                {/* Remove */}
                <button onClick={() => removeTier(idx)}
                  className="grid h-7 w-7 place-items-center rounded
                    text-sm text-red-400 hover:bg-red-50 hover:text-red-600"
                  title="Remove tier">&#10005;</button>
              </div>

              {/* Expanded benefits editor */}
              {expanded[idx] && (
                <div className="border-t border-gray-100 bg-gray-50/50 p-3
                  space-y-4">
                  {/* Color + ID row */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-xs font-semibold text-sub-text">
                        Colour (hex)
                      </span>
                      <div className="mt-1 flex items-center gap-2">
                        <input className="input flex-1 text-xs"
                          value={tier.color || ''}
                          onChange={(e) => setTier(idx, { color: e.target.value })}
                          placeholder="#7F2020" />
                        <input type="color"
                          value={tier.color || '#7F2020'}
                          onChange={(e) => setTier(idx, { color: e.target.value })}
                          className="h-8 w-8 cursor-pointer rounded border
                            border-gray-200" />
                      </div>
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold text-sub-text">
                        Tier ID
                      </span>
                      <input className="input mt-1 text-xs bg-gray-100"
                        value={tier.id || ''}
                        readOnly
                        title="Auto-generated, read only" />
                    </label>
                  </div>

                  {/* Benefits */}
                  <div>
                    <h3 className="mb-2 text-xs font-bold uppercase
                      tracking-wider" style={{ color: '#D4A12A' }}>
                      Benefits
                    </h3>

                    {/* Free Reports multi-select */}
                    <div className="mb-3">
                      <span className="text-xs font-semibold text-sub-text">
                        Free reports
                      </span>
                      <p className="mb-1 text-[10px] text-sub-text">
                        Select which report types are included free
                        with this tier.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {REPORT_TYPES.map((rt) => {
                          const checked = (tier.benefits?.freeReports || [])
                            .includes(rt.id);
                          return (
                            <label key={rt.id}
                              className={`flex cursor-pointer items-center
                                gap-1.5 rounded-full border px-2.5 py-1
                                text-[11px] font-medium transition
                                ${checked
                                  ? 'border-amber-400 bg-amber-50 text-amber-800'
                                  : 'border-gray-200 bg-white text-sub-text'
                                }`}>
                              <input type="checkbox" checked={checked}
                                onChange={() => toggleFreeReport(idx, rt.id)}
                                className="sr-only" />
                              <span className={`h-3 w-3 rounded-sm border
                                ${checked
                                  ? 'border-amber-500 bg-amber-500'
                                  : 'border-gray-300 bg-white'
                                }`}>
                                {checked && (
                                  <svg className="h-3 w-3 text-white"
                                    viewBox="0 0 12 12" fill="none">
                                    <path d="M2.5 6l2.5 2.5 4.5-5"
                                      stroke="currentColor" strokeWidth="1.5"
                                      strokeLinecap="round"
                                      strokeLinejoin="round" />
                                  </svg>
                                )}
                              </span>
                              {rt.shortName || rt.name}
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    {/* Numeric benefits */}
                    <div className="mb-3 grid gap-3 sm:grid-cols-3">
                      <label className="block">
                        <span className="text-xs font-semibold text-sub-text">
                          Call minutes / month
                        </span>
                        <input className="input mt-1 text-xs" type="number"
                          min="0"
                          value={tier.benefits?.callMinutes || 0}
                          onChange={(e) => setTierBenefit(idx, 'callMinutes',
                            Number(e.target.value) || 0)} />
                      </label>
                      <label className="block">
                        <span className="text-xs font-semibold text-sub-text">
                          Call rate cap (INR/min)
                        </span>
                        <input className="input mt-1 text-xs" type="number"
                          min="0"
                          value={tier.benefits?.callRateCap || 0}
                          onChange={(e) => setTierBenefit(idx, 'callRateCap',
                            Number(e.target.value) || 0)} />
                        <p className="mt-0.5 text-[10px] text-sub-text">
                          0 = no cap
                        </p>
                      </label>
                      <label className="block">
                        <span className="text-xs font-semibold text-sub-text">
                          Discount (%)
                        </span>
                        <input className="input mt-1 text-xs" type="number"
                          min="0" max="100"
                          value={tier.benefits?.discountPercent || 0}
                          onChange={(e) => setTierBenefit(idx, 'discountPercent',
                            Number(e.target.value) || 0)} />
                      </label>
                    </div>

                    {/* Priority support toggle */}
                    <div className="mb-3">
                      <span className="text-xs font-semibold text-sub-text">
                        Priority support
                      </span>
                      <div className="mt-1 flex items-center gap-3">
                        <Toggle
                          on={!!tier.benefits?.prioritySupport}
                          onChange={(v) => setTierBenefit(idx,
                            'prioritySupport', v)} />
                        <span className={`text-sm font-semibold ${
                          tier.benefits?.prioritySupport
                            ? 'text-emerald-700' : 'text-sub-text'
                        }`}>
                          {tier.benefits?.prioritySupport
                            ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>
                    </div>

                    {/* Custom benefits */}
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-xs font-semibold text-sub-text">
                          Custom benefits ({
                            (tier.benefits?.customBenefits || []).length
                          })
                        </span>
                        <button onClick={() => addCustomBenefit(idx)}
                          className="rounded-full border px-2 py-0.5
                            text-[10px] font-bold hover:bg-gray-50"
                          style={{ borderColor: '#D4A12A',
                            color: '#D4A12A' }}>
                          + Add
                        </button>
                      </div>
                      <div className="space-y-1.5">
                        {(tier.benefits?.customBenefits || []).map((cb, ci) => (
                          <div key={ci} className="flex items-start gap-2
                            rounded border border-gray-200 bg-white p-2">
                            <div className="flex-1 space-y-1">
                              <input className="input w-full text-xs
                                font-semibold"
                                value={cb.label || ''}
                                onChange={(e) => setCustomBenefit(idx, ci,
                                  { label: e.target.value })}
                                placeholder="Benefit label" />
                              <input className="input w-full text-[11px]"
                                value={cb.description || ''}
                                onChange={(e) => setCustomBenefit(idx, ci,
                                  { description: e.target.value })}
                                placeholder="Short description" />
                            </div>
                            <button onClick={() => removeCustomBenefit(idx, ci)}
                              className="mt-1 text-xs text-red-400
                                hover:text-red-600">
                              &#10005;
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* 3. FAQ Editor */}
      <Section title="FAQ"
        right={
          <button onClick={addFaqItem}
            className="rounded-full px-3 py-1 text-[11px] font-bold
              text-white"
            style={{ backgroundColor: '#7F2020' }}>
            + Add Q&A
          </button>
        }>
        {faq.length === 0 && (
          <p className="py-4 text-center text-sm text-sub-text">
            No FAQ items yet. Click "Add Q&A" to begin.
          </p>
        )}
        <div className="space-y-2">
          {faq.map((item, idx) => (
            <div key={idx} className="rounded border border-gray-200
              bg-white p-3 space-y-2">
              <div className="flex items-start gap-2">
                <span className="mt-1 shrink-0 text-xs font-bold"
                  style={{ color: '#D4A12A' }}>Q{idx + 1}</span>
                <textarea className="input w-full text-xs h-12"
                  value={item.q || ''}
                  onChange={(e) => setFaqItem(idx, { q: e.target.value })}
                  placeholder="Question" />
                <button onClick={() => removeFaqItem(idx)}
                  className="mt-1 text-xs text-red-400
                    hover:text-red-600">&#10005;</button>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-1 shrink-0 text-xs font-bold
                  text-sub-text">A</span>
                <textarea className="input w-full text-[11px] h-16"
                  value={item.a || ''}
                  onChange={(e) => setFaqItem(idx, { a: e.target.value })}
                  placeholder="Answer" />
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* 4. Sticky bottom save */}
      {dirty && (
        <div className="sticky bottom-0 z-10 -mx-4 border-t
          border-gray-200 bg-white/95 px-4 py-3 backdrop-blur
          sm:-mx-6 sm:px-6">
          <div className="flex items-center justify-between">
            <span className="text-sm text-sub-text">
              You have unsaved changes.
            </span>
            <button onClick={save} disabled={busy}
              className="rounded-full px-5 py-2 text-sm font-bold
                text-white disabled:opacity-50"
              style={{ backgroundColor: '#7F2020' }}>
              {busy ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </div>
      )}
    </Layout>
  );
}

// ============================================================
// Section wrapper
// ============================================================
function Section({ title, children, right }) {
  return (
    <div className="surface mb-3 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wider"
          style={{ color: '#7F2020' }}>{title}</h2>
        {right || null}
      </div>
      {children}
    </div>
  );
}

// ============================================================
// Toggle
// ============================================================
function Toggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition
        ${on ? 'bg-emerald-500' : 'bg-gray-300'}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white
        shadow transition ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}
