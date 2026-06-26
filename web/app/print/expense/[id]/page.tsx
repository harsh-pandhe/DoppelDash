'use client'
// Print-ready Travel Expense Sheet — mirrors the client's official xlsx layout:
// Doppelmayr header, claimant block, categorized sections (Tickets/Fare, Stay, F&B,
// Per Diem, Local Conveyance), Summary + Grand Total + Balance, signature rows.
// QR code per receipt links to the uploaded proof. Renders standalone (no app chrome)
// so the browser's Print → Save as PDF gives a clean A4 sheet.
import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Printer, ArrowLeft, Loader2 } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import Link from 'next/link'

interface LineItem {
  _id?: string; description: string; amount: number; date: string
  receiptUrl?: string; category?: string; status?: string; reviewNote?: string
}
interface Expense {
  _id: string; userId: string; userName: string
  title: string; reason: string; amount: number
  travelFrom?: string; travelTo?: string
  startDate: string; endDate?: string
  lineItems?: LineItem[]; hasLineItems?: boolean
  receipts: string[]; status: string
  paymentMethod?: string; paidAt?: string
  approvedBy?: string
  createdAt: string
}
interface DirEntry { clerkUserId: string; designation?: string; department?: string; employeeId?: string }

const SECTIONS: { key: string; label: string; match: (cat: string) => boolean }[] = [
  { key: 'tickets',    label: 'Tickets / Fare',     match: c => /flight|train|bus|ticket|fare|air|rail/.test(c) },
  { key: 'stay',       label: 'Stay',               match: c => /hotel|stay|accommodation|lodge/.test(c) },
  { key: 'food',       label: 'Food & Beverages',   match: c => /food|meal|f&b|fnb|beverage|dining/.test(c) },
  { key: 'perdiem',    label: 'Per Diem',           match: c => /per.?diem|allowance/.test(c) },
  { key: 'conveyance', label: 'Local Conveyance',   match: c => /taxi|cab|auto|conveyance|transport|local|uber|ola/.test(c) },
  { key: 'other',      label: 'Other Expenses',     match: () => true },   // catch-all, evaluated last
]

const inr = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dmy = (d?: string) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''

function absoluteUrl(url: string) {
  if (/^https?:\/\//.test(url)) return url
  if (typeof window !== 'undefined') return `${window.location.origin}${url.startsWith('/') ? '' : '/'}${url}`
  return url
}

function SectionTable({ label, items, startSl }: { label: string; items: LineItem[]; startSl: number }) {
  if (!items.length) return null
  const subtotal = items.reduce((s, it) => s + (it.amount || 0), 0)
  return (
    <div className="section">
      <div className="section-title">{label}</div>
      <table>
        <thead>
          <tr>
            <th style={{ width: '6%' }}>Sl. No.</th>
            <th style={{ width: '14%' }}>Date</th>
            <th>Description</th>
            <th style={{ width: '14%' }} className="num">Amount (₹)</th>
            <th style={{ width: '12%' }}>Bill / Proof</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={it._id || i}>
              <td className="center">{startSl + i}</td>
              <td>{dmy(it.date)}</td>
              <td>{it.description}{it.reviewNote ? <span className="note"> — {it.reviewNote}</span> : null}</td>
              <td className="num">{inr(it.amount || 0)}</td>
              <td className="center">
                {it.receiptUrl ? (
                  <a href={it.receiptUrl} target="_blank" rel="noreferrer" title="Open receipt">
                    <QRCodeSVG value={absoluteUrl(it.receiptUrl)} size={42} marginSize={0} />
                  </a>
                ) : <span className="note">—</span>}
              </td>
            </tr>
          ))}
          <tr className="subtotal">
            <td colSpan={3} className="num strong">Subtotal</td>
            <td className="num strong">{inr(subtotal)}</td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export default function ExpensePrintPage() {
  const { id } = useParams<{ id: string }>()
  const [expense, setExpense] = useState<Expense | null>(null)
  const [emp, setEmp] = useState<DirEntry | null>(null)
  const [error, setError] = useState('')
  const [pdfBusy, setPdfBusy] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)

  // Render the expense sheet DOM to a real A4 PDF download (no browser print dialog).
  const downloadPdf = async () => {
    if (!sheetRef.current || pdfBusy) return
    setPdfBusy(true)
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ])
      const canvas = await html2canvas(sheetRef.current, { scale: 2, backgroundColor: '#ffffff', useCORS: true })
      const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
      const pageW = pdf.internal.pageSize.getWidth()
      const pageH = pdf.internal.pageSize.getHeight()
      const imgW = pageW
      const imgH = (canvas.height * imgW) / canvas.width
      const img = canvas.toDataURL('image/jpeg', 0.95)
      let pos = 0
      let remaining = imgH
      // Slice the tall canvas across A4 pages.
      while (remaining > 0) {
        pdf.addImage(img, 'JPEG', 0, pos, imgW, imgH)
        remaining -= pageH
        if (remaining > 0) { pdf.addPage(); pos -= pageH }
      }
      const ref = expense ? `EXP-${expense._id.slice(-6).toUpperCase()}` : 'expense'
      pdf.save(`${ref}.pdf`)
    } catch {
      // Fallback to the browser print dialog if rasterization fails.
      window.print()
    } finally { setPdfBusy(false) }
  }

  useEffect(() => {
    fetch(`/api/rms/${id}`).then(async r => {
      if (!r.ok) throw new Error('Could not load this expense (check you are signed in and have access).')
      const e: Expense = await r.json()
      setExpense(e)
      // Claimant details (designation / dept / employee code) from the directory
      fetch('/api/employees/directory').then(r2 => r2.ok ? r2.json() : [])
        .then((dir: DirEntry[]) => setEmp(dir.find?.(d => d.clerkUserId === e.userId) || null))
        .catch(() => {})
    }).catch(e => setError(e.message))
  }, [id])

  if (error) return (
    <div style={{ padding: 40, fontFamily: 'sans-serif' }}>
      <p style={{ color: '#dc2626' }}>{error}</p>
      <Link href="/rms" style={{ color: '#0057A8' }}>← Back to Reimbursements</Link>
    </div>
  )
  if (!expense) return (
    <div style={{ padding: 40, display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'sans-serif', color: '#6b7280' }}>
      <Loader2 className="spin" style={{ width: 18, height: 18 }} /> Preparing expense sheet…
    </div>
  )

  // Bucket line items into sheet sections (first match wins; 'other' catches the rest)
  const items = expense.lineItems || []
  const buckets: Record<string, LineItem[]> = Object.fromEntries(SECTIONS.map(s => [s.key, []]))
  for (const it of items) {
    const cat = (it.category || '').toLowerCase()
    const section = SECTIONS.find(s => s.key !== 'other' && s.match(cat)) || SECTIONS[SECTIONS.length - 1]
    buckets[section.key].push(it)
  }
  const sectionTotals = SECTIONS.map(s => ({
    label: s.label,
    total: buckets[s.key].reduce((sum, it) => sum + (it.amount || 0), 0),
    count: buckets[s.key].length,
  }))
  const grandTotal = items.length ? sectionTotals.reduce((s, t) => s + t.total, 0) : expense.amount
  const paid = expense.status === 'paid'
  let sl = 1

  return (
    <div className="sheet-wrap">
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; background: #e5e7eb; }
        .sheet-wrap { font-family: Arial, Helvetica, sans-serif; color: #111827; padding: 24px 12px; }
        .toolbar { max-width: 880px; margin: 0 auto 14px; display: flex; gap: 10px; justify-content: space-between; align-items: center; }
        .toolbar a, .toolbar button {
          display: inline-flex; align-items: center; gap: 7px; padding: 9px 16px; border-radius: 10px;
          font-size: 13px; font-weight: 600; cursor: pointer; text-decoration: none; border: 1px solid #d1d5db; background: #fff; color: #374151;
        }
        .toolbar button.primary { background: #0057A8; border-color: #0057A8; color: #fff; }
        .sheet { max-width: 880px; margin: 0 auto; background: #fff; padding: 36px 40px; box-shadow: 0 2px 12px rgba(0,0,0,.12); }
        .brand { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #0057A8; padding-bottom: 14px; }
        .brand h1 { font-size: 20px; margin: 0; color: #0057A8; letter-spacing: .3px; }
        .brand .sub { font-size: 12px; color: #4b5563; margin-top: 3px; }
        .brand .logo { display: flex; align-items: center; gap: 10px; }
        .brand .logo-box { width: 44px; height: 44px; border-radius: 10px; background: #0057A8; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 900; }
        .doc-title { text-align: center; font-size: 16px; font-weight: 800; margin: 16px 0 4px; text-transform: uppercase; letter-spacing: 1px; }
        .doc-status { text-align: center; font-size: 11px; margin-bottom: 14px; color: ${paid ? '#16a34a' : '#b45309'}; font-weight: 700; text-transform: uppercase; }
        .claimant { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 28px; font-size: 12.5px; border: 1px solid #d1d5db; border-radius: 8px; padding: 12px 16px; margin-bottom: 18px; }
        .claimant div { display: flex; gap: 6px; }
        .claimant .k { color: #6b7280; min-width: 120px; }
        .claimant .v { font-weight: 700; }
        .section { margin-bottom: 16px; }
        .section-title { font-size: 13px; font-weight: 800; color: #0057A8; border-left: 4px solid #0057A8; padding-left: 8px; margin-bottom: 6px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th, td { border: 1px solid #d1d5db; padding: 5px 8px; text-align: left; vertical-align: middle; }
        th { background: #eff6ff; font-size: 10.5px; text-transform: uppercase; letter-spacing: .4px; color: #374151; }
        td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
        td.center { text-align: center; }
        .strong { font-weight: 700; }
        .subtotal td { background: #f9fafb; }
        .note { color: #6b7280; font-size: 11px; }
        .summary { margin-top: 20px; display: flex; justify-content: flex-end; }
        .summary table { width: 320px; }
        .grand td { background: #eff6ff; font-weight: 800; font-size: 13px; }
        .signs { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 32px; margin-top: 56px; }
        .signs .slot { text-align: center; font-size: 12px; font-weight: 700; }
        .signs .line { border-top: 1.5px solid #111827; margin-bottom: 6px; padding-top: 6px; }
        .footer { margin-top: 28px; font-size: 10px; color: #9ca3af; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 8px; }
        .spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }
        @media print {
          body { background: #fff; }
          .sheet-wrap { padding: 0; }
          .toolbar { display: none; }
          .sheet { box-shadow: none; max-width: none; padding: 8mm 10mm; }
          .section { break-inside: avoid; }
          .signs { break-inside: avoid; }
          @page { size: A4; margin: 10mm; }
        }
      `}</style>

      {/* Screen-only toolbar */}
      <div className="toolbar">
        <Link href={`/rms/${id}`}><ArrowLeft style={{ width: 15, height: 15 }} /> Back to expense</Link>
        <button type="button" className="primary" onClick={downloadPdf} disabled={pdfBusy}>
          {pdfBusy
            ? <><Loader2 className="spin" style={{ width: 15, height: 15 }} /> Generating…</>
            : <><Printer style={{ width: 15, height: 15 }} /> Download PDF</>}
        </button>
      </div>

      <div className="sheet" ref={sheetRef}>
        {/* Brand header */}
        <div className="brand">
          <div className="logo">
            <div className="logo-box">D</div>
            <div>
              <h1>Doppelmayr India Private Limited</h1>
              <p className="sub">Urban ropeways &amp; cable car systems</p>
            </div>
          </div>
          <div style={{ textAlign: 'right', fontSize: 12, color: '#4b5563' }}>
            <div>Date: <strong>{dmy(new Date().toISOString())}</strong></div>
            <div>Ref: <strong>EXP-{expense._id.slice(-6).toUpperCase()}</strong></div>
          </div>
        </div>

        <div className="doc-title">Travel Expense Sheet</div>
        <div className="doc-status">{paid ? '✓ Paid' : expense.status.replace(/_/g, ' ')}</div>

        {/* Claimant block */}
        <div className="claimant">
          <div><span className="k">Name of Claimant:</span><span className="v">{expense.userName}</span></div>
          <div><span className="k">Designation:</span><span className="v">{emp?.designation || '—'}</span></div>
          <div><span className="k">Department:</span><span className="v">{emp?.department || '—'}</span></div>
          <div><span className="k">Employee Code:</span><span className="v">{emp?.employeeId || '—'}</span></div>
          <div><span className="k">Purpose:</span><span className="v">{expense.title}</span></div>
          <div><span className="k">Travel:</span><span className="v">{expense.travelFrom || '—'}{expense.travelTo ? ` → ${expense.travelTo}` : ''}</span></div>
          <div><span className="k">Period:</span><span className="v">{dmy(expense.startDate)}{expense.endDate ? ` – ${dmy(expense.endDate)}` : ''}</span></div>
          <div><span className="k">Submitted:</span><span className="v">{dmy(expense.createdAt)}</span></div>
        </div>

        {/* Sections */}
        {items.length > 0 ? (
          SECTIONS.map(s => {
            const secItems = buckets[s.key]
            const start = sl; sl += secItems.length
            return <SectionTable key={s.key} label={s.label} items={secItems} startSl={start} />
          })
        ) : (
          <div className="section">
            <div className="section-title">Expense</div>
            <table>
              <thead>
                <tr><th style={{ width: '6%' }}>Sl. No.</th><th style={{ width: '14%' }}>Date</th><th>Description</th><th style={{ width: '14%' }} className="num">Amount (₹)</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td className="center">1</td>
                  <td>{dmy(expense.startDate)}</td>
                  <td>{expense.title} — {expense.reason}</td>
                  <td className="num">{inr(expense.amount)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Legacy top-level receipts as a QR strip */}
        {!items.some(i => i.receiptUrl) && expense.receipts?.length > 0 && (
          <div className="section">
            <div className="section-title">Receipts &amp; Proofs</div>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', padding: '6px 2px' }}>
              {expense.receipts.map((url, i) => (
                <div key={i} style={{ textAlign: 'center', fontSize: 10, color: '#6b7280' }}>
                  <a href={url} target="_blank" rel="noreferrer"><QRCodeSVG value={absoluteUrl(url)} size={56} marginSize={1} /></a>
                  <div>Receipt {i + 1}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Summary */}
        <div className="summary">
          <table>
            <thead><tr><th>Summary</th><th className="num">INR</th></tr></thead>
            <tbody>
              {items.length > 0 && sectionTotals.filter(t => t.count > 0).map(t => (
                <tr key={t.label}><td>{t.label}</td><td className="num">{inr(t.total)}</td></tr>
              ))}
              <tr className="grand"><td>Grand Total</td><td className="num">₹ {inr(grandTotal)}</td></tr>
              <tr><td>Paid Amount</td><td className="num">{paid ? `₹ ${inr(grandTotal)}` : '—'}</td></tr>
              <tr><td className="strong">Balance Payment</td><td className="num strong">{paid ? '₹ 0.00' : `₹ ${inr(grandTotal)}`}</td></tr>
            </tbody>
          </table>
        </div>

        {/* Signature rows */}
        <div className="signs">
          <div className="slot"><div className="line" />Signature of Claimant</div>
          <div className="slot"><div className="line" />Checked by</div>
          <div className="slot"><div className="line" />Approved by</div>
        </div>

        <div className="footer">
          Generated by DoppelDash · Doppelmayr India Private Limited · Scan QR codes to view uploaded bills/receipts
        </div>
      </div>
    </div>
  )
}
