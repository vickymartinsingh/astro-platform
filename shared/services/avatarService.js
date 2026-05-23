// Gender-aware default avatars using DiceBear (free, no API key).
// Same uid -> always the same picture; different uids -> different
// pictures, so every astrologer / customer who has no uploaded photo
// gets a unique illustrated face that matches their gender.
//
// Female -> "lorelei" style (feminine illustrated portraits).
// Male   -> "notionists" style (more masculine outlines).
// Other / unspecified -> "personas" style (neutral cartoon faces).
const STYLES = {
  female: 'lorelei',
  male: 'notionists',
  other: 'personas',
};

function styleFor(gender) {
  const g = String(gender || '').toLowerCase().trim();
  if (g === 'f' || g === 'female' || g === 'woman' || g === 'lady') {
    return STYLES.female;
  }
  if (g === 'm' || g === 'male' || g === 'man') {
    return STYLES.male;
  }
  return STYLES.other;
}

// Returns a stable DiceBear avatar URL for the given uid + gender. Use as
// the src of an <img>. Falls back to a neutral seeded avatar if no uid.
export function genderedAvatarUrl(uid, gender) {
  const seed = encodeURIComponent(String(uid || 'guest'));
  const style = styleFor(gender);
  return `https://api.dicebear.com/9.x/${style}/svg?seed=${seed}`
    + '&backgroundType=gradientLinear';
}

// Convenience: returns the gendered URL for any profile-like object.
// Picks `profileImage` first; falls back to gendered URL when missing.
export function avatarSrcFor(profile) {
  if (!profile) return genderedAvatarUrl('guest', null);
  if (profile.profileImage) return profile.profileImage;
  return genderedAvatarUrl(profile.uid || profile.id || profile.email,
    profile.gender);
}
