import { useEffect, useState } from 'react';
import { db } from '@astro/shared';
import { doc, onSnapshot } from 'firebase/firestore';

// Blueprint 6.27, admin-controlled top banner. Audience: all | astrologers.
export default function AnnouncementBanner() {
  const [a, setA] = useState(null);
  useEffect(() => onSnapshot(doc(db, 'settings', 'announcement'), (s) =>
    setA(s.exists() ? s.data() : null)), []);

  if (!a || !a.active || !a.text) return null;
  if (a.target === 'clients') return null;

  return (
    <div className="bg-warning px-4 py-2 text-center text-sm text-white">
      {a.text}
      {a.ctaLabel && a.ctaLink && (
        <a href={a.ctaLink} className="ml-2 font-bold underline">
          {a.ctaLabel}
        </a>
      )}
    </div>
  );
}
