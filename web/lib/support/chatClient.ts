import { MAX_MESSAGES, MAX_MODEL_CHARS, MAX_USER_CHARS } from '@/lib/support/chatInput'

export type SupportMsg = { role: 'user' | 'model'; text: string }

/** Shown at the chat entry point. Accurate and minimal: no retention promise (the provider's handling is not ours to state). */
export const SUPPORT_CHAT_NOTICE =
  'Don’t share passwords, verification codes or other secrets. Your messages are sent to Google’s Gemini AI to write replies.'

export const SUPPORT_INPUT_MAX = MAX_USER_CHARS

/** The request the UI sends: only role + text, at most the server's turn limit, every message within the server's character limits. */
export function toRequestMessages(history: SupportMsg[]): SupportMsg[] {
  const cut = (t: string, n: number) => (Array.from(t).length > n ? Array.from(t).slice(0, n).join('') : t)
  return history.slice(-MAX_MESSAGES).map(m => ({ role: m.role, text: cut(m.text, m.role === 'user' ? MAX_USER_CHARS : MAX_MODEL_CHARS) }))
}
