import { useEffect, useMemo, useState } from 'react';
import { adminService } from '@astro/shared';

// Type-to-search, multi-select user picker (replaces raw "User ID").
// value = array of selected user objects; onChange(nextArray).
export default function UserPicker({ value = [], onChange }) {
  const [all, setAll] = useState([]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    adminService.getAllUsers().then(setAll).catch(() => setAll([]));
  }, []);

  const picked = new Set(value.map((u) => u.uid));
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return all.slice(0, 8);
    return all.filter((u) =>
      (u.name || '').toLowerCase().includes(s)
      || (u.email || '').toLowerCase().includes(s)
      || String(u.userCode || '').includes(s)
      || u.uid.toLowerCase().includes(s)).slice(0, 12);
  }, [q, all]);

  function add(u) {
    if (picked.has(u.uid)) return;
    onChange([...value, u]);
    setQ(''); setOpen(false);
  }
  function remove(uid) {
    onChange(value.filter((u) => u.uid !== uid));
  }

  return (
    <div className="relative">
      {value.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {value.map((u) => (
            <span key={u.uid}
              className="flex items-center gap-1 rounded-full bg-primary
                px-3 py-1 text-sm text-white">
              {u.name || u.email || u.uid}
              <button onClick={() => remove(u.uid)}
                className="ml-1 font-bold">x</button>
            </span>
          ))}
        </div>
      )}
      <input className="input"
        placeholder="Type a name, email or code to find users"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} />
      {open && matches.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto
          rounded-card border border-gray-200 bg-white shadow-lg">
          {matches.map((u) => (
            <button key={u.uid} onClick={() => add(u)}
              disabled={picked.has(u.uid)}
              className="block w-full border-b border-gray-100 px-3 py-2
                text-left text-sm last:border-0 hover:bg-bg-light
                disabled:opacity-40">
              <div className="font-semibold">
                {u.name || '(no name)'}
                <span className="ml-2 text-xs capitalize text-sub-text">
                  {u.role || 'client'}
                </span>
              </div>
              <div className="text-xs text-sub-text">
                {u.email} {u.userCode ? `- ${u.userCode}` : ''}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
