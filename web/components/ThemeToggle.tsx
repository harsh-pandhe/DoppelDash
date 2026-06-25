'use client'
import { Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark'

function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export default function ThemeToggle() {
  // start undefined to avoid SSR/client mismatch; resolve on mount
  const [theme, setTheme] = useState<Theme | null>(null)

  useEffect(() => { setTheme(currentTheme()) }, [])

  const toggle = () => {
    const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark'
    document.documentElement.classList.toggle('dark', next === 'dark')
    try { localStorage.setItem('theme', next) } catch { /* quota */ }
    setTheme(next)
  }

  const isDark = theme === 'dark'

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Light mode' : 'Dark mode'}
      className="p-2 rounded-xl text-ink-muted hover:bg-surface transition-colors flex-shrink-0"
    >
      {/* render both invisibly until mounted to keep markup stable, then show resolved */}
      {theme === null ? (
        <span className="block w-[18px] h-[18px]" aria-hidden />
      ) : isDark ? (
        <Sun className="w-[18px] h-[18px]" />
      ) : (
        <Moon className="w-[18px] h-[18px]" />
      )}
    </button>
  )
}
