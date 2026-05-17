import { useEffect, useState } from 'react';

// Centred confirmation popup. Listens for the global 'admin-flash'
// event (see lib/flash.js) and auto-dismisses after ~1.8s.
export default function Flash() {
  const [f, setF] = useState(null);

  useEffect(() => {
    let t;
    const onFlash = (e) => {
      setF(e.detail || { message: 'Done', kind: 'success' });
      clearTimeout(t);
      t = setTimeout(() => setF(null), 1800);
    };
    window.addEventListener('admin-flash', onFlash);
    return () => { window.removeEventListener('admin-flash', onFlash);
      clearTimeout(t); };
  }, []);

  if (!f) return null;
  const ok = f.kind !== 'error';
  return (
    <div className="fixed inset-0 z-[2147483646] flex items-center
      justify-center bg-black/30" onClick={() => setF(null)}>
      <div className="mx-6 w-full max-w-xs rounded-2xl bg-white p-6
        text-center shadow-2xl"
        style={{ animation: 'popIn .15s ease-out' }}>
        <div className={`mx-auto mb-3 flex h-14 w-14 items-center
          justify-center rounded-full text-3xl ${ok
            ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'}`}>
          {ok ? '✓' : '!'}
        </div>
        <div className="text-base font-semibold text-dark-text">
          {f.message}
        </div>
      </div>
      <style jsx global>{`
        @keyframes popIn {
          from { opacity: 0; transform: scale(.9); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
