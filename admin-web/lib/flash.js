// Tiny global "it worked" notifier for the admin panel. Any page can
// call flash('Saved') and a centred confirmation popup appears.
export function flash(message, kind = 'success') {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('admin-flash', {
    detail: { message: String(message || 'Done'), kind },
  }));
}
