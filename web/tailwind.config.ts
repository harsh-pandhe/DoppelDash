import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#e8f1fb',
          100: '#c5d9f5',
          200: '#9fc0ee',
          300: '#75a5e7',
          400: '#5090e1',
          500: '#0057A8',
          600: '#004d97',
          700: '#003B73',
          800: '#002a54',
          900: '#001a35',
        },
        accent: {
          100: '#fde3d6',
          400: '#ff7a3d',
          500: '#E8571A',
          600: '#cc4910',
        },
        surface: {
          DEFAULT: '#f0f4ff',
          card:    '#FFFFFF',
          border:  '#E4E8EF',
          muted:   '#8A93A6',
        },
      },
      backgroundImage: {
        'brand-gradient':      'linear-gradient(160deg, #003B73 0%, #0057A8 50%, #1a7cc9 100%)',
        'brand-gradient-dark': 'linear-gradient(160deg, #001a35 0%, #003B73 60%, #0057A8 100%)',
        'mesh-blue':
          'radial-gradient(ellipse 80% 60% at 15% 5%,  rgba(0,87,168,0.10) 0%, transparent 65%),' +
          'radial-gradient(ellipse 60% 50% at 85% 85%,  rgba(99,102,241,0.09) 0%, transparent 65%),' +
          'radial-gradient(ellipse 40% 40% at 55% 40%,  rgba(232,87,26,0.05) 0%, transparent 55%)',
      },
      boxShadow: {
        'glass':      '0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,87,168,0.07)',
        'glass-lg':   '0 2px 8px rgba(0,0,0,0.06), 0 12px 32px rgba(0,87,168,0.12)',
        'card':       '0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.06)',
        'card-hover': '0 4px 16px rgba(0,87,168,0.12)',
      },
      animation: {
        'fade-up':      'fadeUp 0.4s ease both',
        'fade-in':      'fadeIn 0.3s ease both',
        'scale-in':     'scaleIn 0.2s ease both',
        'slide-down':   'slideDown 0.25s ease both',
        'fade-up-1':    'fadeUp 0.4s 0.05s ease both',
        'fade-up-2':    'fadeUp 0.4s 0.10s ease both',
        'fade-up-3':    'fadeUp 0.4s 0.15s ease both',
        'fade-up-4':    'fadeUp 0.4s 0.20s ease both',
      },
      keyframes: {
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(14px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        scaleIn: {
          from: { opacity: '0', transform: 'scale(0.95)' },
          to:   { opacity: '1', transform: 'scale(1)' },
        },
        slideDown: {
          from: { opacity: '0', transform: 'translateY(-8px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
export default config
