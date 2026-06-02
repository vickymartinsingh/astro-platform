import { kundliService } from '@astro/shared';

// In-app PDF preview. Renders the PDF in an iframe (web + WebView)
// with a sticky toolbar carrying the file name on the left, a
// download icon on the right and the close X. The download icon
// triggers the same downloadPdfFromUrl path the inline buttons use
// (handles data: URLs, Capacitor file save, web blob fallback) so
// the customer never needs to right-click + Save-as.
//
// Used by /orders and /kundli to give the customer a consistent
// "tap to preview" experience instead of dumping them into a
// Chrome PDF viewer on a separate tab.
export default function PdfPreviewModal({ url, name, onClose }) {
  function isNative() {
    return typeof window !== 'undefined'
      && !!window.Capacitor
      && typeof window.Capacitor.isNativePlatform === 'function'
      && window.Capacitor.isNativePlatform();
  }
  function handleDownload() {
    kundliService.downloadPdfFromUrl(url,
      name || 'AstroSeer-Kundli.pdf');
  }
  function handleOpenExternal() {
    try { window.open(url, '_system'); }
    catch (_) {
      try { window.open(url, '_blank'); } catch (e) { /* */ }
    }
  }
  if (!url) return null;
  return (
    <div className="fixed inset-0 z-[2147483647] flex flex-col
      bg-black/85"
      role="dialog" aria-modal="true">
      {/* Toolbar */}
      <div className="flex items-center gap-2 bg-primary px-3 py-2
        text-white shadow-md"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)',
        }}>
        <button type="button" onClick={onClose} aria-label="Close"
          className="grid h-9 w-9 place-items-center rounded-full
            bg-white/15 text-lg font-bold hover:bg-white/25">
          ×
        </button>
        <div className="min-w-0 flex-1 truncate text-sm font-bold">
          {name || 'AstroSeer Kundli PDF'}
        </div>
        {isNative() && (
          <button type="button" onClick={handleOpenExternal}
            aria-label="Open in browser"
            className="hidden h-9 items-center gap-1.5 rounded-full
              bg-white/15 px-3 text-xs font-bold hover:bg-white/25
              sm:flex">
            Open
          </button>
        )}
        {/* Download icon (top-right corner per spec). 24x24 download
            glyph + screen-reader label. Doubles up with a textual
            "Download" on wider screens for clarity. */}
        <button type="button" onClick={handleDownload}
          aria-label="Download PDF"
          className="flex h-9 items-center gap-1.5 rounded-full
            bg-white px-3 text-xs font-bold text-primary
            hover:bg-white/90">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.4"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span className="hidden sm:inline">Download</span>
        </button>
      </div>
      {/* Document */}
      <div className="flex-1 overflow-hidden bg-white">
        <iframe src={url} title={name || 'AstroSeer Kundli PDF'}
          className="h-full w-full border-0"
          style={{ minHeight: '70vh' }} />
      </div>
    </div>
  );
}
