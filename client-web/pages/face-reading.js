// Face Reading shortcut. The actual feature lives in /discover with
// id=face_reading - see ./palm-reading.js for the rationale.
import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function FaceReadingShortcut() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/discover?f=face_reading');
  }, [router]);
  return null;
}
