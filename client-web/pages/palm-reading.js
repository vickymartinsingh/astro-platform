// Palm Reading shortcut. The actual feature lives in /discover with
// id=palm_reading - this page exists so the home-screen quick-action
// tile, the menu and any deep link can point to a clean URL instead
// of a query string. We redirect to /discover?f=palm_reading so the
// existing detail panel + purchase flow runs unchanged.
import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function PalmReadingShortcut() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/discover?f=palm_reading');
  }, [router]);
  return null;
}
