'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { Upload, X, FileText, Loader2 } from 'lucide-react'
import { uploadToCloudinary } from '@/lib/cloudinary'

interface UploadedFile { name: string; url: string; isImage: boolean }

interface FileUploaderProps {
  label: string
  hint?: string
  required?: boolean
  maxFiles?: number
  value?: string[]
  onChange: (urls: string[]) => void
  onFilePicked?: (files: File[]) => void
  disabled?: boolean
  variant?: 'default' | 'danger'
}

async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.size < 300 * 1024) return file
  return new Promise(resolve => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const MAX = 1600
      let w = img.naturalWidth, h = img.naturalHeight
      if (w > MAX || h > MAX) {
        const r = Math.min(MAX / w, MAX / h)
        w = Math.round(w * r); h = Math.round(h * r)
      }
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      canvas.toBlob(blob => {
        if (!blob) { resolve(file); return }
        resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }))
      }, 'image/jpeg', 0.82)
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })
}

export default function FileUploader({
  label, hint, required, maxFiles = 5, value, onChange, onFilePicked, disabled, variant = 'default',
}: FileUploaderProps) {
  const inputRef                      = useRef<HTMLInputElement>(null)
  const [files,     setFiles]         = useState<UploadedFile[]>([])
  const [uploading, setUploading]     = useState(false)
  const [dragOver,  setDragOver]      = useState(false)
  const [error,     setError]         = useState('')

  useEffect(() => {
    if (!value) {
      if (files.length > 0) setFiles([])
      return
    }
    const next = value.map(url => ({
      name: decodeURIComponent(url.split('/').pop()?.split('?')[0] || 'Receipt'),
      url,
      isImage: /\.(jpe?g|png|gif|webp)$/i.test(url),
    }))
    if (next.length !== files.length || next.some((file, index) => file.url !== files[index]?.url)) {
      setFiles(next)
    }
  }, [value, files])

  const borderColor = variant === 'danger'
    ? 'border-red-300 bg-red-50'
    : 'border-surface-border bg-surface'

  const handleFiles = useCallback(async (picked: FileList | null) => {
    if (!picked || picked.length === 0) return
    const remaining = maxFiles - files.length
    if (remaining <= 0) { setError(`Max ${maxFiles} files allowed`); return }
    const toProcess = Array.from(picked).slice(0, remaining)
    // Fire raw files immediately so caller can run OCR in parallel
    if (onFilePicked) onFilePicked(toProcess)
    setUploading(true); setError('')
    try {
      const results = await Promise.all(
        toProcess.map(async raw => {
          const file    = await compressImage(raw)
          const url     = await uploadToCloudinary(file)
          const isImage = raw.type.startsWith('image/')
          return { name: raw.name, url, isImage }
        })
      )
      const next = [...files, ...results]
      setFiles(next)
      onChange(next.map(f => f.url))
    } catch {
      setError('Upload failed. Check connection and try again.')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }, [files, maxFiles, onChange])

  const remove = (idx: number) => {
    const next = files.filter((_, i) => i !== idx)
    setFiles(next)
    onChange(next.map(f => f.url))
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className={`text-xs font-semibold uppercase tracking-wide ${variant === 'danger' ? 'text-red-700' : 'text-gray-500'}`}>
          {label}{required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
        {files.length > 0 && (
          <span className="text-[10px] text-surface-muted">{files.length}/{maxFiles} uploaded</span>
        )}
      </div>

      <div
        className={`rounded-xl border-2 border-dashed p-4 transition-colors ${borderColor}
          ${dragOver ? 'border-brand-400 bg-brand-50' : ''}
          ${disabled ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}
        onDragOver={e  => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
        onClick={() => !disabled && inputRef.current?.click()}
      >
        <input
          ref={inputRef} type="file" multiple accept="image/*,.pdf"
          aria-label={label}
          className="hidden"
          onChange={e => handleFiles(e.target.files)}
          disabled={disabled || uploading}
        />
        <div className="flex flex-col items-center gap-1.5 py-2">
          {uploading
            ? <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
            : <Upload className={`w-6 h-6 ${variant === 'danger' ? 'text-red-400' : 'text-surface-muted'}`} />
          }
          <p className={`text-sm font-medium ${variant === 'danger' ? 'text-red-700' : 'text-gray-600'}`}>
            {uploading ? 'Compressing & uploading…' : 'Click or drag files here'}
          </p>
          {hint && <p className="text-xs text-surface-muted text-center">{hint}</p>}
        </div>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <div key={i} className="relative group">
              {f.isImage ? (
                <a href={f.url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.url} alt={f.name} className="w-16 h-16 object-cover rounded-lg border border-surface-border" />
                </a>
              ) : (
                <a href={f.url} target="_blank" rel="noreferrer"
                  className="w-16 h-16 flex flex-col items-center justify-center rounded-lg border border-surface-border bg-white gap-1 hover:bg-surface transition-colors">
                  <FileText className="w-6 h-6 text-brand-400" />
                  <span className="text-[9px] text-surface-muted truncate w-14 text-center px-1">{f.name}</span>
                </a>
              )}
              <button
                type="button"
                onClick={e => { e.stopPropagation(); remove(i) }}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Remove file"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
