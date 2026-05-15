import { useEffect, useState } from 'react';

// Loads the Razorpay checkout script once (blueprint 4.11 / Section 7.6).
export function useRazorpay() {
  const [ready, setReady] = useState(
    typeof window !== 'undefined' && !!window.Razorpay);
  useEffect(() => {
    if (ready) return;
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => setReady(true);
    document.body.appendChild(s);
  }, [ready]);
  return ready;
}
