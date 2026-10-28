import { useEffect, useState } from 'react'
import { ask, useStore, useUI } from '../lib/store'
import { useMe } from '../lib/access'
import { requestSystemNotifications } from '../lib/reminders'
import { initialsOf } from '../lib/utils'
import { Avatar } from '../components/ui'
import { Icon } from '../components/Icon'

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let deferredInstall: InstallEvent | null = null
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferredInstall = e as InstallEvent
})

const ROADMAP = [
  { t: 'المرحلة 1 (دي)', d: 'الشركات والهيكل والصلاحيات، المهام بكل أشكالها، التنبيهات والتذكيرات، الحضور بالموقع والكود', on: true },
  { t: 'المرحلة 2', d: 'حساب حقيقي وبيانات على السيرفر (Supabase) تتزامن بين اللابتوب والموبايل والفريق' },
  { t: 'المرحلة 3', d: 'التقييمات، درجة الالتزام الشهرية من 100، التقييم السنوي، الترقيات، ومؤشرات الأداء KPIs' },
  { t: 'المرحلة 4', d: 'مساعد مدار الذكي بالمصري، وتنبيهات واتساب رايح جاي على رقمك' },
]

export function Settings() {
  const me = useMe()!
  const updateUser = useStore((s) => s.updateUser)
  const logout = useStore((s) => s.logout)
  const resetToSample = useStore((s) => s.resetToSample)
  const startFresh = useStore((s) => s.startFresh)
  const toast = useUI((s) => s.toast)
  const [name, setName] = useState(me.name)
  const [phone, setPhone] = useState(me.phone ?? '')
  const [perm, setPerm] = useState<string>(() => ('Notification' in window ? Notification.permission : 'unsupported'))
  const [canInstall, setCanInstall] = useState(!!deferredInstall)
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)

  useEffect(() => {
    const h = () => setCanInstall(true)
    window.addEventListener('beforeinstallprompt', h)
    return () => window.removeEventListener('beforeinstallprompt', h)
  }, [])

  const exportData = () => {
    const s = useStore.getState()
    const data = { users: s.users, companies: s.companies, units: s.units, memberships: s.memberships, tasks: s.tasks, attendance: s.attendance, exportedAt: new Date().toISOString() }
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `madar-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  return (
    <div className="grid grid-2" style={{ alignItems: 'start' }}>
      <form
        className="card stack"
        style={{ gap: 14 }}
        onSubmit={(e) => {
          e.preventDefault()
          updateUser(me.id, { name: name.trim() || me.name, phone: phone.trim() || undefined, initials: initialsOf(name.trim() || me.name) })
          toast({ title: 'اتحفظ', tone: 'ok' })
        }}
      >
        <div className="row"><Avatar user={me} size="lg" /><h2>حسابي</h2></div>
        <label className="field"><span>الاسم</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>رقم الموبايل (للواتساب)</span><input className="input num" dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+20 1xx xxx xxxx" /></label>
        <div className="row">
          <button className="btn primary">احفظي</button>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={logout}><Icon name="logout" size={18} /> خروج</button>
        </div>
      </form>

      <div className="card stack" style={{ gap: 14 }}>
        <h2>على الجهاز</h2>
        <div className="row wrap">
          <Icon name="install" />
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontWeight: 600 }}>نزّلي مدار كتطبيق</div>
            <div className="soft" style={{ fontSize: 13 }}>
              {standalone ? 'مدار متثبت على الجهاز ده' : isIOS ? 'في سفاري: زرار المشاركة ← "إضافة إلى الشاشة الرئيسية"' : canInstall ? 'هيظهر في الشاشة الرئيسية زي أي تطبيق' : 'من قايمة المتصفح اختاري "تثبيت التطبيق" أو "Add to Home screen"'}
            </div>
          </div>
          {canInstall && !standalone && (
            <button className="btn primary" onClick={async () => { await deferredInstall?.prompt(); deferredInstall = null; setCanInstall(false) }}>ثبّتي</button>
          )}
        </div>
        <div className="divider" style={{ margin: 0 }} />
        <div className="row wrap">
          <Icon name="bell" />
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontWeight: 600 }}>إشعارات الجهاز</div>
            <div className="soft" style={{ fontSize: 13 }}>{perm === 'granted' ? 'شغالة' : perm === 'denied' ? 'مقفولة من إعدادات المتصفح' : perm === 'unsupported' ? 'المتصفح ده مش بيدعمها' : 'مش متفعلة'}</div>
          </div>
          {perm === 'default' && <button className="btn" onClick={async () => setPerm(await requestSystemNotifications())}>فعّلي</button>}
        </div>
      </div>

      <div className="card stack" style={{ gap: 12 }}>
        <h2>البيانات</h2>
        <p className="soft" style={{ margin: 0, fontSize: 14 }}>
          النسخة دي بتحفظ كل حاجة على الجهاز ده بس. الشركات والأسماء اللي موجودة دلوقتي أمثلة عشان تجربي.
        </p>
        <div className="row wrap">
          <button className="btn" onClick={exportData}><Icon name="download" size={18} /> نزّلي نسخة احتياطية</button>
          <button className="btn" onClick={async () => (await ask('نرجّع بيانات التجربة؟ أي تعديل هيتمسح.')) && (resetToSample(), toast({ title: 'رجعت بيانات التجربة', tone: 'ok' }))}><Icon name="refresh" size={18} /> رجّعي بيانات التجربة</button>
          <button className="btn danger" onClick={async () => (await ask('نمسح كل الأمثلة ونبدأ من الصفر؟')) && (startFresh(), toast({ title: 'بدأنا من الصفر، ضيفي أول شركة من الهيكل', tone: 'ok' }))}><Icon name="trash" size={18} /> ابدئي من الصفر</button>
        </div>
      </div>

      <div className="card stack" style={{ gap: 12 }}>
        <h2>اللي جاي في مدار</h2>
        {ROADMAP.map((r) => (
          <div key={r.t} className="row" style={{ alignItems: 'flex-start' }}>
            <span className="cdot" style={{ marginTop: 8, background: r.on ? 'var(--green)' : 'var(--line-2)', boxShadow: r.on ? '0 0 8px var(--green)' : 'none' }} />
            <div>
              <div style={{ fontWeight: 600 }}>{r.t}</div>
              <div className="soft" style={{ fontSize: 13 }}>{r.d}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
