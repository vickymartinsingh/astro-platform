// membershipService - Membership tiers (Basic / Silver / Gold / Platinum).
//
// Data model:
//   settings/membership              tiers config + FAQ
//   users/{uid}.membership           per-user membership state
//
// The free Basic tier is implicit for every user. Paid tiers deduct
// from the user's wallet atomically via runTransaction so concurrent
// subscribe calls from racing tabs never double-debit or corrupt the
// balance. Report-credit and call-minute tracking also use
// transactions to stay consistent.
//
// Firebase Spark plan compatible - everything is client-side
// Firestore, no Cloud Functions.
import {
  doc, getDoc, setDoc, updateDoc, runTransaction, serverTimestamp,
  Timestamp, onSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase.js';

// ---- Default config -----------------------------------------------------

const DEFAULT_TIERS = [
  {
    id: 'basic',
    name: 'Basic',
    price: 0,
    color: '#7F2020',
    icon: '⭐',
    badgeEnabled: false,
    badgeKycRequired: false,
    benefits: {
      freeReports: [],
      callMinutes: 0,
      callRateCap: 0,
      prioritySupport: false,
      discountPercent: 0,
      customBenefits: [],
    },
    order: 0,
  },
  {
    id: 'silver',
    name: 'Silver',
    price: 299,
    color: '#A0A0A0',
    icon: '🥈',
    badgeEnabled: false,
    badgeKycRequired: false,
    benefits: {
      freeReports: ['kundli_basic', 'moon_nakshatra'],
      callMinutes: 30,
      callRateCap: 25,
      prioritySupport: false,
      discountPercent: 5,
      customBenefits: [
        { label: 'Monthly horoscope report', description: 'Get a detailed monthly forecast' },
      ],
    },
    order: 1,
  },
  {
    id: 'gold',
    name: 'Gold',
    price: 599,
    color: '#D4A12A',
    icon: '🥇',
    badgeEnabled: false,
    badgeKycRequired: false,
    benefits: {
      freeReports: ['kundli_basic', 'moon_nakshatra', 'yogas_doshas', 'panchang_birth'],
      callMinutes: 100,
      callRateCap: 20,
      prioritySupport: true,
      discountPercent: 10,
      customBenefits: [
        { label: 'Monthly horoscope report', description: 'Detailed monthly forecast' },
        { label: 'Exclusive member webinars', description: 'Live sessions with top astrologers' },
      ],
    },
    order: 2,
  },
  {
    id: 'platinum',
    name: 'Platinum',
    price: 999,
    color: '#7F2020',
    icon: '💎',
    badgeEnabled: false,
    badgeKycRequired: false,
    benefits: {
      freeReports: [
        'kundli_basic', 'kundli_lagna', 'moon_nakshatra', 'yogas_doshas',
        'panchang_birth', 'd9_navamsa', 'divisional_all',
      ],
      callMinutes: 200,
      callRateCap: 15,
      prioritySupport: true,
      discountPercent: 15,
      customBenefits: [
        { label: 'All monthly reports free', description: 'Every report type at no extra cost' },
        { label: 'VIP astrologer access', description: 'Book slots with premium astrologers' },
        { label: 'Exclusive member webinars', description: 'Live sessions with top astrologers' },
      ],
    },
    order: 3,
  },
];

const DEFAULT_FAQ = [
  { q: 'What is AstroSeer Membership?', a: 'AstroSeer Membership gives you exclusive benefits like free reports, discounted calls, and priority support based on your tier.' },
  { q: 'Can I upgrade or downgrade my plan?', a: 'Yes, you can change your plan at any time. The new plan takes effect from the next billing cycle.' },
  { q: 'How do free call minutes work?', a: 'Your included call minutes are available each month. Unused minutes do not carry over. Calls are capped at the rate specified in your plan.' },
  { q: 'What happens when my membership expires?', a: 'You will automatically move to the Basic (free) tier. Your account and history remain intact.' },
  { q: 'Can I cancel my membership?', a: 'Yes, you can cancel anytime from your profile. You will continue to enjoy benefits until the end of your current billing period.' },
  { q: 'Are there any refunds?', a: 'Membership fees are non-refundable. However, unused call minutes or report credits from a cancelled plan are forfeited at the end of the billing period.' },
];

// ---- Config CRUD --------------------------------------------------------

// Returns the full default config object (tiers + FAQ). Useful for
// seeding the admin editor on first load when no Firestore doc exists.
export function getDefaultConfig() {
  return {
    enabled: true,
    tiers: DEFAULT_TIERS.map((t) => ({ ...t, benefits: { ...t.benefits } })),
    faq: DEFAULT_FAQ.map((f) => ({ ...f })),
  };
}

// Read settings/membership from Firestore, falling back to the built-in
// defaults when the doc doesn't exist yet (first boot before admin saves).
export async function getMembershipConfig() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'membership'));
    if (!snap.exists()) return getDefaultConfig();
    const d = snap.data() || {};
    return {
      enabled: d.enabled !== false,
      tiers: Array.isArray(d.tiers) ? d.tiers : getDefaultConfig().tiers,
      faq: Array.isArray(d.faq) ? d.faq : DEFAULT_FAQ,
    };
  } catch (e) {
    console.error('[membershipService] getMembershipConfig', e);
    return getDefaultConfig();
  }
}

// Admin saves the full config (tiers + FAQ + enabled flag).
export async function saveMembershipConfig(config) {
  const payload = {
    enabled: config.enabled !== false,
    tiers: Array.isArray(config.tiers) ? config.tiers : [],
    faq: Array.isArray(config.faq) ? config.faq : [],
    updatedAt: serverTimestamp(),
  };
  await setDoc(doc(db, 'settings', 'membership'), payload, { merge: true });
}

// ---- User membership ----------------------------------------------------

const BASIC_MEMBERSHIP = {
  tierId: 'basic',
  startedAt: null,
  expiresAt: null,
  callMinutesUsed: 0,
  freeReportsUsed: [],
};

// Read the membership sub-object from users/{uid}. Returns a normalised
// object even if the field is missing (defaults to basic tier).
export async function getUserMembership(uid) {
  if (!uid) return { ...BASIC_MEMBERSHIP };
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return { ...BASIC_MEMBERSHIP };
    const m = snap.data().membership;
    if (!m || !m.tierId) return { ...BASIC_MEMBERSHIP };
    return {
      tierId: m.tierId || 'basic',
      startedAt: m.startedAt || null,
      expiresAt: m.expiresAt || null,
      callMinutesUsed: Number(m.callMinutesUsed || 0),
      freeReportsUsed: Array.isArray(m.freeReportsUsed)
        ? m.freeReportsUsed : [],
    };
  } catch (e) {
    console.error('[membershipService] getUserMembership', e);
    return { ...BASIC_MEMBERSHIP };
  }
}

// Helper: resolve a tier object from the config by id. Falls back to
// the built-in defaults when config is not provided.
async function resolveTier(tierId, config) {
  const cfg = config || await getMembershipConfig();
  const tiers = Array.isArray(cfg.tiers) ? cfg.tiers : [];
  return tiers.find((t) => t.id === tierId) || null;
}

// Subscribe / change the user's membership tier. For paid tiers the
// price is deducted from the wallet atomically inside a transaction.
// Returns { success, error? }
export async function subscribeMembership(uid, tierId) {
  if (!uid) return { success: false, error: 'No user.' };
  if (!tierId) return { success: false, error: 'No tier specified.' };

  const cfg = await getMembershipConfig();
  if (!cfg.enabled) {
    return { success: false, error: 'Membership is currently disabled.' };
  }

  const tier = await resolveTier(tierId, cfg);
  if (!tier) {
    return { success: false, error: 'Unknown membership tier.' };
  }

  const price = Math.max(0, Math.floor(Number(tier.price || 0)));
  const userRef = doc(db, 'users', uid);

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(userRef);
      const data = (snap.exists() && snap.data()) || {};

      // Deduct wallet for paid tiers.
      if (price > 0) {
        const wallet = Number(data.wallet || 0);
        if (wallet < price) {
          throw new Error(
            `Insufficient wallet balance. Need ${price} INR, have ${wallet} INR.`,
          );
        }
        tx.set(userRef, { wallet: wallet - price }, { merge: true });
      }

      // 30-day billing cycle for paid tiers, null for free.
      const now = Timestamp.now();
      const expiresAt = price > 0
        ? Timestamp.fromMillis(now.toMillis() + 30 * 24 * 60 * 60 * 1000)
        : null;

      tx.set(userRef, {
        membership: {
          tierId,
          startedAt: now,
          expiresAt,
          callMinutesUsed: 0,
          freeReportsUsed: [],
        },
      }, { merge: true });
    });
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: (e && e.message) || 'Subscription failed. Please try again.',
    };
  }
}

// Cancel membership - reverts to the free Basic tier.
export async function cancelMembership(uid) {
  if (!uid) return;
  await updateDoc(doc(db, 'users', uid), {
    membership: {
      tierId: 'basic',
      startedAt: null,
      expiresAt: null,
      callMinutesUsed: 0,
      freeReportsUsed: [],
    },
  });
}

// ---- Report access ------------------------------------------------------

// Returns true when the user's tier includes reportTypeId for free AND
// they have not already claimed it this billing cycle.
export async function checkReportAccess(uid, reportTypeId) {
  if (!uid || !reportTypeId) return false;
  try {
    const [membership, cfg] = await Promise.all([
      getUserMembership(uid),
      getMembershipConfig(),
    ]);
    const tier = await resolveTier(membership.tierId, cfg);
    if (!tier) return false;

    // Check expiry for paid tiers.
    if (membership.expiresAt) {
      const exp = membership.expiresAt.toMillis
        ? membership.expiresAt.toMillis()
        : Number(membership.expiresAt);
      if (exp && exp <= Date.now()) return false;
    }

    const freeReports = Array.isArray(tier.benefits?.freeReports)
      ? tier.benefits.freeReports : [];
    if (!freeReports.includes(reportTypeId)) return false;

    const used = Array.isArray(membership.freeReportsUsed)
      ? membership.freeReportsUsed : [];
    return !used.includes(reportTypeId);
  } catch (e) {
    console.error('[membershipService] checkReportAccess', e);
    return false;
  }
}

// Mark a free report as used for this billing cycle (atomic).
export async function useReportCredit(uid, reportTypeId) {
  if (!uid || !reportTypeId) return;
  const userRef = doc(db, 'users', uid);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(userRef);
    const data = (snap.exists() && snap.data()) || {};
    const m = data.membership || {};
    const used = Array.isArray(m.freeReportsUsed)
      ? [...m.freeReportsUsed] : [];
    if (!used.includes(reportTypeId)) {
      used.push(reportTypeId);
    }
    tx.set(userRef, {
      membership: { ...m, freeReportsUsed: used },
    }, { merge: true });
  });
}

// ---- Call access --------------------------------------------------------

// Check whether the user can make a call of the given duration.
// Returns { allowed, remainingMinutes, rateCap }
export async function checkCallAccess(uid, minutesNeeded) {
  const fallback = { allowed: false, remainingMinutes: 0, rateCap: 0 };
  if (!uid) return fallback;
  const needed = Math.max(0, Number(minutesNeeded || 0));

  try {
    const [membership, cfg] = await Promise.all([
      getUserMembership(uid),
      getMembershipConfig(),
    ]);
    const tier = await resolveTier(membership.tierId, cfg);
    if (!tier) return fallback;

    // Check expiry for paid tiers.
    if (membership.expiresAt) {
      const exp = membership.expiresAt.toMillis
        ? membership.expiresAt.toMillis()
        : Number(membership.expiresAt);
      if (exp && exp <= Date.now()) return fallback;
    }

    const included = Number(tier.benefits?.callMinutes || 0);
    const used = Number(membership.callMinutesUsed || 0);
    const remaining = Math.max(0, included - used);
    const rateCap = Number(tier.benefits?.callRateCap || 0);

    return {
      allowed: needed <= remaining,
      remainingMinutes: remaining,
      rateCap,
    };
  } catch (e) {
    console.error('[membershipService] checkCallAccess', e);
    return fallback;
  }
}

// Increment callMinutesUsed on the user's membership (atomic).
export async function useCallMinutes(uid, minutes) {
  if (!uid || !minutes) return;
  const mins = Math.max(0, Math.ceil(Number(minutes)));
  if (mins <= 0) return;
  const userRef = doc(db, 'users', uid);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(userRef);
    const data = (snap.exists() && snap.data()) || {};
    const m = data.membership || {};
    const current = Number(m.callMinutesUsed || 0);
    tx.set(userRef, {
      membership: { ...m, callMinutesUsed: current + mins },
    }, { merge: true });
  });
}

// ---- Badge status -------------------------------------------------------

// Returns the badge status for a user based on their active membership tier
// and the tier's badge configuration in settings/membership.
// Returns { hasBadge: boolean, tierId, tierName, color: '#6B8E23' }
export async function getUserMembershipBadgeStatus(uid) {
  const noBadge = { hasBadge: false, tierId: 'basic', tierName: 'Basic', color: '#6B8E23' };
  if (!uid) return noBadge;

  try {
    const [userSnap, cfg] = await Promise.all([
      getDoc(doc(db, 'users', uid)),
      getMembershipConfig(),
    ]);

    if (!userSnap.exists()) return noBadge;

    const userData = userSnap.data() || {};
    const m = userData.membership || {};
    const tierId = m.tierId || 'basic';

    // Check membership is active and not expired.
    if (m.expiresAt) {
      const exp = m.expiresAt.toMillis
        ? m.expiresAt.toMillis()
        : Number(m.expiresAt);
      if (exp && exp <= Date.now()) return { ...noBadge, tierId, tierName: tierId };
    } else if (tierId !== 'basic') {
      // Paid tier with no expiresAt is treated as expired.
      return { ...noBadge, tierId, tierName: tierId };
    }

    const tiers = Array.isArray(cfg.tiers) ? cfg.tiers : [];
    const tier = tiers.find((t) => t.id === tierId) || null;
    if (!tier) return noBadge;

    const tierName = tier.name || tierId;

    if (!tier.badgeEnabled) {
      return { hasBadge: false, tierId, tierName, color: '#6B8E23' };
    }

    if (tier.badgeKycRequired && !userData.kycVerified) {
      return { hasBadge: false, tierId, tierName, color: '#6B8E23' };
    }

    return { hasBadge: true, tierId, tierName, color: '#6B8E23' };
  } catch (e) {
    console.error('[membershipService] getUserMembershipBadgeStatus', e);
    return noBadge;
  }
}

// Listens for changes to users/{uid} and calls callback with the latest
// badge status whenever the document updates.
// Returns an unsubscribe function.
export function listenUserMembershipBadge(uid, callback) {
  if (!uid) return () => {};
  const userRef = doc(db, 'users', uid);
  return onSnapshot(userRef, async () => {
    try {
      const status = await getUserMembershipBadgeStatus(uid);
      callback(status);
    } catch (e) {
      console.error('[membershipService] listenUserMembershipBadge', e);
    }
  });
}
