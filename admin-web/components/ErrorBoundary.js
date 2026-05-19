import React from 'react';
import { APP_BUILD } from '@astro/shared';

// Renders the actual React error on screen (iOS WKWebView has no
// console). IMPORTANT: WebKit's error.stack does NOT contain the
// message (unlike V8), so we must show message + String(err) + stack
// separately, and pad for the iOS status bar / notch.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null, info: null };
  }

  static getDerivedStateFromError(err) {
    return { err };
  }

  componentDidCatch(err, info) {
    this.setState({ err, info });
  }

  render() {
    const { err, info } = this.state;
    if (!err) return this.props.children;
    let msg = '';
    try { msg = (err && err.message) ? err.message : String(err); }
    catch (_) { msg = 'Unknown error'; }
    let asStr = '';
    try { asStr = String(err); } catch (_) { asStr = ''; }
    const stack = (err && err.stack) || '';
    const comp = (info && info.componentStack) || '';
    const text = `MESSAGE:\n${msg}\n\nTOSTRING:\n${asStr}`
      + `\n\nSTACK:\n${stack}`
      + (comp ? `\n\nCOMPONENT STACK:\n${comp}` : '');
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
          APP ERROR - build b{APP_BUILD} (screenshot this whole screen)
        </div>
        <pre
          style={{
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0,
          }}
        >
          {text}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{ marginTop: 14, padding: '8px 16px' }}
        >
          Reload
        </button>
      </div>
    );
  }
}
