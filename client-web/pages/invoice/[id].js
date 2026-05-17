import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { db } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import { useRequireClient } from '../../lib/useAuth';

// Blueprint 6.29, GST invoice for a successful Razorpay payment.
// No new dependency: rendered as a clean printable page (Print → Save PDF).
export default function Invoice() {
  const router = useRouter();
  const { id } = router.query;            // orderId (payments doc id)
  const { user, profile, loading } = useRequireClient();
  const [pay, setPay] = useState(undefined);
  const [cfg, setCfg] = useState({});

  useEffect(() => {
    if (!id) return;
    (async () => {
      const [pSnap, cSnap] = await Promise.all([
        getDoc(doc(db, 'payments', id)),
        getDoc(doc(db, 'settings', 'config')),
      ]);
      setPay(pSnap.exists() ? pSnap.data() : null);
      setCfg(cSnap.exists() ? cSnap.data() : {});
    })();
  }, [id]);

  if (loading || pay === undefined) {
    return <div className="p-8 text-sub-text">Loading…</div>;
  }
  if (!pay || pay.userId !== user?.uid || pay.status !== 'success') {
    return <div className="p-8 text-sub-text">Invoice not available.</div>;
  }

  const gross = Number(pay.amount || 0);
  const gstPct = Number(cfg.gst_percent || 0);
  const base = gstPct ? gross / (1 + gstPct / 100) : gross;
  const gst = gross - base;
  const r = (n) => `₹${n.toFixed(2)}`;

  return (
    <div className="mx-auto max-w-2xl p-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">
            {cfg.platformName || 'AstroConnect'}
          </h1>
          {cfg.gstin && (
            <div className="text-sm text-sub-text">GSTIN: {cfg.gstin}</div>
          )}
        </div>
        <div className="text-right text-sm">
          <div className="font-bold">TAX INVOICE</div>
          <div>No: {pay.invoiceNo || String(id).slice(-10)}</div>
          <div>
            {pay.paidAt?.toDate
              ? pay.paidAt.toDate().toLocaleString() : ''}
          </div>
        </div>
      </div>

      <div className="mb-6 text-sm">
        <div className="font-semibold">Billed to</div>
        <div>{pay.userName || profile?.name}</div>
        <div className="text-sub-text">
          {pay.userEmail || profile?.email}
        </div>
        {(pay.userPhone || profile?.phone) && (
          <div className="text-sub-text">
            {pay.userPhone || profile?.phone}
          </div>
        )}
        {pay.userCode && (
          <div className="text-sub-text">User ID: {pay.userCode}</div>
        )}
      </div>

      <table className="w-full text-sm">
        <tbody>
          <tr className="border-b">
            <td className="py-2">Wallet recharge</td>
            <td className="py-2 text-right">{r(base)}</td>
          </tr>
          {gstPct > 0 && (
            <tr className="border-b">
              <td className="py-2">GST @ {gstPct}%</td>
              <td className="py-2 text-right">{r(gst)}</td>
            </tr>
          )}
          <tr className="font-bold">
            <td className="py-2">Total Paid</td>
            <td className="py-2 text-right">{r(gross)}</td>
          </tr>
        </tbody>
      </table>

      <div className="mt-6 space-y-0.5 text-xs text-sub-text">
        <div>Payment status: <b className="text-success">PAID</b></div>
        {pay.gateway && (
          <div>Paid via: <b className="capitalize">{pay.gateway}</b></div>
        )}
        {pay.paymentId && <div>Payment ID: {pay.paymentId}</div>}
        {pay.orderId && <div>Order ID: {pay.orderId}</div>}
        <div>Amount: ₹{Number(pay.amount || 0).toFixed(2)}</div>
        <div>This is a system-generated tax invoice and a permanent
          record of the transaction.</div>
      </div>

      <button onClick={() => window.print()}
        className="btn-primary mt-6 print:hidden">
        Print / Save as PDF
      </button>
    </div>
  );
}
