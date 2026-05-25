# Customer App End-to-End Test (demo@demo.com, wallet ₹500)

**Test environment:** localhost:3000 (client-web dev)
**Test user:** `demo@demo.com / demo@demo.com` (uid `UvO1au1PaFfgLWnw6n38PpgXHGB2`)
**Started:** v1.0.68 codebase

---

## Bugs Found & Fixed (this session)

### 🐛 #1 — Splash screen stuck for 1.8 s+ on every load — **FIXED**
**Symptom:** brand cover + spinning splash for ~2 s before any UI; user reported "showing this for few seconds, fix it".
**Root cause:** `SplashScreen.js` held the splash unconditionally for 1.3 s + 0.5 s. The `_document.js` boot cover already paints the brand background on the first frame, so the React splash was pure padding.
**Fix:** `SplashScreen.js` now returns `null`. The boot cover handles the visual transition. Component file kept (no-op) so the `_app.js` import doesn't break.

### 🐛 #2 — KundliGate doesn't pre-fill DOB/place from profile — **FIXED**
**Symptom:** demo user has `dob: '01-01-2000', city: 'Hyderabad'` on their profile, but the kundli birth-details modal showed empty DOB/time/place fields when starting their first chat. User had to re-type everything they already saved.
**Fix:** `kundliGate.js` `requestSession()` now seeds the new-kundli form from `profile.dob / tob / ampm / city + state` so the modal opens pre-filled. Only blank fields need typing.

### 🐛 #3 — Chat input placeholder shows "Waiting for the astrologer to accept..." after session ended — **FIXED**
**Symptom:** after End is clicked, the message input is disabled but the placeholder still says "Waiting for the astrologer to accept...".
**Fix:** `chat/[id].js` placeholder now branches on `session.status`:
- `active` → "Message..."
- `ended` → "Consultation ended."
- `cancelled` → "Consultation cancelled."
- view-only → "Viewing past messages."
- default (still requesting) → "Waiting for the astrologer to accept..."

---

## Pages Tested ✓

| Page | Result |
|---|---|
| `/` (home/dashboard, guest) | ✓ shows "The stars have answers" hero + astrologer cards |
| Login modal | ✓ email/password works, redirects to /dashboard or last page |
| `/dashboard` (logged in) | ✓ all nav + skill quick-links present |
| `/astrologers` | ✓ 13 astrologers listed with skill chips, price, badges |
| `/astrologer/{id}` | ✓ full profile, prices, Start Chat/Call/Video buttons |
| Chat (`/chat/{id}`) | ✓ session created, AI auto-accepted, multi-bubble reply, date-aware (2026 → 2026-2028 windows), no dashes, language English ✓ |
| End session + rate modal | ✓ 5-star + Skip work |
| `/kundli` | ✓ form loads with Gender/DOB/Time/Place |
| `/numerology` | ✓ form loads, Generate report button |
| `/horoscope` | ✓ heading "Horoscope" |
| `/tarot` | ✓ heading "Pick your card" |
| `/matching` | ✓ heading "Marriage Matching" |
| `/remedies` | ✓ heading "Astro Remedies" |
| `/profile` | ✓ name/mobile/email/code editable; danger zone styled red |
| `/wallet` | ✓ ₹500 balance, quick-pick amounts, Coupon Apply, Gift Redeem |
| Coupon Apply | ✓ button disabled when empty, shows "Coupon X not found" on invalid |
| `/transactions` | ✓ heading "Order & Transaction History" |
| `/chat-history`, `/call-history`, `/favorites`, `/following`, `/notifications`, `/support`, `/live` | ✓ all load with correct heading + no JS errors |
| Logout | ✓ returns to /dashboard guest view |

## AI flow validation (this build is healthy)
- ✓ Auto-accept the session within ~1 second
- ✓ Greeting (`Namaste Demo User, I am Vicky Martin Singh…`) sent immediately
- ✓ Reply to "When will I get married?" arrived as **3 bubbles** within ~12 s
- ✓ Used future years (`late 2026 and early 2028`) — date awareness fix working
- ✓ Followed-up with a question ("Is there a particular type of partner you are looking for?")
- ✓ No dashes anywhere in reply
- ✓ Short sentences (~12-18 words each)

## Console
No JavaScript errors during the entire test pass.
