// Vedic shortcut. Lands the customer on the Core Vedic group of the
// /discover feature catalog (Janma kundli, dasha, transits, doshas,
// remedies, lifetime report, etc.) so they can browse + buy any of
// the API-backed Vedic reports.
import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function VedicShortcut() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/discover?g=core');
  }, [router]);
  return null;
}
