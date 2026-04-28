// Public contact card — no auth required
// Accessible via /contact/[id] or via QR code
import { Mail, Phone, Building2, Globe } from 'lucide-react'

interface PublicContact {
  _id: string; name: string; email?: string; phone?: string
  company?: string; designation?: string; photo?: string
  tags?: string[]; website?: string
}

async function getContact(id: string): Promise<PublicContact | null> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const res = await fetch(`${baseUrl}/api/crm/${id}/share`, { cache: 'no-store' })
    if (!res.ok) return null
    return res.json()
  } catch { return null }
}

export default async function PublicContactPage({ params }: { params: { id: string } }) {
  const contact = await getContact(params.id)

  if (!contact) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center p-8">
        <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
          <Building2 className="w-8 h-8 text-gray-400" />
        </div>
        <p className="font-bold text-gray-900 text-lg">Contact not found</p>
        <p className="text-sm text-gray-500 mt-1">This link may be invalid or expired.</p>
      </div>
    </div>
  )

  const initials = contact.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)

  // vCard download
  const vcard = [
    'BEGIN:VCARD', 'VERSION:3.0',
    `FN:${contact.name}`,
    contact.company    ? `ORG:${contact.company}`     : '',
    contact.designation? `TITLE:${contact.designation}` : '',
    contact.email      ? `EMAIL:${contact.email}`     : '',
    contact.phone      ? `TEL:${contact.phone}`       : '',
    contact.website    ? `URL:${contact.website}`     : '',
    'END:VCARD',
  ].filter(Boolean).join('\n')

  const vcardHref = `data:text/vcard;charset=utf-8,${encodeURIComponent(vcard)}`

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-br from-brand-600 to-blue-700 px-6 pt-8 pb-12 text-white text-center relative">
          <div className="absolute inset-0 opacity-10"
            style={{ backgroundImage: 'radial-gradient(circle at 20% 80%, white 1px, transparent 1px)', backgroundSize: '24px 24px' }}
          />
          {contact.photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={contact.photo} alt={contact.name}
              className="w-20 h-20 rounded-full object-cover mx-auto mb-3 border-4 border-white/30" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-white/20 backdrop-blur flex items-center justify-center mx-auto mb-3 border-4 border-white/30">
              <span className="text-2xl font-extrabold text-white">{initials}</span>
            </div>
          )}
          <h1 className="text-xl font-extrabold">{contact.name}</h1>
          {contact.designation && <p className="text-sm text-blue-100 mt-0.5">{contact.designation}</p>}
          {contact.company && (
            <p className="text-xs text-blue-200 mt-1 flex items-center justify-center gap-1">
              <Building2 className="w-3 h-3" /> {contact.company}
            </p>
          )}
        </div>

        {/* Body */}
        <div className="px-6 -mt-6 pb-6 space-y-3">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            {contact.email && (
              <a href={`mailto:${contact.email}`}
                className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors">
                <div className="w-8 h-8 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
                  <Mail className="w-4 h-4 text-brand-500" />
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">Email</p>
                  <p className="text-sm font-semibold text-gray-900">{contact.email}</p>
                </div>
              </a>
            )}
            {contact.phone && (
              <a href={`tel:${contact.phone}`}
                className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors">
                <div className="w-8 h-8 rounded-xl bg-green-50 flex items-center justify-center flex-shrink-0">
                  <Phone className="w-4 h-4 text-green-500" />
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">Phone</p>
                  <p className="text-sm font-semibold text-gray-900">{contact.phone}</p>
                </div>
              </a>
            )}
            {contact.website && (
              <a href={contact.website.startsWith('http') ? contact.website : `https://${contact.website}`}
                target="_blank" rel="noreferrer"
                className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                <div className="w-8 h-8 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0">
                  <Globe className="w-4 h-4 text-purple-500" />
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">Website</p>
                  <p className="text-sm font-semibold text-gray-900 truncate">{contact.website}</p>
                </div>
              </a>
            )}
          </div>

          {contact.tags && contact.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {contact.tags.map(tag => (
                <span key={tag} className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-brand-50 text-brand-600 border border-brand-100">
                  {tag}
                </span>
              ))}
            </div>
          )}

          <a href={vcardHref} download={`${contact.name.replace(/\s+/g, '_')}.vcf`}
            className="block w-full text-center py-3 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-sm transition-colors">
            Save to Contacts
          </a>

          <p className="text-center text-[10px] text-gray-400">
            Powered by DoppelDash · Doppelmayr India
          </p>
        </div>
      </div>
    </div>
  )
}
