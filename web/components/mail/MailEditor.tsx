'use client'
// Full rich email editor for the Communications module.
// tiptap + extensions: inline styling, color/highlight, HR, nested lists, inline images
// (base64 data-URIs so they survive copy-paste into Outlook), HTML snippets,
// search & replace, block move (drag-style section reordering), device preview.
import { useEditor, EditorContent, Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Highlight from '@tiptap/extension-highlight'
import { TextStyle, Color } from '@tiptap/extension-text-style'
import { useState, useRef, useEffect } from 'react'
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, List, ListOrdered,
  Heading2, Heading3, Link2, Undo, Redo, Link2Off, Check, Minus,
  ImagePlus, Code2, Search, ArrowUp, ArrowDown, Palette, Highlighter,
  Monitor, Smartphone, X, IndentIncrease, IndentDecrease,
} from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import { cn } from '@/lib/utils'
import { Toggle } from '@/components/ui/toggle'
import { Tooltip } from '@/components/ui/tooltip'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { PopoverRoot, PopoverTrigger, PopoverContent, PopoverClose } from '@/components/ui/popover'
import { uploadToCloudinary } from '@/lib/cloudinary'

interface Props {
  value?: string
  onChange?: (html: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  minHeight?: number
  onEditorReady?: (editor: Editor) => void
}

/* ── Image helpers ─────────────────────────────────────────── */

// Fallback only (Cloudinary not configured): compress to a data-URI so the
// image lives inside the HTML itself. Works everywhere but bloats every
// recipient's copy of a mass-send — insertImage() prefers a hosted URL.
function fileToDataUri(file: File, maxKB = 350): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const canvas = document.createElement('canvas')
      let { width, height } = img
      const MAX = 900
      if (width > MAX || height > MAX) {
        const ratio = Math.min(MAX / width, MAX / height)
        width = Math.round(width * ratio); height = Math.round(height * ratio)
      }
      canvas.width = width; canvas.height = height
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(url)
      let quality = 0.85
      const attempt = () => {
        const dataUrl = canvas.toDataURL('image/jpeg', quality)
        if ((dataUrl.length * 3) / 4 <= maxKB * 1024 || quality <= 0.4) resolve(dataUrl)
        else { quality -= 0.1; attempt() }
      }
      attempt()
    }
    img.onerror = reject
    img.src = url
  })
}

/* ── Search & Replace (plain ProseMirror walk) ─────────────── */

function findMatches(editor: Editor, find: string): { from: number; to: number }[] {
  if (!find) return []
  const ranges: { from: number; to: number }[] = []
  const f = find.toLowerCase()
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return
    const text = (node.text || '').toLowerCase()
    let idx = 0
    while ((idx = text.indexOf(f, idx)) !== -1) {
      ranges.push({ from: pos + idx, to: pos + idx + find.length })
      idx += find.length
    }
  })
  return ranges
}

function replaceAll(editor: Editor, find: string, repl: string): number {
  const ranges = findMatches(editor, find)
  if (!ranges.length) return 0
  let tr = editor.state.tr
  for (let i = ranges.length - 1; i >= 0; i--) tr = tr.insertText(repl, ranges[i].from, ranges[i].to)
  editor.view.dispatch(tr)
  return ranges.length
}

/* ── Block move (section reordering) ───────────────────────── */

function moveBlock(editor: Editor, dir: -1 | 1) {
  const { state, view } = editor
  const { $from } = state.selection
  if ($from.depth < 1) return
  const index = $from.index(0)
  const doc = state.doc
  const target = index + dir
  if (target < 0 || target >= doc.childCount) return
  const lo = Math.min(index, target)
  let pos = 0
  for (let i = 0; i < lo; i++) pos += doc.child(i).nodeSize
  const first = doc.child(lo)
  const second = doc.child(lo + 1)
  const tr = state.tr.replaceWith(pos, pos + first.nodeSize + second.nodeSize, [second.copy(second.content), first.copy(first.content)])
  view.dispatch(tr)
  // keep cursor with the moved block
  const newPos = dir === -1 ? pos + 1 : pos + second.nodeSize + 1
  editor.commands.focus(Math.min(newPos, editor.state.doc.content.size - 1))
}

/* ── Toolbar sub-components ────────────────────────────────── */

const TEXT_COLORS = [
  { label: 'Default', value: '' },
  { label: 'Doppelmayr Blue', value: '#0057A8' },
  { label: 'Gray', value: '#6b7280' },
  { label: 'Red', value: '#dc2626' },
  { label: 'Green', value: '#16a34a' },
  { label: 'Amber', value: '#d97706' },
  { label: 'Purple', value: '#7c3aed' },
]

function ColorPopover({ editor }: { editor: Editor }) {
  return (
    <PopoverRoot>
      <Tooltip content="Text color" side="top">
        <PopoverTrigger asChild>
          <Toggle size="sm" pressed={!!editor.getAttributes('textStyle').color} aria-label="Text color">
            <Palette className="w-3.5 h-3.5" />
          </Toggle>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="start" className="w-44 p-2">
        <div className="grid grid-cols-4 gap-1.5">
          {TEXT_COLORS.map(c => (
            <PopoverClose asChild key={c.label}>
              <button type="button" title={c.label} aria-label={c.label}
                onClick={() => c.value
                  ? editor.chain().focus().setColor(c.value).run()
                  : editor.chain().focus().unsetColor().run()}
                className="w-8 h-8 rounded-lg border border-surface-border flex items-center justify-center hover:scale-110 transition-transform"
                style={{ background: c.value || '#ffffff' }}>
                {!c.value && <X className="w-3.5 h-3.5 text-ink-muted" />}
              </button>
            </PopoverClose>
          ))}
        </div>
      </PopoverContent>
    </PopoverRoot>
  )
}

function LinkPopover({ editor }: { editor: Editor }) {
  const [url, setUrl] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const isLinkActive = editor.isActive('link')

  const applyLink = () => {
    if (!url.trim()) return
    const href = url.startsWith('http') ? url : `https://${url}`
    editor.chain().focus().setLink({ href }).run()
    setUrl('')
  }

  return (
    <PopoverRoot onOpenChange={open => { if (open) setTimeout(() => inputRef.current?.focus(), 50) }}>
      <Tooltip content={isLinkActive ? 'Edit link' : 'Add link'} side="top">
        <PopoverTrigger asChild>
          <Toggle size="sm" pressed={isLinkActive} disabled={editor.state.selection.empty && !isLinkActive} aria-label="Link">
            <Link2 className="w-3.5 h-3.5" />
          </Toggle>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="start" className="w-80 p-3 space-y-3">
        <p className="text-xs font-semibold text-ink-muted">Insert link</p>
        <div className="flex gap-2">
          <input ref={inputRef} type="url" value={url} onChange={e => setUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyLink() } }}
            placeholder="https://example.com"
            className="flex-1 h-8 px-2.5 rounded-lg border border-surface-border text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" />
          <PopoverClose asChild>
            <button type="button" onClick={applyLink} aria-label="Apply link"
              className="h-8 w-8 rounded-lg bg-brand-500 hover:bg-brand-600 text-white flex items-center justify-center transition-colors flex-shrink-0">
              <Check className="w-3.5 h-3.5" />
            </button>
          </PopoverClose>
        </div>
        {isLinkActive && (
          <button type="button" onClick={() => editor.chain().focus().unsetLink().run()}
            className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 font-medium transition-colors">
            <Link2Off className="w-3 h-3" /> Remove link
          </button>
        )}
      </PopoverContent>
    </PopoverRoot>
  )
}

function SearchReplacePopover({ editor }: { editor: Editor }) {
  const [find, setFind] = useState('')
  const [repl, setRepl] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const matches = find ? findMatches(editor, find).length : 0

  return (
    <PopoverRoot onOpenChange={() => setResult(null)}>
      <Tooltip content="Search & replace" side="top">
        <PopoverTrigger asChild>
          <Toggle size="sm" pressed={false} aria-label="Search and replace">
            <Search className="w-3.5 h-3.5" />
          </Toggle>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="start" className="w-80 p-3 space-y-2">
        <p className="text-xs font-semibold text-ink-muted">Search &amp; replace</p>
        <input type="text" value={find} onChange={e => { setFind(e.target.value); setResult(null) }}
          placeholder="Find…" aria-label="Find text"
          className="w-full h-8 px-2.5 rounded-lg border border-surface-border text-sm focus:outline-none focus:border-brand-500" />
        <input type="text" value={repl} onChange={e => setRepl(e.target.value)}
          placeholder="Replace with…" aria-label="Replace with"
          className="w-full h-8 px-2.5 rounded-lg border border-surface-border text-sm focus:outline-none focus:border-brand-500" />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-surface-muted">
            {result || (find ? `${matches} match${matches !== 1 ? 'es' : ''}` : 'Case-insensitive')}
          </span>
          <Button type="button" size="sm" disabled={!find || matches === 0}
            onClick={() => { const n = replaceAll(editor, find, repl); setResult(`Replaced ${n}`) }}>
            Replace all
          </Button>
        </div>
      </PopoverContent>
    </PopoverRoot>
  )
}

function HtmlSnippetDialog({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)
  const [html, setHtml] = useState('')
  const insert = () => {
    if (!html.trim()) return
    editor.chain().focus().insertContent(html).run()
    setHtml(''); setOpen(false)
  }
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Tooltip content="Insert HTML snippet" side="top">
        <Dialog.Trigger asChild>
          <Toggle size="sm" pressed={false} aria-label="Insert HTML snippet">
            <Code2 className="w-3.5 h-3.5" />
          </Toggle>
        </Dialog.Trigger>
      </Tooltip>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface-1 rounded-2xl shadow-2xl p-5 w-full max-w-lg">
          <Dialog.Title className="text-sm font-bold text-ink mb-1">Insert HTML snippet</Dialog.Title>
          <Dialog.Description className="text-xs text-surface-muted mb-3">
            Raw HTML with inline styles — e.g. a styled table or button. Inserted at the cursor.
          </Dialog.Description>
          <textarea value={html} onChange={e => setHtml(e.target.value)} rows={8}
            placeholder='<table style="width:100%">…</table>'
            className="w-full rounded-xl border border-surface-border px-3 py-2.5 text-xs font-mono resize-none focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" />
          <div className="flex gap-3 justify-end mt-3">
            <Dialog.Close asChild><Button type="button" variant="outline" size="sm">Cancel</Button></Dialog.Close>
            <Button type="button" size="sm" onClick={insert} disabled={!html.trim()}>Insert</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function DevicePreviewDialog({ getHtml, subject, trigger }: {
  getHtml: () => string; subject?: string; trigger?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const width = device === 'mobile' ? 375 : 680

  const srcDoc = open ? `<!doctype html><html><head><meta charset="utf-8">
<style>
  body { margin:0; padding:24px; font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size:15px; line-height:1.5; color:#1f2937; }
  img { max-width:100%; height:auto; }
  hr { border:none; border-top:1px solid #d1d5db; margin:16px 0; }
  a { color:#0057A8; }
  p { margin:0 0 12px; }
  ul,ol { margin:0 0 12px; padding-left:24px; }
</style></head><body>${getHtml()}</body></html>` : ''

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        {trigger || (
          <Button type="button" variant="outline" size="sm" className="gap-1.5">
            <Monitor className="w-3.5 h-3.5" /> Preview
          </Button>
        )}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface-1 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-border">
            <div className="min-w-0">
              <Dialog.Title className="text-sm font-bold text-ink">Device preview</Dialog.Title>
              {subject && <p className="text-xs text-surface-muted truncate">Subject: {subject}</p>}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex rounded-xl border border-surface-border overflow-hidden">
                {([['desktop', Monitor], ['mobile', Smartphone]] as const).map(([d, Icon]) => (
                  <button key={d} type="button" title={d} aria-label={`${d} preview`} onClick={() => setDevice(d)}
                    className={`p-2 transition-all ${device === d ? 'bg-brand-500 text-white' : 'bg-surface-1 text-surface-muted hover:bg-surface'}`}>
                    <Icon className="w-4 h-4" />
                  </button>
                ))}
              </div>
              <Dialog.Close asChild>
                <button type="button" aria-label="Close preview" className="p-1.5 rounded-lg text-surface-muted hover:bg-surface transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </Dialog.Close>
            </div>
          </div>
          <div className="flex-1 overflow-auto bg-surface-2 p-6 flex justify-center min-h-[420px]">
            <iframe title="Email preview" srcDoc={srcDoc} sandbox=""
              style={{ width, maxWidth: '100%' }}
              className="bg-surface-1 rounded-xl shadow-lg border border-surface-border h-[60vh] transition-all duration-300" />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/* ── Main editor ───────────────────────────────────────────── */

export default function MailEditor({
  value, onChange, placeholder = 'Write your email…', className, disabled, minHeight = 280, onEditorReady,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      // StarterKit v3 bundles Link/Underline — disable Link so the configured one below is the only registration
      StarterKit.configure({ link: false }),
      Placeholder.configure({ placeholder }),
      Link.configure({ openOnClick: false, autolink: true }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: false }),
      Image.configure({ inline: false, allowBase64: true }),
    ],
    content: value || '',
    editable: !disabled,
    onUpdate: ({ editor }) => onChange?.(editor.getHTML()),
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none px-4 py-3.5 [&_img]:rounded-lg [&_img]:max-w-full',
        style: `min-height:${minHeight}px`,
      },
    },
  })

  useEffect(() => { if (editor) onEditorReady?.(editor) }, [editor, onEditorReady])

  // Sync external value resets (e.g. loading a draft / restoring a version)
  useEffect(() => {
    if (editor && value !== undefined && value !== editor.getHTML()) {
      editor.commands.setContent(value, { emitUpdate: false })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor])

  if (!editor) return null

  const insertImage = async (file: File) => {
    // Prefer a hosted Cloudinary URL — a data URI gets embedded in the HTML
    // of every recipient's copy, which bloats a mass-send and instantly blows
    // the mailto: character cap. Fall back to inline base64 only if
    // Cloudinary isn't configured, so this still works without it.
    try {
      const url = await uploadToCloudinary(file)
      editor.chain().focus().setImage({ src: url, alt: file.name }).run()
    } catch {
      const dataUri = await fileToDataUri(file)
      editor.chain().focus().setImage({ src: dataUri, alt: file.name }).run()
    }
  }

  const btn = (key: string, Icon: React.ElementType, title: string, action: () => void, active = false, disabledBtn = false) => (
    <Tooltip key={key} content={title} side="top">
      <Toggle size="sm" pressed={active} onPressedChange={action} disabled={disabled || disabledBtn} aria-label={title}>
        <Icon className="w-3.5 h-3.5" />
      </Toggle>
    </Tooltip>
  )

  return (
    <div className={cn(
      'border border-surface-border rounded-xl overflow-hidden bg-surface-1',
      'focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20 transition-all duration-150',
      disabled && 'opacity-60 pointer-events-none',
      className
    )}>
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-surface-border bg-surface-2/80 flex-wrap">
        {btn('bold', Bold, 'Bold', () => editor.chain().focus().toggleBold().run(), editor.isActive('bold'))}
        {btn('italic', Italic, 'Italic', () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic'))}
        {btn('underline', UnderlineIcon, 'Underline', () => editor.chain().focus().toggleUnderline().run(), editor.isActive('underline'))}
        {btn('strike', Strikethrough, 'Strikethrough', () => editor.chain().focus().toggleStrike().run(), editor.isActive('strike'))}
        <ColorPopover editor={editor} />
        {btn('highlight', Highlighter, 'Highlight', () => editor.chain().focus().toggleHighlight().run(), editor.isActive('highlight'))}

        <Separator orientation="vertical" className="mx-1.5 h-4" />

        {btn('h2', Heading2, 'Heading', () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive('heading', { level: 2 }))}
        {btn('h3', Heading3, 'Subheading', () => editor.chain().focus().toggleHeading({ level: 3 }).run(), editor.isActive('heading', { level: 3 }))}
        {btn('bullet', List, 'Bullet list', () => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList'))}
        {btn('ordered', ListOrdered, 'Numbered list', () => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList'))}
        {btn('indent', IndentIncrease, 'Nest list item', () => editor.chain().focus().sinkListItem('listItem').run(), false, !editor.can().sinkListItem('listItem'))}
        {btn('outdent', IndentDecrease, 'Un-nest list item', () => editor.chain().focus().liftListItem('listItem').run(), false, !editor.can().liftListItem('listItem'))}
        {btn('hr', Minus, 'Horizontal rule', () => editor.chain().focus().setHorizontalRule().run())}

        <Separator orientation="vertical" className="mx-1.5 h-4" />

        <LinkPopover editor={editor} />
        <Tooltip content="Insert image" side="top">
          <Toggle size="sm" pressed={false} aria-label="Insert image"
            onPressedChange={() => fileInputRef.current?.click()}>
            <ImagePlus className="w-3.5 h-3.5" />
          </Toggle>
        </Tooltip>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" aria-label="Upload image"
          onChange={e => { const f = e.target.files?.[0]; if (f) insertImage(f); e.target.value = '' }} />
        <HtmlSnippetDialog editor={editor} />
        <SearchReplacePopover editor={editor} />

        <Separator orientation="vertical" className="mx-1.5 h-4" />

        {btn('moveUp', ArrowUp, 'Move section up', () => moveBlock(editor, -1))}
        {btn('moveDown', ArrowDown, 'Move section down', () => moveBlock(editor, 1))}

        <div className="flex-1" />

        {btn('undo', Undo, 'Undo', () => editor.chain().focus().undo().run(), false, !editor.can().undo())}
        {btn('redo', Redo, 'Redo', () => editor.chain().focus().redo().run(), false, !editor.can().redo())}
      </div>

      {/* Editor area */}
      <EditorContent editor={editor} />
    </div>
  )
}
