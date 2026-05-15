// Public contact card — no auth required.
// Accessible via /contact/[id] or via QR. Queries DB directly (no HTTP hop).
import { Mail, Phone, Building2, Building, Download } from 'lucide-react'
import { connectDB } from '@/lib/db'
import Contact from '@/models/Contact'

interface PublicContact {
  _id: string; name: string; email?: string; phone?: string
  company?: string; designation?: string; photo?: string
  tags?: string[]; website?: string
}

async function getContact(id: string): Promise<PublicContact | null> {
  try {
    await connectDB()
    const doc = await Contact.findById(id,
      'name email phone company designation photo tags'
    ).lean()
    if (!doc) return null
    const c = doc as unknown as PublicContact & { _id: { toString(): string } }
    return {
      _id:         c._id.toString(),
      name:        c.name,
      email:       c.email,
      phone:       c.phone,
      company:     c.company,
      designation: c.designation,
      photo:       c.photo,
      tags:        c.tags,
    }
  } catch { return null }
}

export default async function PublicContactPage({ params }: { params: { id: string } }) {
  const contact = await getContact(params.id)
  if (!contact) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-[#e8f0fa] p-4">
        <div className="text-center bg-white rounded-3xl border border-gray-200 shadow-sm p-8 max-w-sm w-full">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <Building className="w-8 h-8 text-gray-400" />
          </div>
          <p className="font-bold text-gray-900 text-lg">Contact not found</p>
          <p className="text-sm text-gray-500 mt-1">This link may be invalid or expired.</p>
          <p className="text-[10px] text-gray-400 mt-6 uppercase tracking-widest">DoppelDash · Doppelmayr India</p>
        </div>
      </div>
    )
  }

  const displayName = contact.name || 'Unknown Contact'
  const initials = displayName.split(' ').map(w => w[0] || '').join('').toUpperCase().slice(0, 2)
  const safeFileName = displayName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '') || 'contact'

  // vCard 3.0
  const vcard = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${displayName}`,
    contact.company     ? `ORG:${contact.company}`        : '',
    contact.designation ? `TITLE:${contact.designation}`  : '',
    contact.email       ? `EMAIL;TYPE=WORK:${contact.email}` : '',
    contact.phone       ? `TEL;TYPE=CELL:${contact.phone}` : '',
    'END:VCARD',
  ].filter(Boolean).join('\r\n')

  const vcardHref = `data:text/vcard;charset=utf-8,${encodeURIComponent(vcard)}`

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-[#e8f0fa] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden border border-gray-100">

        {/* Header — Doppelmayr blue */}
        <div className="bg-gradient-to-br from-[#003B73] via-[#0057A8] to-[#1d6dc2] px-6 pt-6 pb-6 text-white text-center relative overflow-hidden">
          <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-white/10 pointer-events-none" />
          <div className="absolute -bottom-16 -left-16 w-40 h-40 rounded-full bg-white/5 pointer-events-none" />
          <p className="relative text-[10px] font-bold tracking-[0.2em] text-white/70 uppercase mb-3">DoppelDash · Contact</p>
          {contact.photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={contact.photo} alt={displayName}
              className="relative w-24 h-24 rounded-2xl object-cover mx-auto mb-3 border-4 border-white/30 shadow-lg" />
          ) : (
            <div className="relative w-24 h-24 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center mx-auto mb-3 border-4 border-white/30 shadow-lg">
              <span className="text-3xl font-extrabold text-white">{initials}</span>
            </div>
          )}
          <h1 className="relative text-xl font-extrabold tracking-tight">{displayName}</h1>
          {contact.designation && <p className="relative text-sm text-white/85 mt-0.5">{contact.designation}</p>}
          {contact.company && (
            <p className="relative text-xs text-white/75 mt-1.5 flex items-center justify-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" /> {contact.company}
            </p>
          )}
        </div>

        {/* Contact rows */}
        <div className="px-5 pt-5 pb-5 space-y-3">
          {(contact.email || contact.phone) && (
            <div className="rounded-2xl border border-gray-100 overflow-hidden divide-y divide-gray-50">
              {contact.email && (
                <a href={`mailto:${contact.email}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-[#e8f0fa] transition-colors">
                  <div className="w-10 h-10 rounded-xl bg-[#e8f0fa] flex items-center justify-center flex-shrink-0">
                    <Mail className="w-4 h-4 text-[#0057A8]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Email</p>
                    <p className="text-sm font-semibold text-gray-900 truncate">{contact.email}</p>
                  </div>
                </a>
              )}
              {contact.phone && (
                <a href={`tel:${contact.phone.replace(/\s+/g, '')}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-emerald-50 transition-colors">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                    <Phone className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Phone</p>
                    <p className="text-sm font-semibold text-gray-900">{contact.phone}</p>
                  </div>
                </a>
              )}
            </div>
          )}

          {contact.tags && contact.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {contact.tags.map(tag => (
                <span key={tag} className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#e8f0fa] text-[#003B73] border border-[#c5dbf2]">
                  {tag}
                </span>
              ))}
            </div>
          )}

          <a href={vcardHref} download={`${safeFileName}.vcf`}
            className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-gradient-to-r from-[#003B73] to-[#0057A8] hover:from-[#0057A8] hover:to-[#1d6dc2] text-white font-bold text-sm transition-all shadow-md shadow-[#0057A8]/25">
            <Download className="w-4 h-4" /> Save to Contacts
          </a>
        </div>

        {/* Footer */}
        <div className="px-5 pb-4 pt-2 border-t border-gray-50">
          <p className="text-center text-[10px] text-gray-400 leading-relaxed">
            Powered by <span className="font-bold text-gray-700">DoppelDash</span>
            <span className="mx-1.5 text-gray-300">·</span>
            Doppelmayr India
          </p>
        </div>

      </div>
    </div>
  )
}
