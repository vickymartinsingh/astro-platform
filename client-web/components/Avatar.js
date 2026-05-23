import { signFromDOB } from '@astro/shared';
import ZodiacGlyph from './ZodiacGlyph';

// Resolves a customer's display picture:
//  - avatarChoice 'none'        -> neutral initial
//  - 'photo' + profileImage     -> uploaded picture
//  - 'sign:<Sign>'              -> chosen zodiac avatar
//  - 'auto'                     -> zodiac from their DOB
//  - unset                      -> photo if any, else DOB zodiac, else neutral
export function resolveAvatar(p) {
  const c = p && p.avatarChoice;
  if (c === 'none') return { kind: 'none' };
  if (c === 'photo' && p && p.profileImage) {
    return { kind: 'img', src: p.profileImage };
  }
  if (typeof c === 'string' && c.slice(0, 5) === 'sign:') {
    return { kind: 'sign', sign: c.slice(5) };
  }
  if (c === 'auto') {
    const s = p && p.dob ? signFromDOB(p.dob) : null;
    return s ? { kind: 'sign', sign: s } : { kind: 'none' };
  }
  if (p && p.profileImage) return { kind: 'img', src: p.profileImage };
  // Gender-aware illustrated default (unique per uid) when the user has
  // a gender on their profile. Free DiceBear, deterministic seed.
  if (p && p.gender) {
    const style = String(p.gender).toLowerCase() === 'female' ? 'lorelei'
      : String(p.gender).toLowerCase() === 'male' ? 'notionists'
      : 'personas';
    const seed = encodeURIComponent(p.uid || p.id || p.email || p.name
      || 'guest');
    return { kind: 'img',
      src: `https://api.dicebear.com/9.x/${style}/svg?seed=${seed}` };
  }
  const s = p && p.dob ? signFromDOB(p.dob) : null;
  return s ? { kind: 'sign', sign: s } : { kind: 'none' };
}

export default function Avatar({ profile, size = 80, className = '' }) {
  const a = resolveAvatar(profile);
  const box = `rounded-full bg-bg-light overflow-hidden flex items-center
    justify-center ${className}`;
  const style = { width: size, height: size };
  if (a.kind === 'img') {
    return (
      <img src={a.src} alt="" style={style}
        className={`${box} object-cover`} />
    );
  }
  if (a.kind === 'sign') {
    return (
      <span style={style} className={box}>
        <ZodiacGlyph sign={a.sign}
          className="h-1/2 w-1/2 text-gold" />
      </span>
    );
  }
  const letter = ((profile && profile.name) || 'U').trim()
    .charAt(0).toUpperCase();
  return (
    <span style={style}
      className={`${box} font-bold text-primary`}>
      {letter}
    </span>
  );
}
