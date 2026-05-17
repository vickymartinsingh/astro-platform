// Owner / super-admin allowlist.
//
// The Firestore users/{uid}.role can get reset to 'client' by
// ensureUserDoc whenever that account's user doc is (re)created (e.g.
// after a delete during cleanup, or first login on the client app).
// To make the owner account un-lockout-able, these emails are ALWAYS
// treated as admin regardless of the stored role. Login still requires
// the correct password - this only governs the role gate.
export const ADMIN_EMAILS = ['vickymartinsing@gmail.com'];

const norm = (s) => String(s || '').trim().toLowerCase();

export function isAdminEmail(email) {
  return ADMIN_EMAILS.map(norm).includes(norm(email));
}

// profile = users doc (may be null), authEmail = Firebase auth email.
export function isAdminUser(profile, authEmail) {
  if (profile && profile.role === 'admin') return true;
  return isAdminEmail((profile && profile.email) || authEmail);
}
