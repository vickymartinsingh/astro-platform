// Legacy URL. The call-only history has been merged into the unified
// /consultations page. See ./chat-history.js for the same redirect.
import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function CallHistoryRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/consultations'); }, [router]);
  return null;
}
