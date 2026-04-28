// Local file upload — POSTs to /api/upload, returns /uploads/<filename>
export async function uploadToCloudinary(file: File): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch('/api/upload', { method: 'POST', body: formData })
  if (!res.ok) throw new Error('Upload failed')
  const data = await res.json()
  return data.url as string
}

export async function uploadMultiple(files: File[]): Promise<string[]> {
  return Promise.all(files.map(uploadToCloudinary))
}
