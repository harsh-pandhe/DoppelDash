'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Plane, Plus, Trash2, ArrowLeft, Loader2, MapPin, IndianRupee, Shield, AlertCircle, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/toast'
import { useFormAutosave } from '@/lib/useFormAutosave'

interface Privileges {
  food:   { tier: string; dailyLimit: number }
  taxi:   { tier: string; perKmLimit: number }
  flight: { tier: string; enabled: boolean }
  hotel:  { tier: string; perNightLimit: number }
  travelAdvance: number
}

type TravelMode = 'train' | 'flight' | 'bus' | 'taxi' | 'own_vehicle' | 'other'

interface Leg {
  from: string; to: string; date: string
  mode: TravelMode; estimatedCost: number; notes: string
}

const MODE_LABELS: Record<TravelMode, string> = {
  train: 'Train', flight: 'Flight', bus: 'Bus',
  taxi: 'Taxi', own_vehicle: 'Own Vehicle', other: 'Other',
}

const EMPTY_LEG = (): Leg => ({ from:'', to:'', date:'', mode:'train', estimatedCost:0, notes:'' })

export default function NewTravelRequestPage() {
  const router = useRouter()
  const toast  = useToast()

  type DraftState = {
    purpose: string; destination: string; departureDate: string; returnDate: string
    legs: Leg[]; advanceReq: number; needHotel: boolean; hotelCity: string; hotelCost: number
  }
  const [draft, setDraft] = useState<DraftState>({
    purpose: '', destination: '', departureDate: '', returnDate: '',
    legs: [EMPTY_LEG()], advanceReq: 0, needHotel: false, hotelCity: '', hotelCost: 0,
  })
  const purpose = draft.purpose, destination = draft.destination
  const departureDate = draft.departureDate, returnDate = draft.returnDate
  const legs = draft.legs, advanceReq = draft.advanceReq
  const needHotel = draft.needHotel, hotelCity = draft.hotelCity, hotelCost = draft.hotelCost

  const setPurpose       = (v: string)  => setDraft(d => ({ ...d, purpose: v }))
  const setDestination   = (v: string)  => setDraft(d => ({ ...d, destination: v }))
  const setDepartureDate = (v: string)  => setDraft(d => ({ ...d, departureDate: v }))
  const setReturnDate    = (v: string)  => setDraft(d => ({ ...d, returnDate: v }))
  const setLegs          = (fn: Leg[] | ((p: Leg[]) => Leg[])) => setDraft(d => ({ ...d, legs: typeof fn === 'function' ? fn(d.legs) : fn }))
  const setAdvanceReq    = (v: number)  => setDraft(d => ({ ...d, advanceReq: v }))
  const setNeedHotel     = (v: boolean) => setDraft(d => ({ ...d, needHotel: v }))
  const setHotelCity     = (v: string)  => setDraft(d => ({ ...d, hotelCity: v }))
  const setHotelCost     = (v: number)  => setDraft(d => ({ ...d, hotelCost: v }))

  const [saving,        setSaving]        = useState(false)
  const [priv,          setPriv]          = useState<Privileges | null>(null)
  const { clear: clearDraft } = useFormAutosave('travel-new', draft, setDraft)

  useEffect(() => {
    fetch('/api/employees/me')
      .then(r => r.json())
      .then(d => { if (d?.privileges) setPriv(d.privileges) })
      .catch(() => {})
  }, [])

  const totalLegs   = legs.reduce((s, l) => s + (l.estimatedCost || 0), 0)
  const totalCost   = totalLegs + (needHotel ? hotelCost : 0)

  const updateLeg = (i: number, field: keyof Leg, value: string | number) =>
    setLegs(prev => prev.map((l, j) => j === i ? { ...l, [field]: value } : l))

  const submit = async () => {
    if (!purpose || !destination || !departureDate || !returnDate) {
      toast('Fill purpose, destination, and dates', 'error'); return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/travel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purpose, destination, departureDate, returnDate,
          legs: legs.filter(l => l.from && l.to),
          estimatedTotal: totalCost,
          advanceRequested: advanceReq,
          accommodation: needHotel ? {
            required: true, city: hotelCity,
            checkIn: departureDate, checkOut: returnDate, estimatedCost: hotelCost,
          } : { required: false },
        }),
      })
      if (!res.ok) { const d = await res.json(); toast(d.error || 'Submit failed', 'error'); return }
      toast('Travel request submitted', 'success')
      clearDraft()
      router.push('/travel')
    } catch { toast('Network error', 'error') }
    finally { setSaving(false) }
  }

  return (
    <>
      <Header title="New Travel Request" />
      <main className="flex-1 p-5 lg:p-8 xl:px-12 max-w-3xl space-y-5 w-full mx-auto bg-surface-2">
        <Link href="/travel" className="inline-flex items-center gap-1.5 text-sm text-surface-muted hover:text-brand-600 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>

        {/* Hero */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#003B73] via-[#0057A8] to-[#1d6dc2] p-6 text-white">
          <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/10 pointer-events-none" />
          <Plane className="w-6 h-6 text-white/70 mb-2 relative z-10" />
          <h2 className="text-xl font-extrabold tracking-tight relative z-10">Travel Request</h2>
          <p className="text-white/80 text-sm relative z-10 mt-1">Submit before your trip for advance and manager approval.</p>
        </div>

        {/* Privilege banner */}
        {priv && (
          <div className="bg-white rounded-2xl border border-surface-border p-4">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="w-4 h-4 text-indigo-500" />
              <p className="text-xs font-bold uppercase tracking-widest text-indigo-700">Your Travel Privileges</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
              {[
                { label: 'Food',   val: priv.food.tier   === 'none' ? 'Not eligible' : `${priv.food.tier} · ₹${priv.food.dailyLimit}/day`,   ok: priv.food.tier !== 'none' },
                { label: 'Taxi',   val: priv.taxi.tier   === 'none' ? 'Not eligible' : `${priv.taxi.tier} · ₹${priv.taxi.perKmLimit}/km`,    ok: priv.taxi.tier !== 'none' },
                { label: 'Flight', val: priv.flight.enabled ? `Allowed (${priv.flight.tier})` : 'Not eligible',                              ok: priv.flight.enabled },
                { label: 'Hotel',  val: priv.hotel.tier  === 'none' ? 'Not eligible' : `${priv.hotel.tier} · ₹${priv.hotel.perNightLimit}/night`, ok: priv.hotel.tier !== 'none' },
                { label: 'Advance',val: priv.travelAdvance > 0 ? `Up to ₹${priv.travelAdvance.toLocaleString('en-IN')}` : 'Not eligible',    ok: priv.travelAdvance > 0 },
              ].map(p => (
                <div key={p.label} className={`p-2 rounded-lg border ${p.ok ? 'bg-indigo-50 border-indigo-200' : 'bg-gray-50 border-gray-200 opacity-60'}`}>
                  <p className="text-[9px] font-bold uppercase tracking-wide text-surface-muted">{p.label}</p>
                  <p className={`text-[11px] font-bold ${p.ok ? 'text-indigo-700' : 'text-gray-500'}`}>{p.val}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Purpose + destination */}
        <div className="bg-white rounded-2xl border border-surface-border p-5 space-y-4">
          <h3 className="text-sm font-bold text-gray-700">Trip Details</h3>
          <div className="space-y-1.5">
            <Label htmlFor="tr-purpose">Purpose of Travel</Label>
            <Input id="tr-purpose" value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="Client meeting at IIT Bombay" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tr-dest">Destination</Label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-muted pointer-events-none" />
              <Input id="tr-dest" className="pl-9" value={destination} onChange={e => setDestination(e.target.value)} placeholder="Mumbai" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tr-dep">Departure Date</Label>
              <input id="tr-dep" type="date" aria-label="Departure date" title="Departure date" value={departureDate} onChange={e => setDepartureDate(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tr-ret">Return Date</Label>
              <input id="tr-ret" type="date" aria-label="Return date" title="Return date" min={departureDate} value={returnDate} onChange={e => setReturnDate(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500" />
            </div>
          </div>
        </div>

        {/* Travel legs */}
        <div className="bg-white rounded-2xl border border-surface-border p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-700">Journey Legs</h3>
            <button type="button" onClick={() => setLegs(l => [...l, EMPTY_LEG()])}
              className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700">
              <Plus className="w-3.5 h-3.5" /> Add leg
            </button>
          </div>

          {legs.map((leg, i) => (
            <div key={i} className="p-4 rounded-xl border border-surface-border space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-surface-muted uppercase tracking-wide">Leg {i + 1}</p>
                {legs.length > 1 && (
                  <button type="button" onClick={() => setLegs(l => l.filter((_,j) => j !== i))} className="text-red-400 hover:text-red-600">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input placeholder="From city" value={leg.from} onChange={e => updateLeg(i,'from',e.target.value)} aria-label={`Leg ${i+1} from`} />
                <Input placeholder="To city"   value={leg.to}   onChange={e => updateLeg(i,'to',e.target.value)} aria-label={`Leg ${i+1} to`} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input type="date" aria-label={`Leg ${i+1} date`} title={`Leg ${i+1} date`} value={leg.date} onChange={e => updateLeg(i,'date',e.target.value)}
                  className="h-10 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500" />
                <select aria-label={`Leg ${i+1} mode`} title={`Leg ${i+1} mode`} value={leg.mode}
                  onChange={e => updateLeg(i,'mode',e.target.value as TravelMode)}
                  className="h-10 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500">
                  {Object.entries(MODE_LABELS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              {priv && leg.mode === 'flight' && !priv.flight.enabled && (
                <p className="flex items-center gap-1 text-[10px] text-amber-600 font-semibold">
                  <AlertCircle className="w-3 h-3"/>Flight not in your privileges — needs special approval
                </p>
              )}
              {priv && leg.mode === 'taxi' && priv.taxi.tier === 'none' && (
                <p className="flex items-center gap-1 text-[10px] text-amber-600 font-semibold">
                  <AlertCircle className="w-3 h-3"/>Taxi not in your privileges
                </p>
              )}
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-surface-muted pointer-events-none" />
                  <Input className="pl-8" type="number" min="0" placeholder="Estimated cost"
                    value={leg.estimatedCost || ''} onChange={e => updateLeg(i,'estimatedCost',Number(e.target.value))} aria-label={`Leg ${i+1} cost`} />
                </div>
                <Input className="flex-1" placeholder="Notes (optional)" value={leg.notes} onChange={e => updateLeg(i,'notes',e.target.value)} aria-label={`Leg ${i+1} notes`} />
              </div>
            </div>
          ))}
        </div>

        {/* Accommodation */}
        <div className="bg-white rounded-2xl border border-surface-border p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-700">Accommodation</h3>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={needHotel} onChange={e => setNeedHotel(e.target.checked)} className="accent-brand-500 w-4 h-4" />
              <span className="text-sm text-gray-700">Need hotel</span>
            </label>
          </div>
          {needHotel && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tr-hotelCity">City</Label>
                <Input id="tr-hotelCity" value={hotelCity} onChange={e => setHotelCity(e.target.value)} placeholder="Mumbai" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tr-hotelCost">Est. Cost (₹) total</Label>
                <Input id="tr-hotelCost" type="number" min="0" value={hotelCost || ''} onChange={e => setHotelCost(Number(e.target.value))} placeholder="0" />
                {priv && priv.hotel.tier === 'none' && hotelCost > 0 && (
                  <p className="flex items-center gap-1 text-[10px] text-amber-600 font-semibold">
                    <AlertCircle className="w-3 h-3"/>Hotel not in your privileges
                  </p>
                )}
                {priv && priv.hotel.perNightLimit > 0 && hotelCost > 0 && departureDate && returnDate && (() => {
                  const nights = Math.max(1, Math.ceil((new Date(returnDate).getTime() - new Date(departureDate).getTime()) / 86400000))
                  const perNight = hotelCost / nights
                  if (perNight > priv.hotel.perNightLimit) return (
                    <p className="flex items-center gap-1 text-[10px] text-red-600 font-semibold">
                      <AlertCircle className="w-3 h-3"/>₹{Math.round(perNight)}/night exceeds your limit (₹{priv.hotel.perNightLimit}/night, {nights} nights)
                    </p>
                  )
                  return <p className="flex items-center gap-1 text-[10px] text-green-600"><CheckCircle2 className="w-3 h-3"/>Within ₹{priv.hotel.perNightLimit}/night limit ({nights} nights)</p>
                })()}
              </div>
            </div>
          )}
        </div>

        {/* Advance + summary */}
        <div className="bg-white rounded-2xl border border-surface-border p-5 space-y-4">
          <h3 className="text-sm font-bold text-gray-700">Summary</h3>
          <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-surface border border-surface-border">
            <span className="text-xs font-bold text-surface-muted uppercase tracking-wide">Estimated Total</span>
            <span className="text-lg font-extrabold text-gray-900">₹{totalCost.toLocaleString('en-IN')}</span>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tr-advance">Advance Requested (₹) <span className="text-surface-muted font-normal">optional</span></Label>
            <div className="relative">
              <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-muted pointer-events-none" />
              <Input id="tr-advance" className="pl-9" type="number" min="0" max={totalCost}
                value={advanceReq || ''} onChange={e => setAdvanceReq(Number(e.target.value))} placeholder="0" />
            </div>
            {priv && advanceReq > priv.travelAdvance && priv.travelAdvance > 0 && (
              <p className="flex items-center gap-1 text-[10px] text-red-600 font-semibold">
                <AlertCircle className="w-3 h-3"/>Exceeds your privilege limit (₹{priv.travelAdvance.toLocaleString('en-IN')})
              </p>
            )}
            {priv && advanceReq > 0 && priv.travelAdvance === 0 && (
              <p className="flex items-center gap-1 text-[10px] text-amber-600 font-semibold">
                <AlertCircle className="w-3 h-3"/>You&apos;re not eligible for advances — request will need boss override
              </p>
            )}
          </div>
        </div>

        <Button className="w-full gap-2 bg-gradient-to-r from-[#003B73] to-[#0057A8] hover:from-[#0057A8] hover:to-[#1d6dc2]" onClick={submit} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plane className="w-4 h-4" />}
          Submit Travel Request
        </Button>
      </main>
    </>
  )
}
