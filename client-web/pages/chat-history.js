// Legacy URL. The chat-only history has been merged into the unified
// /consultations page. Anyone landing here from an old menu entry,
// bookmark or push notification gets a transparent client-side
// redirect; the server-side getServerSideProps redirect could not be
// added because the project ships a static export (next.config.js
// output: 'export' under Capacitor).
import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function ChatHistoryRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/consultations'); }, [router]);
  return null;
}
