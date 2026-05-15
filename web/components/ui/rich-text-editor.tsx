'use client'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import { useState, useRef } from 'react'
import {
  Bold, Italic, Strikethrough, List, ListOrdered,
  Heading2, Link2, Undo, Redo, Code, Link2Off, Check,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Toggle } from '@/components/ui/toggle'
import { Tooltip } from '@/components/ui/tooltip'
import { Separator } from '@/components/ui/separator'
import { PopoverRoot, PopoverTrigger, PopoverContent, PopoverClose } from '@/components/ui/popover'

interface Props {
  value?: string
  onChange?: (html: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  minHeight?: number
}

const TOOLBAR_GROUPS = [
  {
    items: [
      { key: 'bold',          icon: Bold,          title: 'Bold',          kbd: '⌘B',  action: (e: ReturnType<typeof useEditor>) => e?.chain().focus().toggleBold().run(),          isActive: (e: ReturnType<typeof useEditor>) => !!e?.isActive('bold') },
      { key: 'italic',        icon: Italic,        title: 'Italic',        kbd: '⌘I',  action: (e: ReturnType<typeof useEditor>) => e?.chain().focus().toggleItalic().run(),        isActive: (e: ReturnType<typeof useEditor>) => !!e?.isActive('italic') },
      { key: 'strike',        icon: Strikethrough, title: 'Strikethrough', kbd: '⌘⇧X', action: (e: ReturnType<typeof useEditor>) => e?.chain().focus().toggleStrike().run(),        isActive: (e: ReturnType<typeof useEditor>) => !!e?.isActive('strike') },
      { key: 'code',          icon: Code,          title: 'Inline code',   kbd: '⌘E',  action: (e: ReturnType<typeof useEditor>) => e?.chain().focus().toggleCode().run(),          isActive: (e: ReturnType<typeof useEditor>) => !!e?.isActive('code') },
    ],
  },
  {
    items: [
      { key: 'heading2',      icon: Heading2,      title: 'Heading',       kbd: '⌘⌥2', action: (e: ReturnType<typeof useEditor>) => e?.chain().focus().toggleHeading({ level: 2 }).run(), isActive: (e: ReturnType<typeof useEditor>) => !!e?.isActive('heading', { level: 2 }) },
      { key: 'bulletList',    icon: List,          title: 'Bullet list',   kbd: '⌘⇧8', action: (e: ReturnType<typeof useEditor>) => e?.chain().focus().toggleBulletList().run(),    isActive: (e: ReturnType<typeof useEditor>) => !!e?.isActive('bulletList') },
      { key: 'orderedList',   icon: ListOrdered,   title: 'Numbered list', kbd: '⌘⇧7', action: (e: ReturnType<typeof useEditor>) => e?.chain().focus().toggleOrderedList().run(),   isActive: (e: ReturnType<typeof useEditor>) => !!e?.isActive('orderedList') },
    ],
  },
]

function LinkPopover({ editor }: { editor: ReturnType<typeof useEditor> }) {
  const [url, setUrl] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const isLinkActive = editor?.isActive('link')

  const applyLink = () => {
    if (!editor) return
    if (!url.trim()) return
    const href = url.startsWith('http') ? url : `https://${url}`
    editor.chain().focus().setLink({ href }).run()
    setUrl('')
  }

  const removeLink = () => {
    editor?.chain().focus().unsetLink().run()
  }

  return (
    <PopoverRoot onOpenChange={open => { if (open) setTimeout(() => inputRef.current?.focus(), 50) }}>
      <Tooltip content={isLinkActive ? 'Edit link' : 'Add link'} side="top">
        <PopoverTrigger asChild>
          <Toggle
            size="sm"
            pressed={!!isLinkActive}
            disabled={!editor || editor.state.selection.empty}
            aria-label="Link"
          >
            <Link2 className="w-3.5 h-3.5" />
          </Toggle>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="start" className="w-80 p-3 space-y-3">
        <p className="text-xs font-semibold text-gray-700">Insert link</p>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyLink() } }}
            placeholder="https://example.com"
            className="flex-1 h-8 px-2.5 rounded-lg border border-surface-border text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />
          <PopoverClose asChild>
            <button type="button" onClick={applyLink}
              className="h-8 w-8 rounded-lg bg-brand-500 hover:bg-brand-600 text-white flex items-center justify-center transition-colors flex-shrink-0"
              aria-label="Apply link">
              <Check className="w-3.5 h-3.5" />
            </button>
          </PopoverClose>
        </div>
        {isLinkActive && (
          <button type="button" onClick={removeLink}
            className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 font-medium transition-colors">
            <Link2Off className="w-3 h-3" /> Remove link
          </button>
        )}
        <p className="text-[10px] text-surface-muted">Press Enter to apply · Select text first</p>
      </PopoverContent>
    </PopoverRoot>
  )
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder = 'Write something…',
  className,
  disabled,
  minHeight = 140,
}: Props) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder }),
      Link.configure({ openOnClick: false, autolink: true }),
    ],
    content: value || '',
    editable: !disabled,
    onUpdate: ({ editor }) => onChange?.(editor.getHTML()),
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none px-3.5 py-3',
        style: `min-height:${minHeight}px`,
      },
    },
  })

  if (!editor) return null

  return (
    <div
      className={cn(
        'border border-surface-border rounded-xl overflow-hidden bg-white',
        'focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20',
        'transition-all duration-150',
        disabled && 'opacity-60 pointer-events-none',
        className
      )}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-surface-border bg-gray-50/80 flex-wrap">
        {TOOLBAR_GROUPS.map((group, gi) => (
          <div key={gi} className="flex items-center gap-0.5">
            {gi > 0 && <Separator orientation="vertical" className="mx-1.5 h-4" />}
            {group.items.map(({ key, icon: Icon, title, kbd, action, isActive }) => (
              <Tooltip
                key={key}
                side="top"
                content={
                  <span className="flex items-center gap-1.5">
                    {title}
                    <kbd className="ml-1 text-[9px] font-mono bg-white/20 px-1 py-0.5 rounded">{kbd}</kbd>
                  </span>
                }
              >
                <Toggle
                  size="sm"
                  pressed={isActive(editor)}
                  onPressedChange={() => action(editor)}
                  disabled={disabled}
                  aria-label={title}
                >
                  <Icon className="w-3.5 h-3.5" />
                </Toggle>
              </Tooltip>
            ))}
          </div>
        ))}

        {/* Link popover */}
        <Separator orientation="vertical" className="mx-1.5 h-4" />
        <LinkPopover editor={editor} />

        {/* Spacer */}
        <div className="flex-1" />

        {/* Undo / Redo */}
        <div className="flex items-center gap-0.5">
          <Tooltip content={<span>Undo <kbd className="text-[9px] font-mono bg-white/20 px-1 py-0.5 rounded">⌘Z</kbd></span>} side="top">
            <Toggle
              size="sm"
              pressed={false}
              onPressedChange={() => editor.chain().focus().undo().run()}
              disabled={!editor.can().undo()}
              aria-label="Undo"
            >
              <Undo className="w-3.5 h-3.5" />
            </Toggle>
          </Tooltip>
          <Tooltip content={<span>Redo <kbd className="text-[9px] font-mono bg-white/20 px-1 py-0.5 rounded">⌘⇧Z</kbd></span>} side="top">
            <Toggle
              size="sm"
              pressed={false}
              onPressedChange={() => editor.chain().focus().redo().run()}
              disabled={!editor.can().redo()}
              aria-label="Redo"
            >
              <Redo className="w-3.5 h-3.5" />
            </Toggle>
          </Tooltip>
        </div>

        {/* Character hint */}
        <CharCounter editor={editor} />
      </div>

      {/* Editor area */}
      <EditorContent editor={editor} />
    </div>
  )
}

function CharCounter({ editor }: { editor: ReturnType<typeof useEditor> }) {
  const count = editor?.storage.characterCount?.characters?.() ?? editor?.getText().length ?? 0
  if (count === 0) return null
  return (
    <span className="text-[9px] text-surface-muted tabular-nums ml-1 select-none">
      {count}
    </span>
  )
}
