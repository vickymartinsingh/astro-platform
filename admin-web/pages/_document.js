import { Html, Head, Main, NextScript } from 'next/document';

// Global error handler injected on every admin page. Special-cases
// Firestore quota errors with a friendly banner instead of the raw
// "Unhandled promise: FirebaseError: Quota exceeded." stack trace.
// Built via template literal so quote escaping stays readable.
function adminErrorHandler() {
  const friendlyQuotaHtml = '<div style="max-width:640px;margin:60px '
    + 'auto;text-align:center;color:#7F2020;font-family:system-ui,'
    + 'Inter,Arial,sans-serif"><div style="font-size:22px;'
    + 'font-weight:700;margin-bottom:12px">Firebase daily quota '
    + 'reached</div><div style="color:#444;line-height:1.6">'
    + 'The admin panel uses Firestore for every read. We have hit '
    + 'the Spark plan daily cap of 50,000 reads. The quota resets '
    + 'at <b>midnight Pacific (about 1:30 PM IST)</b>.<br/><br/>'
    + 'Real-time data will resume automatically at that time. The '
    + 'customer-facing app continues to work via the Firestore-free '
    + 'rescue path.</div><div style="margin-top:24px;font-size:11px;'
    + 'color:#999">If you need this resolved sooner, enable Firebase '
    + 'Blaze plan ($0 at your scale; the daily cap goes away).</div>'
    + '</div>';
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
        {/* Show only REAL errors; ignore iOS WKWebView's opaque
            "Script error." / benign noise. Real React crashes ->
            ErrorBoundary (full detail). */}
        <script
          dangerouslySetInnerHTML={{ __html: adminErrorHandler() }}
        />
        {/* Apply theme colours SYNCHRONOUSLY before the first paint
            so the UI never flashes the old PURPLE for a single frame
            (settings/theme.active = "royal" = maroon / amber / olive
            today). Cold-cache visitors paint on-theme on frame #1;
            returning visitors have their localStorage cached palette
            overlaid for instant custom-theme support.
            STAYS IN LOCKSTEP WITH ADMIN-THEMES - if the active theme
            switches, update the d={...} block and redeploy. */}
        <script
          dangerouslySetInnerHTML={{
            // KEEP IN LOCKSTEP with admin-web/styles/globals.css.
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
        <meta name="theme-color" content="#1A0F0F" />
        <link rel="icon" type="image/png" href="/favicon.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta property="og:image" content="/og.png" />
        <meta property="og:title" content="AstroSeer Admin" />
        <meta name="twitter:card" content="summary_large_image" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </Head>
      <body>
        {/* Pre-hydration brand cover - kills the reload flash of any
            stale cached UI. Removed once React renders; 4s failsafe. */}
        <div id="__boot" style={{
          position: 'fixed', inset: 0, zIndex: 2147483646,
          background: '#1A0F0F', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          transition: 'opacity .25s ease',
        }}>
          <img src="/logo.png" alt="AstroSeer Admin"
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
        {/* Native iOS splash kill switch.
            The Capacitor splash plugin owns a UIView painted on top of
            the WKWebView; React + the __boot cover above only live
            INSIDE the WKWebView. If anything in the JS bundle throws
            during boot (rare, but it has happened in production), the
            splash stays forever because nothing calls
            SplashScreen.hide(). This inline script runs BEFORE any
            React module loads and forcibly hides the native splash:
              - at t=400ms (as soon as the WKWebView paints anything)
              - again at t=1500ms (insurance)
              - again at t=4000ms (paranoid)
            Three separate calls, all wrapped in try so a missing
            Capacitor object just no-ops. On the web build this is a
            harmless no-op (window.Capacitor is undefined). */}
        <script
          dangerouslySetInnerHTML={{
            __html: '(function(){function hide(){try{var C=window.'
              + 'Capacitor;if(!C||!C.Plugins||!C.Plugins.SplashScreen)'
              + 'return;C.Plugins.SplashScreen.hide({fadeOutDuration'
              + ':200});}catch(e){}}'
              + 'setTimeout(hide,400);setTimeout(hide,1500);'
              + 'setTimeout(hide,4000);})();',
          }}
        />
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
