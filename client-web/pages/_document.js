import { Html, Head, Main, NextScript } from 'next/document';

// Global error handler injected at the very top of every page. Catches
// uncaught exceptions + unhandled promise rejections that escape React
// and would otherwise show as a blank screen. Special-cases Firestore
// quota errors with a friendly customer-facing banner. We build the
// inline script via a tagged template so the quote escaping stays
// readable (the previous '+'-concatenation form broke on a misplaced
// semicolon - this avoids that whole class of bug).
function clientErrorHandler() {
  // The raw JS body to inject. Browser executes this synchronously at
  // page load BEFORE React mounts, so it catches early Firebase init
  // errors that would crash the app entirely.
  const friendlyQuotaHtml = '<div style="max-width:480px;margin:80px '
    + 'auto;text-align:center;color:#7F2020;font-family:system-ui,'
    + 'Inter,Arial,sans-serif"><div style="font-size:20px;'
    + 'font-weight:700;margin-bottom:12px">We are at our daily limit'
    + '</div><div style="color:#444;line-height:1.6">'
    + 'Our system has hit the daily request limit. New orders may '
    + 'not go through, but kundli reports you already created will '
    + 'still open from cache.<br/><br/>This resets in a few hours. '
    + 'Please try again later.</div></div>';
  // Encode the HTML payload as JSON so we can safely embed it inside
  // the script string without further escaping worries.
  const html = JSON.stringify(friendlyQuotaHtml);
  return `(function(){
    function bad(m){
      if(!m) return true;
      var s = String(m).trim();
      return s === '' || s === 'Script error.' || s === 'Script error'
        || /^ResizeObserver/.test(s);
    }
    function isQuota(m){
      var s = String(m||'');
      return /RESOURCE_EXHAUSTED|Quota exceeded|FirebaseError:[^\\n]*[Qq]uota/.test(s);
    }
    function show(m){
      try{
        var b = document.body || document.documentElement;
        var d = document.getElementById('__bootErr');
        if(!d){
          d = document.createElement('div');
          d.id = '__bootErr';
          d.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;margin:0;padding:20px;background:#fff;overflow:auto;z-index:2147483647';
          b.appendChild(d);
        }
        if(isQuota(m)){
          d.innerHTML = ${html};
          return;
        }
        d.style.cssText += ';padding:14px;color:#b00020;font:12px/1.45 monospace;white-space:pre-wrap;word-break:break-word';
        d.textContent = 'APP ERROR (screenshot this):\\n\\n' + m;
      }catch(e){}
    }
    window.addEventListener('error', function(e){
      var m = (e && e.error && (e.error.stack || e.error.message)) || (e && e.message) || '';
      if(bad(m)) return;
      show(m);
    });
    window.addEventListener('unhandledrejection', function(e){
      var r = e && e.reason;
      var m = (r && (r.stack || r.message)) || '';
      if(bad(m)) return;
      show('Unhandled promise:\\n' + m);
    });
  })();`;
}

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* Google Search Console domain ownership (OAuth branding). */}
        <meta name="google-site-verification"
          content="9-tzi_FQP7YVVr9GeXiErEp1dnW0ENNg_m4sdlq2bI8" />
        {/* Surface only REAL, actionable startup errors. iOS WKWebView
            sanitises every cross-origin / benign script error to the
            opaque "Script error." - showing a full-screen overlay for
            those (fonts, analytics, ResizeObserver, etc.) made a working
            app look crashed. Genuine React crashes are still caught with
            full detail by the ErrorBoundary. */}
        <script
          dangerouslySetInnerHTML={{
            __html: clientErrorHandler(),
          }}
        />
        {/* Apply theme colours SYNCHRONOUSLY before the first paint
            so the UI never flashes the old PURPLE for a single frame.
            Strategy:
            1. Seed the CSS variables with the CURRENTLY-ACTIVE theme
               in settings/theme.active = "royal" (maroon / amber /
               olive). A cold cache (first install, cleared storage,
               incognito) now paints on-theme on the very first frame.
               THESE VALUES MUST STAY IN LOCKSTEP WITH THE LIVE THEME - if you switch the active theme in admin-themes,
               update the d={...} block below and redeploy, otherwise
               first-paint flashes the previous palette until the
               localStorage override kicks in.
            2. THEN overlay any cached `appThemeVars2` from localStorage
               so a returning visitor sees the exact theme they last
               had (admin-changed custom theme, etc.) without waiting
               for the Firestore live-snapshot. */}
        <script
          dangerouslySetInnerHTML={{
            // KEEP IN LOCKSTEP with client-web/styles/globals.css.
            // Pre-hydration seed must equal the live :root vars or the
            // very first paint flashes a wrong colour (orange / amber
            // on the gradient buttons in particular).
            __html: '(function(){var r=document.documentElement.style;'
              + 'var d={"--c-primary":"127 32 32",'
              + '"--c-bglight":"251 247 238","--grad-a":"#D4A12A",'
              + '"--grad-b":"#7F2020","--c-accent":"180 83 9",'
              + '"--c-success":"90 110 50","--c-warning":"212 161 42",'
              + '"--c-danger":"192 57 43","--c-verify":"127 32 32",'
              + '"--c-tarot":"#2A1408","--c-tarot2":"#4A2410"};'
              + 'for(var k in d){r.setProperty(k,d[k]);}'
              + "try{var c=window.localStorage.getItem('appThemeVars2');"
              + 'if(c){var v=JSON.parse(c);for(var k2 in v){'
              + 'if(Object.prototype.hasOwnProperty.call(v,k2)){'
              + 'r.setProperty(k2,v[k2]);}}}}catch(e){}})();',
          }}
        />
        {/* Status-bar tint matches the dark maroon-tinted brand cover. */}
        <meta name="theme-color" content="#1A0F0F" />
        <link rel="icon" type="image/png" href="/favicon.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta property="og:image" content="/og.png" />
        <meta property="og:title" content="AstroSeer" />
        <meta name="twitter:card" content="summary_large_image" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </Head>
      <body>
        {/* Pre-hydration brand cover: opaque, on-theme dark maroon
            (#1A0F0F) with the bundled logo, painted on the FIRST
            frame so the old cached UI / purple colour can never flash
            during the reload window. Removed once React has rendered
            (SplashScreen then takes over seamlessly); hard 4s failsafe
            so it can never get stuck even if the bundle fails. */}
        <div id="__boot" style={{
          position: 'fixed', inset: 0, zIndex: 2147483646,
          background: '#1A0F0F', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          transition: 'opacity .25s ease',
        }}>
          <img src="/logo.png" alt="AstroSeer"
            style={{ maxWidth: '62%', maxHeight: '46vh',
              objectFit: 'contain' }} />
        </div>
        <script
          dangerouslySetInnerHTML={{
            __html: '(function(){var s=Date.now();function done(){'
              + "var b=document.getElementById('__boot');if(!b)return;"
              + "b.style.opacity='0';setTimeout(function(){if(b&&b."
              + 'parentNode){b.parentNode.removeChild(b);}},300);}'
              + 'function poll(){var n=document.getElementById('
              + "'__next');var ready=n&&n.children&&n.children.length"
              + '>0;if(ready&&Date.now()-s>300){done();return;}'
              + 'if(Date.now()-s>4000){done();return;}'
              + 'requestAnimationFrame(poll);}'
              + 'requestAnimationFrame(poll);})();',
          }}
        />
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
