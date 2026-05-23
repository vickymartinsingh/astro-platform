import { useEffect, useState } from 'react';

// Themed Yes/No confirmation modal. Replaces window.confirm with a brand-
// styled popup. Imperative API: `await confirmModal({title, message, yes,
// no, danger})` -> Promise<boolean>.
let counter = 0;
export function confirmModal({
  title = 'Are you sure?',
  message = '',
  yes = 'Yes',
  no = 'No',
  danger = false,
} = {}) {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (!window.__confirmModalReady) return Promise.resolve(
    window.confirm(`${title}\n\n${message}`));
  const id = ++counter;
  return new Promise((resolve) => {
    const onResult = (e) => {
      if (e.detail && e.detail.id === id) {
        window.removeEventListener('confirm-modal-result', onResult);
        resolve(!!e.detail.ok);
      }
    };
    window.addEventListener('confirm-modal-result', onResult);
    window.dispatchEvent(new CustomEvent('confirm-modal-show', {
      detail: { id, title, message, yes, no, danger },
    }));
  });
}

export default function ConfirmModalHost() {
  const [open, setOpen] = useState(null);
  useEffect(() => {
    window.__confirmModalReady = true;
    const show = (e) => setOpen(e.detail);
    window.addEventListener('confirm-modal-show', show);
    return () => {
      window.removeEventListener('confirm-modal-show', show);
      window.__confirmModalReady = false;
    };
  }, []);
  function answer(ok) {
    const id = open && open.id;
    setOpen(null);
    if (id != null) {
      window.dispatchEvent(new CustomEvent('confirm-modal-result',
        { detail: { id, ok } }));
    }
  }
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[2147483646] flex items-center
      justify-center bg-black/60 px-4"
      onClick={() => answer(false)}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="text-lg font-bold text-dark-text">{open.title}</div>
        {open.message && (
          <p className="mt-2 text-sm text-sub-text">{open.message}</p>
        )}
        <div className="mt-5 flex gap-2">
          <button onClick={() => answer(false)}
            className="flex-1 rounded-full border border-gray-300
              bg-white py-2.5 text-sm font-bold text-dark-text">
            {open.no}
          </button>
          <button onClick={() => answer(true)}
            className={`flex-1 rounded-full py-2.5 text-sm font-bold
              text-white ${open.danger ? 'bg-danger' : 'bg-primary'}`}>
            {open.yes}
          </button>
        </div>
      </div>
    </div>
  );
}
