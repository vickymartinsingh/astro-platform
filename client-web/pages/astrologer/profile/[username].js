import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import {
  collection, getDocs, query, where, limit,
} from 'firebase/firestore';
import { db } from '@astro/shared';
import Layout from '../../../components/Layout';

export default function AstrologerByUsername() {
  const router = useRouter();
  const { username } = router.query;
  const [status, setStatus] = useState('loading'); // 'loading' | 'notfound'

  useEffect(() => {
    if (!username) return;
    let cancelled = false;

    async function lookup() {
      try {
        const snap = await getDocs(
          query(
            collection(db, 'astrologers'),
            where('username', '==', username.toLowerCase()),
            limit(1),
          ),
        );
        if (cancelled) return;
        if (!snap.empty) {
          const docId = snap.docs[0].id;
          router.replace(`/astrologer/${docId}`);
        } else {
          setStatus('notfound');
        }
      } catch (_) {
        if (!cancelled) setStatus('notfound');
      }
    }

    lookup();
    return () => { cancelled = true; };
  }, [username]);

  if (status === 'loading') {
    return (
      <Layout>
        <div style={styles.centered}>
          <div style={styles.spinner} />
          <p style={styles.loadingText}>Loading profile...</p>
        </div>
      </Layout>
    );
  }

  // Not found
  return (
    <Layout>
      <div style={styles.card}>
        <h1 style={styles.heading}>Profile not found</h1>
        <p style={styles.subText}>
          No astrologer found at{' '}
          <span style={styles.urlDisplay}>
            astroseer.in/astrologer/profile/{username}
          </span>
        </p>
        <button
          style={styles.backBtn}
          onClick={() => router.back()}
        >
          Go Back
        </button>
      </div>
    </Layout>
  );
}

const styles = {
  centered: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '40vh',
    gap: '16px',
  },
  spinner: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    border: '3px solid #FFF8E7',
    borderTopColor: '#D4A12A',
    animation: 'spin 0.8s linear infinite',
  },
  loadingText: {
    color: '#D4A12A',
    fontSize: '15px',
    fontWeight: 600,
  },
  card: {
    background: '#FFF8E7',
    borderRadius: '12px',
    padding: '32px 24px',
    maxWidth: '480px',
    margin: '48px auto',
    textAlign: 'center',
    boxShadow: '0 2px 12px rgba(127,32,32,0.10)',
  },
  heading: {
    color: '#7F2020',
    fontSize: '22px',
    fontWeight: 700,
    marginBottom: '12px',
  },
  subText: {
    color: '#555',
    fontSize: '14px',
    marginBottom: '24px',
    lineHeight: 1.6,
  },
  urlDisplay: {
    color: '#7F2020',
    fontWeight: 600,
    wordBreak: 'break-all',
  },
  backBtn: {
    background: '#7F2020',
    color: '#FFF8E7',
    border: 'none',
    borderRadius: '8px',
    padding: '10px 28px',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    letterSpacing: '0.02em',
  },
};
