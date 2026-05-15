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
        // ─── Doppelmayr brand: graphite + blue accent ───
        // Token names retain "orange-*" suffix for backward compat (50+ files reference them).
        dm: {
          orange:       '#0057A8',
          'orange-50':  '#e8f0fa',
          'orange-100': '#c5dbf2',
          'orange-200': '#8fb8e6',
          'orange-500': '#0057A8',
          'orange-600': '#004d97',
          'orange-700': '#003B73',
          blue:         '#0057A8',
          'blue-50':    '#e8f0fa',
          'blue-100':   '#c5dbf2',
          'blue-500':   '#0057A8',
          'blue-600':   '#004d97',
          'blue-700':   '#003B73',
          graphite:     '#1a1a1a',
          'graphite-2': '#333333',
          'graphite-3': '#666666',
        },
        // ─── Surface scale (industrial white→light grey) ───
        surface: {
          DEFAULT: '#f5f5f5',
          1:       '#ffffff',
          2:       '#f5f5f5',
          3:       '#eaeaea',
          card:    '#ffffff',
          border:  '#e5e5e5',
          muted:   '#737373',
        },
        // ─── Status palette (unified) ───
        status: {
          success:      '#0a7d3b',
          'success-bg': '#e6f4ec',
          danger:       '#c83838',
          'danger-bg':  '#fbe9e9',
          warning:      '#d97706',
          'warning-bg': '#fef3e2',
          info:         '#1d4ed8',
          'info-bg':    '#e8f0fe',
        },
        // ─── Brand alias (LEGACY) — remapped to Doppelmayr blue.
        brand: {
          50:  '#e8f0fa',
          100: '#c5dbf2',
          200: '#8fb8e6',
          300: '#5994d9',
          400: '#2371cc',
          500: '#0057A8',
          600: '#004d97',
          700: '#003B73',
          800: '#002a52',
          900: '#001a33',
        },
        accent: {
          100: '#c5dbf2',
          400: '#2371cc',
          500: '#0057A8',
          600: '#004d97',
        },
      },
      fontFamily: {
        sans:    ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Inter Tight"', 'Inter', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      letterSpacing: {
        tightest: '-0.04em',
        tighter:  '-0.025em',
      },
      backgroundImage: {
        'dm-hero': 'linear-gradient(180deg, #1a1a1a 0%, #2d2d2d 100%)',
        'brand-gradient':      'linear-gradient(160deg, #1a1a1a 0%, #333 50%, #4d4d4d 100%)',
        'brand-gradient-dark': 'linear-gradient(160deg, #000 0%, #1a1a1a 100%)',
        'mesh-blue':
          'radial-gradient(ellipse 80% 60% at 15% 5%,  rgba(0,87,168,0.08) 0%, transparent 65%),' +
          'radial-gradient(ellipse 60% 50% at 85% 85%,  rgba(0,0,0,0.04) 0%, transparent 65%)',
      },
      boxShadow: {
        'glass':      '0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)',
        'glass-lg':   '0 2px 8px rgba(0,0,0,0.06), 0 12px 32px rgba(0,0,0,0.08)',
        'card':       '0 1px 2px rgba(0,0,0,0.04)',
        'card-hover': '0 4px 12px rgba(0,0,0,0.08)',
        'crisp':      '0 0 0 1px rgba(0,0,0,0.06)',
      },
      animation: {
        'fade-up':      'fadeUp 0.4s ease both',
        'fade-in':      'fadeIn 0.3s ease both',
        'scale-in':     'scaleIn 0.2s ease both',
        'slide-down':   'slideDown 0.25s ease both',
        'shimmer':      'shimmer 1.4s linear infinite',
        'count-up':     'countUp 0.8s ease-out both',
        'fade-up-1':    'fadeUp 0.4s 0.05s ease both',
        'fade-up-2':    'fadeUp 0.4s 0.10s ease both',
        'fade-up-3':    'fadeUp 0.4s 0.15s ease both',
        'fade-up-4':    'fadeUp 0.4s 0.20s ease both',
      },
      keyframes: {
        fadeUp:    { from: { opacity: '0', transform: 'translateY(14px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        fadeIn:    { from: { opacity: '0' }, to: { opacity: '1' } },
        scaleIn:   { from: { opacity: '0', transform: 'scale(0.95)' }, to: { opacity: '1', transform: 'scale(1)' } },
        slideDown: { from: { opacity: '0', transform: 'translateY(-8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        shimmer:   { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        countUp:   { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
}
export default config
