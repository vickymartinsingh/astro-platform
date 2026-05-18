import React from 'react';

// Renders the actual React error on screen (iOS WKWebView has no
// console). Catches render/commit errors - that is exactly what Next's
// generic "client-side exception" message hides.
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
    const txt = (err && (err.stack || err.message)) || String(err);
    const comp = (info && info.componentStack) || '';
    return (
      <div
        style={{
          position: 'fixed', inset: 0, background: '#fff',
          color: '#b00020', padding: 14, overflow: 'auto',
          font: '12px/1.45 monospace', whiteSpace: 'pre-wrap',
          wordBreak: 'break-word', zIndex: 2147483647,
        }}
      >
        <div style={{ fontWeight: 'bold', marginBottom: 8 }}>
          APP ERROR (please screenshot this)
        </div>
        {txt}
        {comp ? `\n\n--- component stack ---${comp}` : ''}
        <div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ marginTop: 14, padding: '8px 16px' }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
