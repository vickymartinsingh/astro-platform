import { useState } from 'react';
import { astrologerService } from '@astro/shared';

// Blueprint 5.5, Hard Rule 9: at least one service required to go online.
export default function GoOnlineModal({ astro, uid, onClose }) {
  const online = astro?.status === 'online';
  const [svc, setSvc] = useState({
    chat: astro?.chat_enabled || false,
    call: astro?.call_enabled || false,
    video: astro?.video_enabled || false,
  });
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function goOnline() {
    if (!svc.chat && !svc.call && !svc.video) {
      setErr('Please select at least one service to go online'); return;
    }
    setBusy(true);
    await astrologerService.updateAvailability(uid, {
      status: 'online',
      chat_enabled: svc.chat,
      call_enabled: svc.call,
      video_enabled: svc.video,
    });
    onClose();
  }

  async function goOffline() {
    setBusy(true);
    await astrologerService.updateAvailability(uid, {
      status: 'offline',
      chat_enabled: false, call_enabled: false, video_enabled: false,
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center
                    bg-black/50 px-4 text-dark-text">
      <div className="card w-full max-w-md">
        {online ? (
          <>
            <h2 className="mb-2 text-lg font-bold">Go Offline?</h2>
            <p className="mb-4 text-sub-text">
              You will not receive new requests.
            </p>
            <div className="flex gap-2">
              <button onClick={onClose} className="btn-ghost flex-1">
                Cancel
              </button>
              <button onClick={goOffline} disabled={busy}
                className="btn-danger flex-1">Go Offline</button>
            </div>
          </>
        ) : !confirm ? (
          <>
            <h2 className="mb-3 text-lg font-bold">Select services</h2>
            {[
              ['chat', `Chat (₹${astro?.priceChat || 0}/min)`],
              ['call', `Voice Call (₹${astro?.priceCall || 0}/min)`],
              ['video', `Video Call (₹${astro?.priceVideo || 0}/min)`],
            ].map(([k, label]) => (
              <label key={k} className="mb-2 flex items-center gap-2">
                <input type="checkbox" checked={svc[k]}
                  onChange={(e) =>
                    setSvc({ ...svc, [k]: e.target.checked })} />
                {label}
              </label>
            ))}
            {err && <p className="mb-2 text-danger">{err}</p>}
            <div className="mt-3 flex gap-2">
              <button onClick={onClose} className="btn-ghost flex-1">
                Cancel
              </button>
              <button onClick={() => {
                if (!svc.chat && !svc.call && !svc.video) {
                  setErr('Please select at least one service to go online');
                } else { setErr(''); setConfirm(true); }
              }} className="btn-primary flex-1">Continue</button>
            </div>
          </>
        ) : (
          <>
            <h2 className="mb-2 text-lg font-bold">Confirm</h2>
            <p className="mb-4 text-sub-text">
              You are going online with:{' '}
              {[svc.chat && 'Chat', svc.call && 'Voice Call',
                svc.video && 'Video Call'].filter(Boolean).join(' + ')}
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirm(false)}
                className="btn-ghost flex-1">Back</button>
              <button onClick={goOnline} disabled={busy}
                className="btn-primary flex-1">Confirm</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
