'use client'
import * as T from '@radix-ui/react-toast'
import { createContext, useCallback, useContext, useState } from 'react'
import { CheckCircle2, XCircle, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'

type Kind = 'success' | 'error' | 'info'
interface Msg { id: number; text: string; kind: Kind }
type ToastFn = (text: string, kind?: Kind) => void

const Ctx = createContext<ToastFn>(() => {})
export const useToast = () => useContext(Ctx)

const icons = { success: CheckCircle2, error: XCircle, info: Info }
const styles = {
  success: 'border-green-200 bg-white',
  error:   'border-red-200   bg-white',
  info:    'border-blue-200  bg-white',
}
const iconStyles = {
  success: 'text-green-500',
  error:   'text-red-500',
  info:    'text-blue-500',
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msgs, setMsgs] = useState<Msg[]>([])

  const toast = useCallback((text: string, kind: Kind = 'success') => {
    const id = Date.now()
    setMsgs(m => [...m, { id, text, kind }])
    setTimeout(() => setMsgs(m => m.filter(x => x.id !== id)), 3500)
  }, [])

  return (
    <Ctx.Provider value={toast}>
      <T.Provider swipeDirection="right" duration={3500}>
        {children}
        {msgs.map(({ id, text, kind }) => {
          const Icon = icons[kind]
          return (
            <T.Root
              key={id}
              open
              onOpenChange={open => { if (!open) setMsgs(m => m.filter(x => x.id !== id)) }}
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg text-sm font-medium',
                'data-[state=open]:animate-fade-in data-[swipe=end]:opacity-0 transition-opacity',
                styles[kind]
              )}
            >
              <Icon className={cn('w-4 h-4 flex-shrink-0', iconStyles[kind])} />
              <T.Description className="flex-1 text-gray-800">{text}</T.Description>
              <T.Close
                onClick={() => setMsgs(m => m.filter(x => x.id !== id))}
                className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </T.Close>
            </T.Root>
          )
        })}
        <T.Viewport className="fixed bottom-6 right-6 flex flex-col gap-2 z-[100] w-full max-w-xs outline-none" />
      </T.Provider>
    </Ctx.Provider>
  )
}
