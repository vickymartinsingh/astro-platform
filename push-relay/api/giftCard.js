// Gift cards (server-side so wallet credit is atomic + abuse-safe).
//
// POST { action: 'create'|'list'|'redeem', amount?, code? }
// Authorization: Bearer <Firebase ID token>
//   - create / list: caller must be an admin
//   - redeem: any signed-in user (credits THEIR wallet)
const admin = require('firebase-admin');

function init() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT not set');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
}

// Owner allowlist mirrors shared/admins.js so a gift card can be
// generated even if the Firestore role drifted from 'admin'.
const ADMIN_EMAILS = [
  'vickymartinsingh@gmail.com',
  'vickymartinsing@gmail.com',
];
const isAdminEmail = (e) => ADMIN_EMAILS.includes(
  String(e || '').trim().toLowerCase());

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function genCode() {
  let c = '';
  for (let i = 0; i < 8; i++) {
    c += ALPHA[Math.floor(Math.random() * ALPHA.length)];
  }
  return c;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',
    'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST' });

  try {
    init();
    const db = admin.firestore();
    const authz = req.headers.authorization || '';
    const idToken = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'no token' });
    const decoded = await admin.auth().verifyIdToken(idToken);
    const callerUid = decoded.uid;

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) { body = {}; }
    }
    body = body || {};
    const action = body.action;

    const callerDoc = await db.collection('users').doc(callerUid).get();
    const isAdmin = (callerDoc.exists
      && callerDoc.data().role === 'admin')
      || isAdminEmail(decoded.email)
      || (callerDoc.exists && isAdminEmail(callerDoc.data().email));

    if (action === 'create') {
      if (!isAdmin) return res.status(403).json({ error: 'not an admin' });
      const amount = Math.round(Number(body.amount));
      if (!(amount > 0)) {
        return res.status(400).json({ error: 'invalid amount' });
      }
      let code = genCode();
      for (let i = 0; i < 5; i++) {
        // eslint-disable-next-line no-await-in-loop
        const ex = await db.collection('giftCards').doc(code).get();
        if (!ex.exists) break;
        code = genCode();
      }
      await db.collection('giftCards').doc(code).set({
        code,
        amount,
        redeemed: false,
        redeemedBy: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return res.status(200).json({ success: true, code, amount });
    }

    if (action === 'list') {
      if (!isAdmin) return res.status(403).json({ error: 'not an admin' });
      const snap = await db.collection('giftCards')
        .orderBy('createdAt', 'desc').limit(100).get();
      const cards = snap.docs.map((d) => {
        const x = d.data() || {};
        return {
          code: x.code || d.id,
          amount: x.amount || 0,
          status: x.status || (x.redeemed ? 'used' : 'unused'),
          redeemed: !!x.redeemed,
          redeemedBy: x.redeemedBy || null,
          redeemedByName: x.redeemedByName || null,
          redeemedByEmail: x.redeemedByEmail || null,
          redeemedAt: x.redeemedAt || null,
          redeemedIp: x.redeemedIp || null,
          redeemedUa: x.redeemedUa || null,
          createdAt: x.createdAt || null,
        };
      });
      return res.status(200).json({ cards });
    }

    if (action === 'redeem') {
      const code = String(body.code || '').trim().toUpperCase();
      if (!code) return res.status(400).json({ error: 'code required' });
      // Capture caller's compliance context (IP + UA) for audit.
      const ip = (req.headers['x-forwarded-for']
        ? String(req.headers['x-forwarded-for']).split(',')[0].trim()
        : req.headers['x-real-ip']
          || (req.connection && req.connection.remoteAddress) || '');
      const ua = String(req.headers['user-agent'] || '').slice(0, 400);
      const ref = db.collection('giftCards').doc(code);
      const out = await db.runTransaction(async (t) => {
        const g = await t.get(ref);
        if (!g.exists) throw new Error('Invalid gift card code');
        const gc = g.data() || {};
        if (gc.redeemed) throw new Error('This gift card was already used');
        const amount = Math.round(Number(gc.amount) || 0);
        if (!(amount > 0)) throw new Error('Invalid gift card');
        const uRef = db.collection('users').doc(callerUid);
        const u = await t.get(uRef);
        const wallet = Number((u.data() || {}).wallet || 0) + amount;
        t.update(uRef, { wallet });
        t.update(ref, {
          status: 'used',
          redeemed: true,
          redeemedBy: callerUid,
          redeemedByName: (u.data() || {}).name || null,
          redeemedByEmail: (u.data() || {}).email || decoded.email || null,
          redeemedAt: admin.firestore.FieldValue.serverTimestamp(),
          redeemedIp: ip || '',
          redeemedUa: ua,
        });
        t.set(db.collection('transactions').doc(), {
          userId: callerUid,
          amount,
          type: 'credit',
          reason: 'gift card',
          referenceId: code,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { amount };
      });
      // In-app notification + push (best effort).
      try {
        await db.collection('notifications').add({
          userId: callerUid,
          title: 'Gift card redeemed',
          message: `+ Rs ${out.amount} added to your wallet (gift card).`,
          type: 'wallet',
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (_) {}
      try {
        const u = await db.collection('users').doc(callerUid).get();
        const ud = u.data() || {};
        const toks = []
          .concat(Array.isArray(ud.fcmTokens) ? ud.fcmTokens : [])
          .concat(ud.fcmToken ? [ud.fcmToken] : [])
          .filter(Boolean);
        if (toks.length) {
          await admin.messaging().sendEachForMulticast({
            tokens: [...new Set(toks)],
            notification: {
              title: 'Gift card redeemed',
              body: `Rs ${out.amount} added to your wallet.`,
            },
            data: { type: 'wallet', route: '/transactions' },
            android: {
              priority: 'high',
              notification: { channelId: 'astro-default', sound: 'default' },
            },
          });
        }
      } catch (_) {}
      return res.status(200).json({ success: true, amount: out.amount });
    }

    // ---- Welcome bonus -------------------------------------------------
    // Caller is the NEW user themselves (Bearer = their own token), right
    // after first OTP-verified signup. Reads settings/config to decide
    // whether to:
    //   - auto-credit the wallet (mode === 'auto_credit')
    //   - issue a redeemable gift card code (mode === 'redemption_code')
    //   - email-only (no money moves; admin uses the bonus channel only
    //     for marketing copy)
    //
    // Idempotent via users/{uid}.welcomeBonusAppliedAt - same user calling
    // twice is rejected. Settings are read fresh from Firestore on every
    // call so toggling enable/disable in /admin-welcome-bonus takes
    // effect INSTANTLY without a redeploy of any client app.
    if (action === 'applyWelcomeBonus') {
      const cfgSnap = await db.collection('settings').doc('config').get();
      const cfg = (cfgSnap.exists ? cfgSnap.data() : {}) || {};
      if (!cfg.welcome_bonus_enabled) {
        return res.status(200).json({ skipped: 'disabled' });
      }
      // Role gate - admins / astros never get the customer welcome bonus.
      const cu = callerDoc.data() || {};
      if (cu.role && cu.role !== 'client') {
        return res.status(200).json({ skipped: 'role' });
      }
      if (cu.welcomeBonusAppliedAt) {
        return res.status(200).json({ skipped: 'already_applied' });
      }
      const amount = Math.round(Number(cfg.welcome_bonus_amount) || 0);
      const mode = String(cfg.welcome_bonus_mode || 'auto_credit');
      const emailOn = !!cfg.welcome_bonus_email_enabled;
      const pushOn = cfg.welcome_bonus_push_enabled !== false;
      let code = null;
      if (amount > 0 && mode === 'auto_credit') {
        // Credit wallet + write transaction + tombstone the user so they
        // can't trigger this again from a second tab.
        await db.runTransaction(async (t) => {
          const ref = db.collection('users').doc(callerUid);
          const u = await t.get(ref);
          const w = Number((u.data() || {}).wallet || 0) + amount;
          t.update(ref, {
            wallet: w,
            welcomeBonusAppliedAt:
              admin.firestore.FieldValue.serverTimestamp(),
            welcomeBonusAmount: amount,
            welcomeBonusMode: 'auto_credit',
          });
          t.set(db.collection('transactions').doc(), {
            userId: callerUid,
            amount,
            type: 'credit',
            reason: 'welcome bonus',
            referenceId: 'welcome_bonus',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        });
      } else if (amount > 0 && mode === 'redemption_code') {
        let c = genCode();
        for (let i = 0; i < 5; i++) {
          // eslint-disable-next-line no-await-in-loop
          const ex = await db.collection('giftCards').doc(c).get();
          if (!ex.exists) break;
          c = genCode();
        }
        code = c;
        await db.collection('giftCards').doc(code).set({
          code, amount, redeemed: false, redeemedBy: null,
          reason: 'welcome_bonus',
          assignedTo: callerUid,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await db.collection('users').doc(callerUid).update({
          welcomeBonusAppliedAt:
            admin.firestore.FieldValue.serverTimestamp(),
          welcomeBonusAmount: amount,
          welcomeBonusMode: 'redemption_code',
          welcomeBonusCode: code,
        });
      } else {
        // No money: still stamp so we don't email-spam the user.
        await db.collection('users').doc(callerUid).update({
          welcomeBonusAppliedAt:
            admin.firestore.FieldValue.serverTimestamp(),
          welcomeBonusAmount: 0,
          welcomeBonusMode: 'email_only',
        });
      }

      // Render template. Token replacements come from settings/config.
      // Default copy lives here so the page works even when the admin
      // has never opened /admin-welcome-bonus.
      const display = cu.name || cu.email
        || (decoded && decoded.email) || 'there';
      const fillTokens = (s) => String(s || '')
        .replace(/\{\{name\}\}/g, display)
        .replace(/\{\{amount\}\}/g, String(amount))
        .replace(/\{\{code\}\}/g, code || '')
        .replace(/\{\{platform\}\}/g, cfg.brand_name || 'AstroSeer');

      let subject = cfg.welcome_bonus_email_subject
        || 'Welcome to {{platform}}!';
      let html = cfg.welcome_bonus_email_html || '';
      if (!html) {
        if (mode === 'redemption_code') {
          html = '<p>Hi {{name}},</p>'
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
        } else if (mode === 'auto_credit') {
          html = '<p>Hi {{name}},</p>'
            + '<p>Welcome to {{platform}}! We have added a gift card of '
            + 'Rs {{amount}} to your wallet (code: '
            + '<b>WELCOME{{amount}}</b>) as a thank-you for joining.</p>'
            + '<p>You can use it for any chat, call or kundli reading on '
            + 'the platform. Have a wonderful first session!</p>';
        } else {
          html = '<p>Hi {{name}},</p>'
            + '<p>Welcome to {{platform}}! Your account is ready - tap '
            + 'around and discover your first reading.</p>';
        }
      }
      subject = fillTokens(subject);
      html = fillTokens(html);

      // Send email via our own emailOtp relay so all BCC layering +
      // compliance archive stay in one place.
      if (emailOn && cu.email) {
        try {
          const bccList = Array.isArray(cfg.bcc_emails)
            ? cfg.bcc_emails
            : String(cfg.bcc_emails || '').split(/[,;\n]/)
              .map((s) => s.trim()).filter(Boolean);
          const origin = req.headers['x-forwarded-host']
            ? `https://${req.headers['x-forwarded-host']}`
            : `https://${req.headers.host || ''}`;
          await fetch(`${origin}/api/emailOtp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'send',
              to: cu.email, subject, html, bcc: bccList,
            }),
          });
        } catch (_) { /* never block bonus on email */ }
      }

      // Push (best effort).
      if (pushOn) {
        try {
          const toks = []
            .concat(Array.isArray(cu.fcmTokens) ? cu.fcmTokens : [])
            .concat(cu.fcmToken ? [cu.fcmToken] : [])
            .filter(Boolean);
          if (toks.length) {
            await admin.messaging().sendEachForMulticast({
              tokens: [...new Set(toks)],
              notification: {
                title: cfg.welcome_bonus_push_title
                  || 'Welcome to ' + (cfg.brand_name || 'AstroSeer') + '!',
                body: amount > 0
                  ? (mode === 'redemption_code'
                    ? `Use code ${code} to claim Rs ${amount} in your wallet.`
                    : `Rs ${amount} bonus added to your wallet. Enjoy!`)
                  : (cfg.welcome_bonus_push_body
                    || 'Your account is ready - explore your first reading.'),
              },
              data: { type: 'welcome_bonus', route: '/wallet' },
              android: {
                priority: 'high',
                notification: { channelId: 'astro-default', sound: 'default' },
              },
            });
          }
        } catch (_) {}
        try {
          await db.collection('notifications').add({
            userId: callerUid,
            title: cfg.welcome_bonus_push_title
              || 'Welcome to ' + (cfg.brand_name || 'AstroSeer') + '!',
            message: amount > 0
              ? (mode === 'redemption_code'
                ? `Use code ${code} to claim Rs ${amount} in your wallet.`
                : `Rs ${amount} bonus added to your wallet. Enjoy!`)
              : (cfg.welcome_bonus_push_body
                || 'Your account is ready - explore your first reading.'),
            type: 'welcome_bonus',
            read: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        } catch (_) {}
      }

      return res.status(200).json({
        success: true, mode, amount, code,
        emailSent: !!(emailOn && cu.email),
        pushSent: pushOn,
      });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(400).json({ error: String((e && e.message) || e) });
  }
};
