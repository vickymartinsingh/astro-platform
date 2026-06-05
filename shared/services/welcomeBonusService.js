// welcomeBonusService - fires the welcome bonus after first signup.
//
// All policy lives in settings/config (read SERVER-SIDE on every call),
// so flipping the toggle in /admin-welcome-bonus takes effect for the
// very next signup with NO app rebuild and NO Vercel redeploy. Three
// modes:
//   auto_credit       wallet is credited atomically + transaction logged
//   redemption_code   a gift card code is generated and emailed
//   email_only        marketing email only (no money moves)
//
// All three modes optionally send a push + an in-app notification.
//
// Caller side: a thin wrapper around the /api/giftCard relay action.
// The relay does the wallet credit (admin SDK so Firestore rules
// don't block it) and the idempotency check so this function is safe
// to call twice from racing tabs.
import { auth } from '../firebase.js';

function pushEndpoint() {
  return (typeof process !== 'undefined'
    && process.env && process.env.NEXT_PUBLIC_PUSH_ENDPOINT)
    || 'https://astro-platform-push-relay.vercel.app/api/sendPush';
}
function giftRelay() {
  const push = pushEndpoint();
  return push ? push.replace(/\/sendPush\/?$/, '/giftCard') : '';
}

// authUser is the Firebase Auth user. We never throw - bonus failure
// must not block signup.
export async function applyWelcomeBonus(authUser) {
  try {
    const url = giftRelay();
    if (!url) return { skipped: 'no_endpoint' };
    const user = authUser || (auth && auth.currentUser);
    if (!user) return { skipped: 'no_auth' };
    const token = await user.getIdToken();
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action: 'applyWelcomeBonus' }),
    });
    const j = await r.json().catch(() => ({}));
    return j;
  } catch (_) {
    return { skipped: 'error' };
  }
}

// Admin previews the email + push template against fake tokens so they
// can iterate on copy without sending themselves test signups.
export function renderWelcomeBonusPreview(cfg, ctx = {}) {
  const c = cfg || {};
  const ctxData = {
    name: ctx.name || 'Vicky',
    amount: String(c.welcome_bonus_amount || 0),
    code: ctx.code || 'WELCOME50',
    platform: c.brand_name || 'AstroSeer',
  };
  const fill = (s) => String(s || '')
    .replace(/\{\{name\}\}/g, ctxData.name)
    .replace(/\{\{amount\}\}/g, ctxData.amount)
    .replace(/\{\{code\}\}/g, ctxData.code)
    .replace(/\{\{platform\}\}/g, ctxData.platform);

  return {
    emailSubject: fill(c.welcome_bonus_email_subject
      || 'Welcome to {{platform}}!'),
    emailHtml: fill(c.welcome_bonus_email_html || defaultHtml(c)),
    pushTitle: fill(c.welcome_bonus_push_title
      || 'Welcome to {{platform}}!'),
    pushBody: fill(c.welcome_bonus_push_body
      || (c.welcome_bonus_mode === 'redemption_code'
        ? 'Use code {{code}} to claim Rs {{amount}} in your wallet.'
        : c.welcome_bonus_mode === 'email_only'
          ? 'Your account is ready - explore your first reading.'
          : 'Rs {{amount}} bonus added to your wallet. Enjoy!')),
  };
}

function defaultHtml(c) {
  const mode = c.welcome_bonus_mode || 'auto_credit';
  if (mode === 'redemption_code') {
    return '<p>Hi {{name}},</p>'
      + '<p>Welcome to {{platform}}! We have created a gift card '
      + 'of Rs {{amount}} for you.</p>'
      + '<p><b>Your code:</b> '
      + '<span style="font-size:18px;background:#FBF7EE;'
      + 'padding:6px 12px;border-radius:6px;letter-spacing:1px;">'
      + '{{code}}</span></p>'
      + '<p>Redemption steps:</p>'
      + '<ol><li>Open the {{platform}} app and sign in.</li>'
      + '<li>Go to Wallet &rarr; Redeem code.</li>'
      + '<li>Enter the code above and tap Apply.</li></ol>'
      + '<p>Rs {{amount}} will be credited to your wallet instantly. '
      + 'Enjoy your first reading!</p>';
  }
  if (mode === 'auto_credit') {
    return '<p>Hi {{name}},</p>'
      + '<p>Welcome to {{platform}}! We have added a gift card of '
      + 'Rs {{amount}} to your wallet (code: '
      + '<b>WELCOME{{amount}}</b>) as a thank-you for joining.</p>'
      + '<p>You can use it for any chat, call or kundli reading on '
      + 'the platform. Have a wonderful first session!</p>';
  }
  return '<p>Hi {{name}},</p>'
    + '<p>Welcome to {{platform}}! Your account is ready - tap '
    + 'around and discover your first reading.</p>';
}
