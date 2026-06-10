import Link from 'next/link';
import useScrollLock from '../lib/useScrollLock';

export default function DuplicateOrderModal({ match, onCancel,
  onConfirm }) {
  useScrollLock(!!match);
  if (!match) return null;
  const blocking = match.type === 'in_progress';
  const o = match.order || {};
  return (
    <div className="fixed inset-0 z-[2147483645] flex items-end
      justify-center bg-black/40 p-3 sm:items-center" onClick={onCancel}>
      <div className="w-full max-w-md rounded-2xl bg-white p-4
        shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2">
          <div className={`grid h-9 w-9 place-items-center rounded-full
            ${blocking
              ? 'bg-amber-100 text-amber-800'
              : 'bg-rose-100 text-rose-700'}`}>
            {blocking ? '⏳' : '!'}
          </div>
          <div>
            <h3 className="text-base font-bold text-dark-text">
              {blocking ? 'Order already in progress'
                : 'Looks like a duplicate'}
            </h3>
            <p className="mt-0.5 text-[11px] text-sub-text">
              We matched <b>Name</b>, <b>DOB</b>, <b>TOB</b> and
              <b> POB</b> against a previous order.
            </p>
          </div>
        </div>
        {blocking ? (
          <p className="text-sm text-dark-text">
            You have already placed an order for this Kundli profile,
            and it is currently <b>in progress</b>. Please wait until
            it is completed.
          </p>
        ) : (
          <p className="text-sm text-dark-text">
            This appears to be a duplicate order for the same Kundli
            profile (same Name, DOB, TOB, and POB). If you continue,
            it will be treated as a <b>new order</b> and you will be
            charged as per applicable pricing.
          </p>
        )}
        {o.id && (
          <div className="mt-3 rounded-card bg-bg-light/40 p-2 text-[11px]
            text-sub-text">
            Previous order:{' '}
            <Link href={`/orders`} className="font-mono text-primary
              hover:underline">
              {String(o.id).slice(0, 10)}…
            </Link>
            {o.status && (
              <span className="ml-1 rounded bg-white px-1 py-0.5
                font-semibold uppercase">{o.status}</span>
            )}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel}
            className="rounded-full px-4 py-2 text-sm font-semibold
              text-sub-text hover:bg-bg-light">
            {blocking ? 'OK' : 'Cancel'}
          </button>
          {!blocking && (
            <button onClick={onConfirm}
              className="rounded-full bg-primary px-4 py-2 text-sm
                font-bold text-white">
              Proceed & place order
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
