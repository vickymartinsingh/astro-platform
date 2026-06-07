import React from 'react';
import { APP_BUILD } from '@astro/shared';

// User-facing crash fallback. The OLD version (pre-2026-06-07) dumped
// the raw stack in red full-screen which terrified users and made the
// app look broken on every minor exception (operator screenshot:
// "ReferenceError: FireStatus is not defined" filled the whole admin
// panel). The new version shows:
//   - calm white/maroon card centred on screen
//   - friendly headline + one-line explanation
//   - primary "Reload" CTA
//   - secondary "Go to home" link
//   - collapsed "Show technical details" disclosure that holds the
//     full diagnostic + Copy button (still there for support tickets)
//
// We also catch window.error + unhandledrejection (iOS WKWebView has
// no JS console) so a promise that throws outside React's render path
// still shows the friendly card instead of a frozen white screen.
//
// PROD-only by default - in dev (NODE_ENV !== 'production') we still
// surface errors so they don't get hidden during local work, but we
// route them through the same friendly card so the experience is
// identical (no surprise rough fallback in dev that shipped users
// never see).
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null, info: null, copied: false, open: false };
  }

  static getDerivedStateFromError(err) {
    return { err };
  }

  componentDidCatch(err, info) {
    this.setState({ err, info });
    try { localStorage.setItem('lastDiag', this.text(err, info)); }
    catch (_) { /* ignore */ }
  }

  componentDidMount() {
    if (typeof window === 'undefined') return;
    const grab = (e, kind) => {
      if (this.state.err) return;
      const r = (e && (e.reason !== undefined ? e.reason : e.error))
        || e;
      const fake = {
        message: (r && r.message)
          || (e && e.message) || `${kind}: ${String(r)}`,
        stack: (r && r.stack) || '',
      };
      this.setState({ err: fake, info: null });
      try { localStorage.setItem('lastDiag', this.text(fake, null)); }
      catch (_) { /* ignore */ }
    };
    window.addEventListener('unhandledrejection',
      (e) => grab(e, 'UnhandledRejection'));
    window.addEventListener('error', (e) => {
      const m = (e && e.message) || '';
      // Opaque "Script error." carries nothing - don't hijack the app
      // for it (it is usually benign cross-origin noise on iOS).
      if (!m || /^Script error/.test(String(m))) return;
      // ResizeObserver loop spam is benign browser noise; ignore.
      if (/ResizeObserver loop/.test(String(m))) return;
      grab(e, 'WindowError');
    });
  }

  // eslint-disable-next-line class-methods-use-this
  text(err, info) {
    let msg = '';
    try { msg = (err && err.message) ? err.message : String(err); }
    catch (_) { msg = 'Unknown error'; }
    let asStr = '';
    try { asStr = String(err); } catch (_) { asStr = ''; }
    const stack = (err && err.stack) || '';
    const comp = (info && info.componentStack) || '';
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent)
      || '';
    const url = (typeof window !== 'undefined' && window.location
      && window.location.href) || '';
    return `BUILD: b${APP_BUILD}\nURL: ${url}\nUA: ${ua}`
      + `\n\nMESSAGE:\n${msg}\n\nTOSTRING:\n${asStr}`
      + `\n\nSTACK:\n${stack}`
      + (comp ? `\n\nCOMPONENT STACK:\n${comp}` : '');
  }

  render() {
    const { err, info, copied, open } = this.state;
    if (!err) return this.props.children;
    const text = this.text(err, info);
    const copy = () => {
      try {
        navigator.clipboard.writeText(text)
          .then(() => this.setState({ copied: true }))
          .catch(() => this.setState({ copied: true }));
      } catch (_) { this.setState({ copied: true }); }
    };
    const goHome = () => {
      try { window.location.href = '/'; }
      catch (_) { window.location.reload(); }
    };
    const reload = () => {
      try { window.location.reload(); } catch (_) { /* tolerate */ }
    };
    // Friendly fallback. White background, soft maroon ring, calm
    // type. No raw stack visible by default - it's behind the disclosure.
    return (
      <div
        style={{
          position: 'fixed', inset: 0, background: '#FAF7F2',
          overflow: 'auto', zIndex: 2147483647,
          display: 'flex', alignItems: 'flex-start',
          justifyContent: 'center',
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 56px)',
          paddingLeft: 16, paddingRight: 16, paddingBottom: 24,
          font: '14px/1.5 -apple-system, BlinkMacSystemFont, Segoe UI, '
            + 'Roboto, sans-serif',
          color: '#2A1A1A',
        }}
      >
        <div style={{
          width: '100%', maxWidth: 480, background: '#fff',
          borderRadius: 18, padding: '28px 22px',
          boxShadow: '0 6px 24px rgba(127, 32, 32, 0.10)',
          border: '1px solid #F0E4D8',
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: '#FFF1E6', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 14px', fontSize: 28,
          }} aria-hidden>
            <span style={{ color: '#7F2020' }}>!</span>
          </div>
          <h1 style={{
            margin: '0 0 6px', textAlign: 'center', fontSize: 19,
            fontWeight: 700, color: '#2A1A1A',
          }}>
            Something went wrong
          </h1>
          <p style={{
            margin: '0 0 18px', textAlign: 'center', color: '#5C4A4A',
            fontSize: 13,
          }}>
            We hit a snag loading this screen. Reloading usually fixes
            it. If it keeps happening, copy the details below and send
            them to support.
          </p>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <button type="button" onClick={reload} style={{
              flex: 1, padding: '12px 18px', fontSize: 14,
              fontWeight: 700, background: '#7F2020', color: '#fff',
              border: 0, borderRadius: 999, cursor: 'pointer',
            }}>
              Reload
            </button>
            <button type="button" onClick={goHome} style={{
              flex: 1, padding: '12px 18px', fontSize: 14,
              fontWeight: 700, background: '#fff', color: '#7F2020',
              border: '1px solid #7F2020', borderRadius: 999,
              cursor: 'pointer',
            }}>
              Go to home
            </button>
          </div>
          <button type="button"
            onClick={() => this.setState({ open: !open })}
            style={{
              width: '100%', padding: '10px 14px', fontSize: 12,
              fontWeight: 600, color: '#7F2020', background: '#FFF5EC',
              border: '1px solid #F0E4D8', borderRadius: 10,
              cursor: 'pointer',
            }}>
            {open ? 'Hide technical details' : 'Show technical details'}
          </button>
          {open && (
            <div style={{ marginTop: 12 }}>
              <button type="button" onClick={copy} style={{
                padding: '8px 14px', fontSize: 12, fontWeight: 700,
                background: '#7F2020', color: '#fff', border: 0,
                borderRadius: 8, cursor: 'pointer',
                marginBottom: 10,
              }}>
                {copied ? 'Copied' : 'Copy error details'}
              </button>
              <pre style={{
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                margin: 0, padding: 12, background: '#FAF7F2',
                borderRadius: 10, border: '1px solid #F0E4D8',
                color: '#5C4A4A', font: '11px/1.45 ui-monospace, '
                  + 'SFMono-Regular, Menlo, monospace',
                maxHeight: 260, overflow: 'auto',
                userSelect: 'text', WebkitUserSelect: 'text',
              }}>
                {text}
              </pre>
            </div>
          )}
          <p style={{
            margin: '14px 0 0', textAlign: 'center', color: '#9C8B8B',
            fontSize: 11,
          }}>
            Build b{APP_BUILD}
          </p>
        </div>
      </div>
    );
  }
}
