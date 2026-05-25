import { Html, Head, Main, NextScript } from 'next/document';

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
            __html: "(function(){function bad(m){if(!m)return true;"
              + 'var s=String(m).trim();return s===""||s==='
              + '"Script error."||s==="Script error"||'
              + '/^ResizeObserver/.test(s);}function show(m){try{var b='
              + 'document.body||document.documentElement;var d='
              + "document.getElementById('__bootErr');if(!d){d="
              + "document.createElement('pre');d.id='__bootErr';"
              + "d.style.cssText='position:fixed;left:0;top:0;right:0;"
              + 'bottom:0;margin:0;padding:14px;background:#fff;'
              + 'color:#b00020;font:12px/1.45 monospace;white-space:'
              + 'pre-wrap;word-break:break-word;overflow:auto;z-index:'
              + "2147483647';b.appendChild(d);}d.textContent='APP ERROR"
              + " (screenshot this):\\n\\n'+m;}catch(e){}}"
              + "window.addEventListener('error',function(e){var m=(e&&"
              + 'e.error&&(e.error.stack||e.error.message))||(e&&'
              + "e.message)||'';if(bad(m))return;show(m);});window."
              + "addEventListener('unhandledrejection',function(e){"
              + 'var r=e&&e.reason;var m=(r&&(r.stack||r.message))||'
              + "'';if(bad(m))return;show('Unhandled promise:\\n'+m);"
              + '});})();',
          }}
        />
        {/* Apply theme colours SYNCHRONOUSLY before the first paint
            so the UI never flashes the old/default colour for a frame.
            Strategy:
            1. Seed the CSS variables with the CURRENT default ("classic"
               purple) inline. This guarantees that a cold cache (first
               install, cleared storage, incognito) paints on-theme on
               the very first frame instead of falling back to whatever
               browser defaults the stylesheet declared months ago.
            2. THEN overlay any cached `appThemeVars2` from localStorage
               so a returning visitor sees the exact theme they last
               had (admin-changed custom theme, etc.) without waiting
               for the Firestore live-snapshot. */}
        <script
          dangerouslySetInnerHTML={{
            __html: '(function(){var r=document.documentElement.style;'
              + 'var d={"--c-primary":"108 43 217",'
              + '"--c-bglight":"243 238 255","--grad-a":"#6C2BD9",'
              + '"--grad-b":"#8B5CF6","--c-accent":"219 39 119",'
              + '"--c-success":"27 107 47","--c-warning":"230 126 34",'
              + '"--c-danger":"192 57 43","--c-verify":"127 32 32",'
              + '"--c-tarot":"#0F0A23","--c-tarot2":"#2A1A63"};'
              + 'for(var k in d){r.setProperty(k,d[k]);}'
              + "try{var c=window.localStorage.getItem('appThemeVars2');"
              + 'if(c){var v=JSON.parse(c);for(var k2 in v){'
              + 'if(Object.prototype.hasOwnProperty.call(v,k2)){'
              + 'r.setProperty(k2,v[k2]);}}}}catch(e){}})();',
          }}
        />
        <meta name="theme-color" content="#0F0A23" />
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
        {/* Pre-hydration brand cover: opaque, on-theme (#0F0A23) with
            the bundled logo, painted on the FIRST frame so the old
            cached UI / colours can never flash during the reload
            window. Removed once React has rendered (SplashScreen then
            takes over seamlessly); hard 4s failsafe so it can never
            get stuck even if the bundle fails. */}
        <div id="__boot" style={{
          position: 'fixed', inset: 0, zIndex: 2147483646,
          background: '#0F0A23', display: 'flex',
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
