import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ask, useStore, useUI } from '../lib/store'
import { useMe } from '../lib/access'
import { requestSystemNotifications } from '../lib/reminders'
import { enablePush, pushState, type PushState } from '../lib/push'
import { playRing, ringOn, setRingOn } from '../lib/ring'
import { initialsOf } from '../lib/utils'
import { Avatar } from '../components/ui'
import { Icon } from '../components/Icon'
import { useSync } from '../lib/sync'
import { SyncCard, logoutEverywhere, syncOn } from '../components/Sync'

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let deferredInstall: InstallEvent | null = null
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferredInstall = e as InstallEvent
})

const ROADMAP = [
  { t: 'المرحلة 1', d: 'الشركات والهيكل والصلاحيات، المهام بكل أشكالها، التنبيهات والتذكيرات، الحضور بالموقع والكود', on: true },
  { t: 'الأداء والتقييم', d: 'درجة الالتزام الشهرية من 100، تقييم المدير وتقييم المهام، مؤشرات KPIs متدرجة، التقييم السنوي، والترقيات', on: true },
  { t: 'المزامنة', d: 'حساب حقيقي بالإيميل وبيانات على السيرفر (Supabase) تتزامن بين اللابتوب والموبايل والفريق، وبتشتغل من غير نت', on: true },
  { t: 'مساعد مدار', d: 'بيفهم المصري بالكتابة والصوت: ملخص يومك، المتأخر، يضيف ويقفل مهام. ومع Claude أونلاين بيجاوب أي سؤال', on: true },
  { t: 'واتساب رايح جاي', d: 'التنبيهات توصلك واتساب بزرار "خلصت" و"فكّريني بعد ساعة"، وردك يحدّث مدار ويشيل التنبيه من كل مكان', on: true },
  { t: 'الجاي', d: 'فهم الرسايل الصوتية على واتساب، وتقارير شهرية تتبعت لوحدها' },
]

export function Settings() {
  const me = useMe()!
  const updateUser = useStore((s) => s.updateUser)
  const resetToSample = useStore((s) => s.resetToSample)
  const startFresh = useStore((s) => s.startFresh)
  const toast = useUI((s) => s.toast)
  const isOwner = useSync((s) => s.role === 'owner' || s.role === 'owner-new')
  const [name, setName] = useState(me.name)
  const [phone, setPhone] = useState(me.phone ?? '')
  const [perm, setPerm] = useState<string>(() => ('Notification' in window ? Notification.permission : 'unsupported'))
  const [push, setPush] = useState<PushState | null>(null)
  const [ring, setRing] = useState(ringOn)
  useEffect(() => { pushState().then(setPush) }, [])
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
      <Link to="/org" className="card row mobile-only span-2" style={{ color: 'inherit', gap: 12 }}>
        <Icon name="org" />
        <span style={{ flex: 1, fontWeight: 600 }}>الهيكل التنظيمي والفريق والشركات</span>
        <Icon name="chevron" size={18} className="muted" />
      </Link>
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
        {me.email && <div className="field"><span>الإيميل</span><div className="num" dir="ltr" style={{ textAlign: 'start' }}>{me.email}</div></div>}
        <label className="field"><span>رقم الموبايل (للواتساب)</span><input className="input num" dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+20 1xx xxx xxxx" /></label>
        <div className="row">
          <button className="btn primary">احفظي</button>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={logoutEverywhere}><Icon name="logout" size={18} /> خروج</button>
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
        {push && push !== 'needs-sync' && (
          <div className="row wrap">
            <Icon name="bell" />
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontWeight: 600 }}>الإشعارات والتطبيق مقفول</div>
              <div className="soft" style={{ fontSize: 13 }}>
                {push === 'on' ? 'شغالة على الجهاز ده: المهام الجديدة والتذكيرات توصلك حتى لو مدار مقفول'
                  : push === 'needs-install' ? 'على الآيفون: ثبّتي مدار على الشاشة الرئيسية الأول (فوق)، وافتحيه من هناك وارجعي هنا'
                  : push === 'denied' ? 'الإشعارات مقفولة لمدار من إعدادات المتصفح أو الموبايل، افتحيها من هناك'
                  : push === 'unsupported' ? 'المتصفح ده مش بيدعمها، جربي Chrome' : 'مش متفعلة على الجهاز ده'}
              </div>
            </div>
            {push === 'off' && (
              <button className="btn primary" onClick={async () => {
                const st = await enablePush()
                setPush(st); setPerm('Notification' in window ? Notification.permission : 'unsupported')
                toast(st === 'on' ? { title: 'تمام، الإشعارات هتوصلك والتطبيق مقفول', tone: 'ok' } : { title: 'مقدرناش نفعّلها', body: 'اسمحي بالإشعارات لمدار وجربي تاني', tone: 'warn' })
              }}>فعّلي</button>
            )}
          </div>
        )}
        <div className="divider" style={{ margin: 0 }} />
        <div className="row wrap">
          <Icon name="sparkle" />
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontWeight: 600 }}>رنة مدار</div>
            <div className="soft" style={{ fontSize: 13 }}>فرخة بتصرخ للمهمة الجديدة، بطة للتذكير، وترومبون حزين للمتأخر</div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm" onClick={() => playRing('assigned', true)}>مهمة جديدة</button>
            <button className="btn sm" onClick={() => playRing('reminder', true)}>تذكير</button>
            <button className="btn sm" onClick={() => playRing('overdue', true)}>متأخرة</button>
          </div>
          <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={ring} onChange={(e) => { setRingOn(e.target.checked); setRing(e.target.checked); if (e.target.checked) playRing('assigned', true) }} style={{ width: 20, height: 20, accentColor: 'var(--cyan)' }} />
            <span>شغالة</span>
          </label>
        </div>
      </div>

      <SyncCard />

      <div className="card stack" style={{ gap: 12 }}>
        <div className="row"><Icon name="whatsapp" /><h2 style={{ flex: 1 }}>تنبيهات واتساب</h2></div>
        {!syncOn() ? (
          <p className="soft" style={{ margin: 0, fontSize: 14 }}>الواتساب بيشتغل من السيرفر، فمحتاج المزامنة أونلاين تبقى شغالة الأول.</p>
        ) : (
          <>
            <p className="soft" style={{ margin: 0, fontSize: 14 }}>
              التذكيرات والمتأخر والمهام الجديدة توصلك واتساب حتى لو مدار مقفول، وتردي من هناك: "خلصت" أو "فكّريني بعد ساعة"، أو ابعتي "مهامي".
            </p>
            {!me.phone && <p style={{ margin: 0, color: 'var(--amber)', fontSize: 14 }}>اكتبي رقم موبايلك فوق واحفظي الأول.</p>}
            <label className="row" style={{ gap: 10, cursor: me.phone ? 'pointer' : 'not-allowed', opacity: me.phone ? 1 : 0.5 }}>
              <input type="checkbox" disabled={!me.phone} checked={!!me.phone && me.waOptIn !== false} onChange={(e) => { updateUser(me.id, { waOptIn: e.target.checked, waSince: e.target.checked ? new Date().toISOString() : me.waSince }); toast({ title: e.target.checked ? 'هتوصلك التنبيهات على واتساب' : 'وقفنا تنبيهات واتساب', tone: 'ok' }) }} style={{ width: 20, height: 20, accentColor: 'var(--green)' }} />
              <span style={{ fontWeight: 600 }}>ابعتيلي التنبيهات على واتساب</span>
            </label>
          </>
        )}
      </div>

      <div className="card stack" style={{ gap: 12 }}>
        <h2>البيانات</h2>
        <p className="soft" style={{ margin: 0, fontSize: 14 }}>
          {syncOn() ? 'أي مسح هنا بيتمسح من عند الفريق كله كمان.' : 'النسخة دي بتحفظ كل حاجة على الجهاز ده بس. الشركات والأسماء اللي موجودة دلوقتي أمثلة عشان تجربي.'}
        </p>
        <div className="row wrap">
          <button className="btn" onClick={exportData}><Icon name="download" size={18} /> نزّلي نسخة احتياطية</button>
          {!syncOn() && <button className="btn" onClick={async () => (await ask('نرجّع بيانات التجربة؟ أي تعديل هيتمسح.')) && (resetToSample(), toast({ title: 'رجعت بيانات التجربة', tone: 'ok' }))}><Icon name="refresh" size={18} /> رجّعي بيانات التجربة</button>}
          {(!syncOn() || isOwner) && <button className="btn danger" onClick={async () => (await ask(syncOn() ? 'نمسح كل البيانات من عند الفريق كله ونبدأ من الصفر؟ مفيش رجوع.' : 'نمسح كل الأمثلة ونبدأ من الصفر؟')) && (startFresh(), toast({ title: 'بدأنا من الصفر، ضيفي أول شركة من الهيكل', tone: 'ok' }))}><Icon name="trash" size={18} /> ابدئي من الصفر</button>}
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
