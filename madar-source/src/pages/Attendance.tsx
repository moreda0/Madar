import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { ask, useStore, useUI } from '../lib/store'
import { roleIn, useMyCompanies, useUserMap } from '../lib/access'
import type { CheckMethod, Company } from '../lib/types'
import { fmtDay, fmtDuration, fmtShortDate, fmtTime, haversine, isToday, minutesBetween, parseHM } from '../lib/utils'
import { Avatar, CompanyTag, Overlay } from '../components/ui'
import { Icon } from '../components/Icon'

export const qrPayload = (c: Company) => `MADAR:${c.id}:${c.qrSecret}`
export const shortCode = (c: Company) => c.qrSecret.slice(0, 6).toUpperCase()

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('الجهاز ده مش بيدعم تحديد الموقع'))
    navigator.geolocation.getCurrentPosition(res, (e) => rej(new Error(e.code === 1 ? 'محتاجين إذن الموقع عشان نسجل الحضور' : 'مش قادرين نحدد موقعك، جربي تاني')), {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    })
  })
}

export function Attendance() {
  const me = useStore((s) => s.currentUserId)!
  const attendance = useStore((s) => s.attendance)
  const memberships = useStore((s) => s.memberships)
  const tasks = useStore((s) => s.tasks)
  const checkIn = useStore((s) => s.checkIn)
  const checkOut = useStore((s) => s.checkOut)
  const updateTask = useStore((s) => s.updateTask)
  const toast = useUI((s) => s.toast)
  const filter = useUI((s) => s.companyFilter)
  const companies = useMyCompanies()
  const users = useUserMap()
  const [companyId, setCompanyId] = useState<string>(() => (filter !== 'all' ? filter : companies[0]?.id ?? ''))
  useEffect(() => { if (filter !== 'all') setCompanyId(filter) }, [filter])
  const company = companies.find((c) => c.id === companyId) ?? companies[0]

  const [method, setMethod] = useState<CheckMethod>('gps')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [scanOpen, setScanOpen] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  const [outOpen, setOutOpen] = useState(false)
  const [, tick] = useState(0)
  useEffect(() => { const h = setInterval(() => tick((x) => x + 1), 30000); return () => clearInterval(h) }, [])

  const myTasks = useMemo(
    () => tasks.filter((t) => company && t.companyId === company.id && t.assigneeId === me && t.status !== 'done'),
    [tasks, company, me],
  )
  const suggested = useMemo(
    () => myTasks.filter((t) => !t.dueAt || new Date(t.dueAt) <= new Date(Date.now() + 864e5)).map((t) => t.id),
    [myTasks],
  )
  const [plan, setPlan] = useState<string[] | null>(null)
  const planned = plan ?? suggested

  if (!company)
    return <div className="card"><p className="soft">ضيفي شركة الأول من الهيكل التنظيمي عشان تقدري تسجلي حضور.</p></div>

  const role = roleIn(memberships, me, company.id)
  const open = attendance.find((a) => a.userId === me && a.companyId === company.id && !a.checkOutAt && isToday(a.checkInAt))
  const history = attendance.filter((a) => a.userId === me).sort((a, b) => +new Date(b.checkInAt) - +new Date(a.checkInAt)).slice(0, 10)

  const finishCheckIn = (rec: { method: CheckMethod; location?: { lat: number; lng: number; accuracy?: number }; distanceM?: number; insideFence?: boolean }) => {
    const now = new Date()
    const late = now > new Date(parseHM(company.workStart).getTime() + company.graceMinutes * 60000)
    checkIn({ userId: me, companyId: company.id, checkInAt: now.toISOString(), late, plannedTaskIds: planned, ...rec })
    toast({ title: late ? 'اتسجل حضورك (متأخر شوية)' : 'اتسجل حضورك، يوم موفق!', body: `${company.short} · ${planned.length} مهام في خطة اليوم`, tone: late ? 'warn' : 'ok' })
    setPlan(null)
  }

  const doGps = async () => {
    setBusy(true)
    setError('')
    try {
      const pos = await getPosition()
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) }
      if (company.geofence) {
        const d = haversine(here, company.geofence)
        const inside = d <= company.geofence.radius + Math.min(here.accuracy ?? 0, 100)
        if (!inside && company.strictGeofence) {
          setError(`إنتي بعيدة عن ${company.geofence.label || 'مقر الشركة'} بحوالي ${d} متر. لازم تكوني جوه ${company.geofence.radius} متر.`)
          return
        }
        finishCheckIn({ method: 'gps', location: here, distanceM: d, insideFence: inside })
        if (!inside) toast({ title: 'اتسجل الحضور من برة المقر', body: `على بعد ${d} متر، والمدير هيشوف ده`, tone: 'warn' })
      } else {
        finishCheckIn({ method: 'gps', location: here })
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const onScanned = (text: string) => {
    const v = text.trim()
    const ok = v === qrPayload(company) || v.toUpperCase() === shortCode(company)
    if (!ok) {
      setError('الكود ده مش بتاع الشركة دي أو اتغير. اطلبي الكود الجديد من المدير.')
      return false
    }
    setScanOpen(false)
    setError('')
    finishCheckIn({ method: 'qr' })
    return true
  }

  const team = memberships.filter((m) => m.companyId === company.id)
  const workedMins = open ? minutesBetween(open.checkInAt, new Date()) : 0
  const plannedTasks = open ? tasks.filter((t) => open.plannedTaskIds.includes(t.id)) : []

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head">
        {companies.length > 1 && (
          <select className="select" style={{ width: 'auto' }} value={company.id} onChange={(e) => setCompanyId(e.target.value)} aria-label="الشركة">
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <span className="muted">مواعيد العمل <span className="num">{company.workStart} - {company.workEnd}</span></span>
        <span className="spacer" />
        {role === 'admin' && <button className="btn sm" onClick={() => setQrOpen(true)}><Icon name="qr" size={16} /> كود الحضور للشركة</button>}
      </div>

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div className="card stack" style={{ alignItems: 'center', textAlign: 'center', gap: 14 }}>
          {!open ? (
            <>
              <div className="seg" role="group" aria-label="طريقة التسجيل">
                <button className={method === 'gps' ? 'on' : ''} aria-pressed={method === 'gps'} onClick={() => setMethod('gps')}><Icon name="gps" size={16} /> بالموقع</button>
                <button className={method === 'qr' ? 'on' : ''} aria-pressed={method === 'qr'} onClick={() => setMethod('qr')}><Icon name="qr" size={16} /> بكود QR</button>
              </div>
              <button className="big-check" disabled={busy} onClick={() => (method === 'gps' ? doGps() : setScanOpen(true))}>
                <span>
                  <Icon name={method === 'gps' ? 'pin' : 'qr'} size={34} stroke={2} style={{ display: 'block', margin: '0 auto 6px' }} />
                  {busy ? 'بنحدد موقعك…' : 'سجلي حضور'}
                </span>
              </button>
              <div className="soft" style={{ fontSize: 13 }}>
                {method === 'gps'
                  ? company.geofence ? `هنتأكد إنك في ${company.geofence.label || 'المقر'} (نطاق ${company.geofence.radius} متر)` : 'هنسجل موقعك الحالي مع الحضور'
                  : 'امسحي الكود المتعلق في الشركة أو اكتبيه'}
              </div>
              {error && <div className="tone-late" style={{ fontSize: 14 }} role="alert">{error}</div>}
            </>
          ) : (
            <>
              <CompanyTag company={company} />
              <div style={{ fontFamily: 'var(--display)', fontSize: 40, fontWeight: 700 }} className="num">{fmtDuration(workedMins)}</div>
              <div className="soft">حاضرة من <span className="num">{fmtTime(open.checkInAt)}</span> · {open.method === 'qr' ? 'بالكود' : 'بالموقع'}{open.late ? ' · متأخر' : ''}</div>
              <button className="big-check out" onClick={() => setOutOpen(true)}>
                <span><Icon name="logout" size={34} stroke={2} style={{ display: 'block', margin: '0 auto 6px' }} />سجلي انصراف</span>
              </button>
            </>
          )}
        </div>

        <div className="card stack">
          <div className="card-head" style={{ marginBottom: 4 }}>
            <h3>{open ? 'خطة النهارده' : 'هتشتغلي على إيه النهارده؟'}</h3>
            <span className="spacer" />
            <span className="num muted">{open ? `${plannedTasks.filter((t) => t.status === 'done').length}/${plannedTasks.length}` : planned.length}</span>
          </div>
          {!open && myTasks.length === 0 && <span className="muted" style={{ fontSize: 14 }}>مفيش مهام مفتوحة عليكي في {company.short}</span>}
          {!open && myTasks.map((t) => {
            const on = planned.includes(t.id)
            return (
              <label key={t.id} className="row" style={{ cursor: 'pointer', padding: '6px 0' }}>
                <input type="checkbox" checked={on} onChange={() => setPlan(on ? planned.filter((x) => x !== t.id) : [...planned, t.id])} style={{ width: 20, height: 20, accentColor: company.color }} />
                <span style={{ flex: 1 }}>{t.title}</span>
                {t.dueAt && <span className="num muted" style={{ fontSize: 12 }}>{isToday(t.dueAt) ? fmtTime(t.dueAt) : fmtShortDate(t.dueAt)}</span>}
              </label>
            )
          })}
          {open && plannedTasks.length === 0 && <span className="muted" style={{ fontSize: 14 }}>ما اخترتيش مهام مع الحضور</span>}
          {open && plannedTasks.map((t) => (
            <div key={t.id} className="row">
              <button className={`check ${t.status === 'done' ? 'on' : ''}`} aria-pressed={t.status === 'done'} aria-label={t.title} onClick={() => updateTask(t.id, { status: t.status === 'done' ? 'doing' : 'done' }, me)}>
                {t.status === 'done' && <Icon name="check" size={15} stroke={2.6} />}
              </button>
              <span style={{ flex: 1, textDecoration: t.status === 'done' ? 'line-through' : 'none', color: t.status === 'done' ? 'var(--muted)' : undefined }}>{t.title}</span>
            </div>
          ))}
          {!open && <div className="muted" style={{ fontSize: 12 }}>المهام دي هتتربط بيوم الحضور، وفي الانصراف هنوريكي خلصتي منها كام.</div>}
        </div>
      </div>

      {role && role !== 'employee' && (
        <div className="card">
          <div className="card-head"><h3>الفريق النهارده · {company.short}</h3></div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>الاسم</th><th>الحالة</th><th>الحضور</th><th>الانصراف</th><th>الطريقة</th><th>خطة اليوم</th></tr></thead>
              <tbody>
                {team.map((m) => {
                  const r = attendance.find((a) => a.userId === m.userId && a.companyId === company.id && isToday(a.checkInAt))
                  const done = r ? tasks.filter((t) => r.plannedTaskIds.includes(t.id) && t.status === 'done').length : 0
                  const st = !r ? { t: 'لسه', c: 'var(--muted)' } : r.checkOutAt ? { t: 'انصرف', c: 'var(--soft)' } : r.late ? { t: 'متأخر', c: 'var(--amber)' } : { t: 'حاضر', c: 'var(--green-2)' }
                  return (
                    <tr key={m.userId}>
                      <td><span className="row" style={{ gap: 8 }}><Avatar user={users[m.userId]} size="sm" />{users[m.userId]?.name}</span></td>
                      <td style={{ color: st.c }}>{st.t}{r && r.insideFence === false ? ' · برة المقر' : ''}</td>
                      <td className="num">{r ? fmtTime(r.checkInAt) : '—'}</td>
                      <td className="num">{r?.checkOutAt ? fmtTime(r.checkOutAt) : '—'}</td>
                      <td>{r ? (r.method === 'qr' ? 'كود' : r.method === 'gps' ? 'موقع' : 'يدوي') : '—'}</td>
                      <td className="num">{r ? `${done}/${r.plannedTaskIds.length}` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="card">
          <div className="card-head"><h3>سجلي</h3></div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>اليوم</th><th>الشركة</th><th>من</th><th>لـ</th><th>المدة</th></tr></thead>
              <tbody>
                {history.map((a) => (
                  <tr key={a.id}>
                    <td>{fmtDay(a.checkInAt)}</td>
                    <td><CompanyTag company={companies.find((c) => c.id === a.companyId)} /></td>
                    <td className="num" style={{ color: a.late ? 'var(--amber)' : undefined }}>{fmtTime(a.checkInAt)}</td>
                    <td className="num">{a.checkOutAt ? fmtTime(a.checkOutAt) : 'لسه'}</td>
                    <td className="num">{fmtDuration(minutesBetween(a.checkInAt, a.checkOutAt ?? new Date()))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {scanOpen && <ScanModal onClose={() => setScanOpen(false)} onCode={onScanned} error={error} />}
      {qrOpen && <QrModal company={company} onClose={() => setQrOpen(false)} />}
      {outOpen && open && (
        <CheckoutModal
          planned={plannedTasks.length}
          done={plannedTasks.filter((t) => t.status === 'done').length}
          mins={workedMins}
          onClose={() => setOutOpen(false)}
          onConfirm={(note) => {
            checkOut(open.id, note)
            setOutOpen(false)
            toast({ title: 'اتسجل الانصراف', body: `اشتغلتي ${fmtDuration(workedMins)}`, tone: 'ok' })
          }}
        />
      )}
    </div>
  )
}

function CheckoutModal({ planned, done, mins, onClose, onConfirm }: { planned: number; done: number; mins: number; onClose: () => void; onConfirm: (note?: string) => void }) {
  const [note, setNote] = useState('')
  return (
    <Overlay onClose={onClose} label="تسجيل انصراف">
      <div className="stack" style={{ gap: 16 }}>
        <h2>ملخص يومك</h2>
        <div className="grid grid-3" style={{ gap: 10 }}>
          <div className="card stat" style={{ padding: 14 }}><span className="v">{fmtDuration(mins)}</span><span className="l">مدة الشغل</span></div>
          <div className="card stat" style={{ padding: 14 }}><span className="v" style={{ color: 'var(--green-2)' }}>{done}</span><span className="l">مهام خلصت</span></div>
          <div className="card stat" style={{ padding: 14 }}><span className="v">{planned - done}</span><span className="l">لسه من الخطة</span></div>
        </div>
        <label className="field">
          <span>ملاحظة لمديرك (اختياري)</span>
          <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً: العقد مستني توقيع المورد" />
        </label>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onClose}>لسه</button>
          <button className="btn primary" onClick={() => onConfirm(note.trim() || undefined)}>سجلي الانصراف</button>
        </div>
      </div>
    </Overlay>
  )
}

function QrModal({ company, onClose }: { company: Company; onClose: () => void }) {
  const [src, setSrc] = useState('')
  const rotate = useStore((s) => s.rotateQr)
  useEffect(() => {
    QRCode.toDataURL(qrPayload(company), { width: 440, margin: 1, color: { dark: '#070A14', light: '#FFFFFF' } }).then(setSrc)
  }, [company])
  return (
    <Overlay onClose={onClose} label="كود الحضور">
      <div className="stack" style={{ alignItems: 'center', textAlign: 'center', gap: 14 }}>
        <div className="row" style={{ width: '100%' }}>
          <h2>كود حضور {company.short}</h2>
          <span className="spacer" />
          <button className="btn ghost icon" onClick={onClose} aria-label="إغلاق"><Icon name="close" /></button>
        </div>
        <div className="qr-box">{src && <img src={src} alt={`كود QR لحضور ${company.name}`} />}</div>
        <div className="soft">أو الكود اليدوي</div>
        <div className="num" style={{ fontSize: 30, letterSpacing: 6, fontWeight: 700 }}>{shortCode(company)}</div>
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>اطبعيه وعلقيه عند الباب، أو اعرضيه على شاشة. لو حد صوّره وبعته لحد برة، غيّري الكود.</p>
        <div className="row">
          <a className="btn" href={src} download={`madar-qr-${company.short}.png`}><Icon name="download" size={18} /> نزّلي الصورة</a>
          <button className="btn danger" onClick={async () => (await ask('الكود القديم هيبطل يشتغل. كمّلي؟')) && rotate(company.id)}><Icon name="refresh" size={18} /> غيّري الكود</button>
        </div>
      </div>
    </Overlay>
  )
}

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> }

function ScanModal({ onClose, onCode, error }: { onClose: () => void; onCode: (v: string) => boolean; error: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [manual, setManual] = useState('')
  const [camErr, setCamErr] = useState('')
  const supported = 'BarcodeDetector' in window
  const onCodeRef = useRef(onCode)
  onCodeRef.current = onCode

  useEffect(() => {
    if (!supported) return
    let stream: MediaStream | null = null
    let raf = 0
    let stopped = false
    const Ctor = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => Detector }).BarcodeDetector
    const detector = new Ctor({ formats: ['qr_code'] })
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        stream = s
        const v = videoRef.current
        if (!v || stopped) return
        v.srcObject = s
        v.play()
        const loop = async () => {
          if (stopped) return
          try {
            const codes = await detector.detect(v)
            if (codes[0] && onCodeRef.current(codes[0].rawValue)) return
          } catch { /* frame not ready */ }
          raf = window.setTimeout(loop, 350)
        }
        loop()
      })
      .catch(() => setCamErr('مش قادرين نفتح الكاميرا. اكتبي الكود بإيدك.'))
    return () => {
      stopped = true
      clearTimeout(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [supported])

  return (
    <Overlay onClose={onClose} label="امسحي كود الحضور">
      <div className="stack" style={{ gap: 14 }}>
        <div className="row">
          <h2>امسحي كود الحضور</h2>
          <span className="spacer" />
          <button className="btn ghost icon" onClick={onClose} aria-label="إغلاق"><Icon name="close" /></button>
        </div>
        {supported && !camErr ? (
          <div className="scanner"><video ref={videoRef} playsInline muted /></div>
        ) : (
          <div className="muted" style={{ fontSize: 14 }}>{camErr || 'المتصفح ده مش بيقرا QR بالكاميرا، اكتبي الكود اللي تحت الصورة.'}</div>
        )}
        <form className="row" onSubmit={(e) => { e.preventDefault(); onCode(manual) }}>
          <input className="input num" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="الكود (6 حروف)" aria-label="الكود اليدوي" style={{ letterSpacing: 3 }} />
          <button className="btn primary" disabled={!manual.trim()}>تأكيد</button>
        </form>
        {error && <div className="tone-late" role="alert" style={{ fontSize: 14 }}>{error}</div>}
      </div>
    </Overlay>
  )
}
