import { Html, Head, Main, NextScript } from 'next/document';
import { APP_BUILD } from '@astro/shared';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__APPB=${APP_BUILD};(function(){`
              + 'function add(){try{if(document.getElementById('
              + "'__b'))return;var b=document.body;if(!b){return;}"
              + "var d=document.createElement('div');d.id='__b';"
              + "d.textContent='b'+window.__APPB;d.style.cssText="
              + "'position:fixed;left:3px;bottom:3px;font:10px "
              + 'monospace;color:#888;background:rgba(255,255,255,.6);'
              + "padding:1px 4px;border-radius:4px;z-index:2147483646;"
              + "pointer-events:none';b.appendChild(d);}catch(e){}}"
              + "if(document.readyState!=='loading'){add();}else{"
              + "document.addEventListener('DOMContentLoaded',add);}"
              + 'setTimeout(add,1500);})();',
          }}
        />
        {/* Show only REAL errors; ignore iOS WKWebView's opaque
            "Script error." / benign noise. Real React crashes ->
            ErrorBoundary (full detail). */}
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
        <meta name="theme-color" content="#6C2BD9" />
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
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
