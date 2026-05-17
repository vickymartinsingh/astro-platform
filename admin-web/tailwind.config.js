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
        primary: 'rgb(var(--c-primary) / <alpha-value>)',
        'bg-light': 'rgb(var(--c-bglight) / <alpha-value>)',
        'accent-blue': '#EAF4FF',
        success: 'rgb(var(--c-success) / <alpha-value>)',
        accent: 'rgb(var(--c-accent) / <alpha-value>)',
        danger: 'rgb(var(--c-danger) / <alpha-value>)',
        warning: 'rgb(var(--c-warning) / <alpha-value>)',
        gold: '#B8860B',
        'dark-text': '#1A1A2E',
        'sub-text': '#555555',
        'bg-gray': '#F5F5F5',
        'chat-user': '#DCF8C6',
        'chat-astro': '#EEEEEE',
        'call-bg': '#0A0A0A',
      },
      borderRadius: { card: '14px' },
      fontFamily: { sans: ['Inter', 'Arial', 'sans-serif'] },
    },
  },
  plugins: [],
};
