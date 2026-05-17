/** @type {import('tailwindcss').Config} */
// Colours mirror shared/theme.js (blueprint 10.2 / 14.2).
module.exports = {
  content: [
    './pages/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#6C2BD9',
        // Astrotalk-style warm yellow accent (used for the bottom tab
        // bar, primary CTAs and the in-chat system bubbles).
        brand: '#F7B500',
        'brand-dark': '#E0A200',
        'brand-soft': '#FFF6DC',
        'bg-light': '#F3EEFF',
        'accent-blue': '#EAF4FF',
        success: '#1B6B2F',
        danger: '#C0392B',
        warning: '#E67E22',
        gold: '#B8860B',
        'dark-text': '#1A1A2E',
        'sub-text': '#555555',
        'bg-gray': '#F5F5F5',
        // WhatsApp/Astrotalk chat palette.
        'chat-canvas': '#ECE3D9',
        'chat-user': '#FBF3DC',
        'chat-astro': '#FFFFFF',
        'chat-sys': '#EFE7DA',
        'chat-yellow': '#F2E27C',
        'call-bg': '#0A0A0A',
      },
      borderRadius: { card: '14px' },
      fontFamily: { sans: ['Inter', 'Arial', 'sans-serif'] },
    },
  },
  plugins: [],
};
