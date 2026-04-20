/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#e8f1fb',
          100: '#c5d9f5',
          200: '#9fc0ee',
          300: '#75a5e7',
          400: '#5090e1',
          500: '#0057A8',   // Doppelmayr primary blue
          600: '#004d97',
          700: '#003B73',   // dark navy
          800: '#002a54',
          900: '#001a35',
        },
        accent: {
          400: '#ff7a3d',
          500: '#E8571A',   // Doppelmayr orange
          600: '#cc4910',
        },
        surface: {
          DEFAULT: '#F5F7FA',
          card:    '#FFFFFF',
          border:  '#E4E8EF',
          muted:   '#8A93A6',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(160deg, #003B73 0%, #0057A8 50%, #1a7cc9 100%)',
        'brand-gradient-dark': 'linear-gradient(160deg, #001a35 0%, #003B73 60%, #0057A8 100%)',
      },
      animation: {
        'fade-up': 'fadeUp 0.4s ease both',
        'fade-in': 'fadeIn 0.3s ease both',
      },
      keyframes: {
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
