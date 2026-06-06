import { useEffect, useRef, useState } from 'react';

// Modal that renders a stylised AstroSeer gift card on a <canvas>,
// shows redeem instructions, and lets the admin download the
// generated card as a JPG file. Pure canvas (no external libs) so
// it works inside the Spark plan + adds zero KB to the bundle
// graph for screens that don't use it.
//
// Operator 2026-06-06: "make it downloadable in JPG, it should be
// visual like an actual gift card... popup with close button +
// instructions for adding it to wallet."

const W = 1600;       // canvas resolution (so JPG is sharp on share)
const H = 1000;
const NAVY = '#1B1547';
const NAVY_DARK = '#0E0A2E';
const GOLD = '#D4A12A';
const GOLD_LIGHT = '#F1C75A';

export default function GiftCardPreview({ code, amount, onClose }) {
  const canvasRef = useRef(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!code || !amount) return;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    drawCard(ctx, { code, amount });
  }, [code, amount]);

  function download() {
    const c = canvasRef.current;
    if (!c) return;
    c.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `AstroSeer-GiftCard-${code}.jpg`;
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/jpeg', 0.92);
  }

  function copyCode() {
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }

  return (
    <div className="fixed inset-0 z-[2147483645] flex items-end
      justify-center bg-black/50 p-3 sm:items-center"
      onClick={onClose}>
      <div className="w-full max-w-lg overflow-hidden rounded-2xl
        bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b
          border-gray-100 px-4 py-2.5">
          <h3 className="text-base font-bold text-dark-text">
            Gift card created
          </h3>
          <button onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full
              text-lg text-sub-text hover:bg-bg-light"
            aria-label="Close">
            ✕
          </button>
        </div>

        <div className="bg-bg-light/40 p-3">
          <canvas ref={canvasRef} width={W} height={H}
            className="aspect-[16/10] w-full rounded-xl shadow-md"
            style={{ background: NAVY }} />
        </div>

        <div className="space-y-3 p-4">
          <div className="rounded-card border border-amber-200
            bg-amber-50/60 p-3">
            <div className="text-[10px] font-bold uppercase
              tracking-wider text-amber-800">How to redeem</div>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4
              text-[12px] text-amber-900">
              <li>Open the AstroSeer app and go to <b>Wallet</b>.</li>
              <li>Tap <b>Redeem gift card</b> at the top of the page.</li>
              <li>Enter the code <b className="font-mono">{code}</b>
                {' '}and tap <b>Add to wallet</b>.</li>
              <li>The amount of <b>₹{amount}</b> will be credited
                instantly.</li>
            </ol>
          </div>

          <div className="flex items-center justify-between
            rounded-card border border-gray-200 bg-bg-light/40 p-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider
                text-sub-text">Gift code</div>
              <div className="font-mono text-base font-bold
                text-dark-text">{code}</div>
            </div>
            <button onClick={copyCode}
              className="rounded-full border border-gray-200 px-3 py-1
                text-xs font-bold text-sub-text hover:bg-bg-light">
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button onClick={onClose}
              className="rounded-full px-4 py-2 text-sm font-semibold
                text-sub-text hover:bg-bg-light">
              Close
            </button>
            <button onClick={download}
              className="rounded-full bg-primary px-4 py-2 text-sm
                font-bold text-white hover:opacity-90">
              ⬇ Download JPG
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Pure-canvas illustration. Background gradient, gold border, star
// field, sun-burst medallion on the left, AstroSeer wordmark, amount
// + code panel on the right. No external assets so this works inside
// a Capacitor APK too.
function drawCard(ctx, { code, amount }) {
  ctx.clearRect(0, 0, W, H);
  // background gradient
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, NAVY);
  bg.addColorStop(0.5, NAVY_DARK);
  bg.addColorStop(1, NAVY);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // star field
  for (let i = 0; i < 220; i += 1) {
    const x = pseudoRandom(i * 13) * W;
    const y = pseudoRandom(i * 29) * H;
    const r = pseudoRandom(i * 41) * 1.8 + 0.4;
    const alpha = pseudoRandom(i * 7) * 0.7 + 0.2;
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // outer gold border
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 4;
  roundRect(ctx, 24, 24, W - 48, H - 48, 36);
  ctx.stroke();
  // inner subtle line
  ctx.strokeStyle = 'rgba(212,161,42,0.5)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, 40, 40, W - 80, H - 80, 28);
  ctx.stroke();

  // crescent moons around inner border
  const moons = 18;
  for (let i = 0; i < moons; i += 1) {
    const t = (i / moons) * Math.PI * 2;
    const cx = W / 2 + Math.cos(t) * (W / 2 - 80);
    const cy = H / 2 + Math.sin(t) * (H / 2 - 80);
    drawCrescent(ctx, cx, cy, 14, GOLD_LIGHT);
  }

  // sun-burst medallion on the left
  drawMedallion(ctx, W * 0.27, H * 0.55, 240);

  // wordmark + amount on the right column
  ctx.textAlign = 'right';
  ctx.fillStyle = GOLD_LIGHT;
  ctx.font = '600 56px Georgia, serif';
  ctx.fillText('GIFT CARD', W - 90, 200);

  ctx.fillStyle = GOLD;
  ctx.font = 'bold 132px Georgia, serif';
  ctx.fillText('AstroSeer', W - 90, 360);

  ctx.fillStyle = '#E8DAB2';
  ctx.font = '600 44px Georgia, serif';
  ctx.fillText('AMOUNT', W - 90, 480);

  ctx.fillStyle = GOLD_LIGHT;
  ctx.font = 'bold 180px Georgia, serif';
  ctx.fillText(`Rs ${amount}`, W - 90, 660);

  // code chip
  const chipW = 720;
  const chipX = W - 90 - chipW;
  const chipY = 720;
  ctx.fillStyle = '#FFFFFF';
  roundRect(ctx, chipX, chipY, chipW, 110, 18);
  ctx.fill();
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 3;
  roundRect(ctx, chipX, chipY, chipW, 110, 18);
  ctx.stroke();
  ctx.fillStyle = '#0E0A2E';
  ctx.font = 'bold 56px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`CODE: ${code}`, chipX + chipW / 2, chipY + 55);

  // footer
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(232,218,178,0.7)';
  ctx.font = '600 28px Georgia, serif';
  ctx.textAlign = 'right';
  ctx.fillText('USE AT ASTROSEER APP', W - 90, H - 60);
}

function drawMedallion(ctx, cx, cy, R) {
  // outer sun-ray ring
  ctx.save();
  ctx.translate(cx, cy);
  const rays = 24;
  for (let i = 0; i < rays; i += 1) {
    const a = (i / rays) * Math.PI * 2;
    const r1 = R * 0.55;
    const r2 = R;
    ctx.strokeStyle = i % 2 ? GOLD : GOLD_LIGHT;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
    ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
    ctx.stroke();
  }
  // inner circle
  ctx.fillStyle = NAVY_DARK;
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 6;
  ctx.stroke();
  // crescent eye in the centre
  drawCrescent(ctx, 0, 0, R * 0.32, GOLD_LIGHT);
  // central star
  ctx.fillStyle = '#FFFAE7';
  drawStar(ctx, 0, 0, 5, R * 0.13, R * 0.05);
  ctx.restore();
}

function drawCrescent(ctx, cx, cy, r, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  // bite
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(cx + r * 0.35, cy - r * 0.1, r * 0.85, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawStar(ctx, cx, cy, spikes, outerR, innerR) {
  ctx.beginPath();
  let rot = (Math.PI / 2) * 3;
  const step = Math.PI / spikes;
  ctx.moveTo(cx, cy - outerR);
  for (let i = 0; i < spikes; i += 1) {
    let x = cx + Math.cos(rot) * outerR;
    let y = cy + Math.sin(rot) * outerR;
    ctx.lineTo(x, y);
    rot += step;
    x = cx + Math.cos(rot) * innerR;
    y = cy + Math.sin(rot) * innerR;
    ctx.lineTo(x, y);
    rot += step;
  }
  ctx.lineTo(cx, cy - outerR);
  ctx.closePath();
  ctx.fill();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Deterministic pseudo-random so the star field is identical every
// render (no flicker on re-mount).
function pseudoRandom(seed) {
  const s = Math.sin(seed * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}
