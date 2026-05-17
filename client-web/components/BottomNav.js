import Link from 'next/link';
import { useRouter } from 'next/router';

// Astrotalk-style fixed bottom tab bar (mobile only). Five tabs:
// Home · Chat · Live · Call · Remedies. The active tab turns brand
// yellow. Hidden on >=md (desktop keeps the top nav).
const I = {
  width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.7,
  strokeLinecap: 'round', strokeLinejoin: 'round',
};

function Home(p) {
  return (
    <svg {...I} {...p}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M10 21v-6h4v6" />
    </svg>
  );
}
function Chat(p) {
  return (
    <svg {...I} {...p}>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.8A8 8 0 1 1 21 12z" />
      <path d="M8.5 11h7M8.5 14h4.5" />
    </svg>
  );
}
function Live(p) {
  return (
    <svg {...I} {...p}>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="m16 10 5-3v10l-5-3" />
    </svg>
  );
}
function Call(p) {
  return (
    <svg {...I} {...p}>
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5
        0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2
        1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.8a16 16 0 0 0 6 6l1.3-1.2a2
        2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2.1z" />
    </svg>
  );
}
function Remedies(p) {
  return (
    <svg {...I} {...p}>
      <path d="M12 3c2.5 2 4 4.5 4 7a4 4 0 0 1-8 0c0-2.5 1.5-5 4-7z" />
      <path d="M7 21h10M9 21l.7-4M15 21l-.7-4" />
    </svg>
  );
}

const TABS = [
  { href: '/dashboard', label: 'Home', Ico: Home, match: ['/dashboard'] },
  { href: '/astrologers', label: 'Chat', Ico: Chat,
    match: ['/astrologers', '/chat/[id]', '/chat-history'] },
  { href: '/live', label: 'Live', Ico: Live, match: ['/live'] },
  { href: '/astrologers?mode=call', label: 'Call', Ico: Call,
    match: ['/call/[id]', '/call-history'] },
  { href: '/remedies', label: 'Remedies', Ico: Remedies,
    match: ['/remedies'] },
];

export default function BottomNav() {
  const router = useRouter();
  const path = router.pathname;
  const query = router.asPath;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200
                    bg-white safe-bottom md:hidden">
      <div className="mx-auto flex max-w-md items-stretch justify-between">
        {TABS.map(({ href, label, Ico, match }) => {
          const active = match.includes(path)
            || (label === 'Call' && query.startsWith('/astrologers?mode=call'))
            || (label === 'Chat' && path === '/astrologers'
                && !query.startsWith('/astrologers?mode=call'));
          return (
            <Link key={label} href={href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2
                ${active ? 'text-primary' : 'text-sub-text'}`}>
              <span className={`flex h-9 w-12 items-center justify-center
                rounded-full transition ${active ? 'bg-bg-light' : ''}`}>
                <Ico />
              </span>
              <span className={`text-[11px] ${active
                ? 'font-bold' : 'font-medium'}`}>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
