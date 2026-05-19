import React from 'react';
import { APP_BUILD } from '@astro/shared';

// Shows the real React error on screen (iOS WKWebView has no console).
// WebKit's error.stack omits the message, so we show message + String
// + stack separately, add the build + user-agent, and a COPY button so
// the exact text can be pasted back (more reliable than a photo). Also
// catches window errors / unhandled promise rejections (the reason of
// a rejection is NOT sanitised by iOS, so it carries the real cause).
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null, info: null, copied: false };
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
    return `BUILD: b${APP_BUILD}\nUA: ${ua}\n\nMESSAGE:\n${msg}`
      + `\n\nTOSTRING:\n${asStr}\n\nSTACK:\n${stack}`
      + (comp ? `\n\nCOMPONENT STACK:\n${comp}` : '');
  }

  render() {
    const { err, info, copied } = this.state;
    if (!err) return this.props.children;
    const text = this.text(err, info);
    const copy = () => {
      try {
        navigator.clipboard.writeText(text)
          .then(() => this.setState({ copied: true }))
          .catch(() => this.setState({ copied: true }));
      } catch (_) { this.setState({ copied: true }); }
    };
    return (
      <div
        style={{
          position: 'fixed', inset: 0, background: '#fff',
          color: '#b00020', overflow: 'auto', zIndex: 2147483647,
          padding: '14px',
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 54px)',
          font: '12px/1.45 -apple-system, monospace',
        }}
      >
        <div style={{ fontWeight: 'bold', marginBottom: 8 }}>
          APP ERROR - build b{APP_BUILD}
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <button type="button" onClick={copy}
            style={{
              padding: '10px 18px', fontWeight: 'bold',
              background: '#b00020', color: '#fff', border: 0,
              borderRadius: 8,
            }}>
            {copied ? 'Copied - paste it to support' : 'Copy error'}
          </button>
          <button type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 18px', border: '1px solid #b00020',
              borderRadius: 8, background: '#fff', color: '#b00020',
            }}>
            Reload
          </button>
        </div>
        <pre
          style={{
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0,
            userSelect: 'text', WebkitUserSelect: 'text',
          }}
        >
          {text}
        </pre>
      </div>
    );
  }
}
