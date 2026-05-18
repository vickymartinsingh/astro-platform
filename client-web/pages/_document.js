import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* Apply the cached theme colours SYNCHRONOUSLY before the
            first paint, so a reload never flashes the old/default
            colour for a frame. */}
        <script
          dangerouslySetInnerHTML={{
            __html: 'try{var c=window.localStorage.getItem('
              + "'appThemeVars');if(c){var v=JSON.parse(c);"
              + 'var r=document.documentElement.style;'
              + 'for(var k in v){if(Object.prototype.hasOwnProperty'
              + '.call(v,k)){r.setProperty(k,v[k]);}}}}catch(e){}',
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
