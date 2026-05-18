import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <script
          dangerouslySetInnerHTML={{
            __html: "(function(){function show(m){try{var b="
              + 'document.body||document.documentElement;var d='
              + "document.getElementById('__bootErr');if(!d){d="
              + "document.createElement('pre');d.id='__bootErr';"
              + "d.style.cssText='position:fixed;left:0;top:0;right:0;"
              + 'bottom:0;margin:0;padding:14px;background:#fff;'
              + 'color:#b00020;font:12px/1.45 monospace;white-space:'
              + 'pre-wrap;word-break:break-word;overflow:auto;z-index:'
              + "2147483647';b.appendChild(d);}d.textContent='APP ERROR"
              + " (screenshot this):\\n\\n'+m;}catch(e){}}"
              + "window.addEventListener('error',function(e){show((e&&"
              + 'e.error&&(e.error.stack||e.error.message))||(e&&'
              + "e.message)||'Script error');});window."
              + "addEventListener('unhandledrejection',function(e){"
              + "var r=e&&e.reason;show('Unhandled promise:\\n'+((r&&"
              + '(r.stack||r.message))||String(r)));});})();',
          }}
        />
        <meta name="theme-color" content="#6C2BD9" />
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
