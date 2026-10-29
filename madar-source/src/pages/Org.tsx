import { useEffect, useState } from 'react'
import { ask, useStore, useUI } from '../lib/store'
import { roleIn, useMyCompanies, useUserMap } from '../lib/access'
import type { Company, ID, OrgUnit, Role, UnitType } from '../lib/types'
import { COMPANY_COLORS, hexA, initialsOf, ROLE_LABEL, UNIT_LABEL } from '../lib/utils'
import { Avatar, Empty, Overlay } from '../components/ui'
import { Icon } from '../components/Icon'

type Tab = 'tree' | 'team' | 'settings'

export function Org() {
  const me = useStore((s) => s.currentUserId)!
  const memberships = useStore((s) => s.memberships)
  const filter = useUI((s) => s.companyFilter)
  const companies = useMyCompanies()
  const [sel, setSel] = useState<ID | null>(filter !== 'all' ? filter : companies[0]?.id ?? null)
  useEffect(() => { if (filter !== 'all') setSel(filter) }, [filter])
  const [tab, setTab] = useState<Tab>('tree')
  const [adding, setAdding] = useState(false)
  const company = companies.find((c) => c.id === sel) ?? companies[0]
  const isAdmin = !!company && roleIn(memberships, me, company.id) === 'admin'

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="grid grid-4">
        {companies.map((c) => {
          const n = memberships.filter((m) => m.companyId === c.id).length
          const on = company?.id === c.id
          return (
            <button
              key={c.id}
              className="card"
              onClick={() => setSel(c.id)}
              aria-pressed={on}
              style={{ cursor: 'pointer', textAlign: 'start', borderColor: on ? c.color : hexA(c.color, 0.25), background: `linear-gradient(160deg, ${hexA(c.color, on ? 0.2 : 0.08)}, rgba(255,255,255,0.02))`, color: 'inherit' }}
            >
              <div className="row">
                <span style={{ width: 40, height: 40, borderRadius: 13, background: hexA(c.color, 0.2), color: c.color, display: 'grid', placeItems: 'center' }}><Icon name="building" /></span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontFamily: 'var(--display)' }}>{c.name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{n} أعضاء · {ROLE_LABEL[roleIn(memberships, me, c.id) ?? 'employee']}</div>
                </div>
              </div>
            </button>
          )
        })}
        <button className="card" onClick={() => setAdding(true)} style={{ cursor: 'pointer', borderStyle: 'dashed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--soft)', minHeight: 78 }}>
          <Icon name="plus" /> شركة جديدة
        </button>
      </div>

      {!company && <div className="card"><Empty icon="building" title="ضيفي أول شركة عشان تبني الهيكل والفريق" /></div>}

      {company && (
        <>
          <div className="seg" role="tablist" aria-label="أقسام الشركة" style={{ alignSelf: 'flex-start' }}>
            <button role="tab" aria-selected={tab === 'tree'} className={tab === 'tree' ? 'on' : ''} onClick={() => setTab('tree')}><Icon name="org" size={16} /> الهيكل</button>
            <button role="tab" aria-selected={tab === 'team'} className={tab === 'team' ? 'on' : ''} onClick={() => setTab('team')}><Icon name="users" size={16} /> الفريق</button>
            {isAdmin && <button role="tab" aria-selected={tab === 'settings'} className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}><Icon name="settings" size={16} /> إعدادات الشركة</button>}
          </div>
          {tab === 'tree' && <Tree company={company} isAdmin={isAdmin} />}
          {tab === 'team' && <Team company={company} isAdmin={isAdmin} />}
          {tab === 'settings' && isAdmin && <CompanySettings key={company.id} company={company} onDeleted={() => setSel(null)} />}
        </>
      )}

      {adding && <NewCompany onClose={() => setAdding(false)} onCreated={(id) => { setSel(id); setAdding(false); setTab('settings') }} />}
    </div>
  )
}

/* ---------- structure tree ---------- */

function Tree({ company, isAdmin }: { company: Company; isAdmin: boolean }) {
  const units = useStore((s) => s.units).filter((u) => u.companyId === company.id)
  const [edit, setEdit] = useState<null | { unit?: OrgUnit; parentId: ID | null }>(null)
  const roots = units.filter((u) => !u.parentId || !units.some((x) => x.id === u.parentId))

  return (
    <div className="card">
      <div className="card-head">
        <span style={{ width: 34, height: 34, borderRadius: 11, background: hexA(company.color, 0.2), color: company.color, display: 'grid', placeItems: 'center' }}><Icon name="building" size={18} /></span>
        <h3>{company.name}</h3>
        <span className="spacer" />
        {isAdmin && <button className="btn sm" onClick={() => setEdit({ parentId: null })}><Icon name="plus" size={16} /> قطاع / إدارة</button>}
      </div>
      {roots.length === 0 && <Empty icon="org" title="لسه مفيش قطاعات أو إدارات">{isAdmin && <span className="muted" style={{ fontSize: 13 }}>ابدئي بالقطاعات الكبيرة، وجوه كل واحد الإدارات، وبعدين الفرق.</span>}</Empty>}
      <div className="tree">
        {roots.map((u) => <Node key={u.id} unit={u} all={units} isAdmin={isAdmin} color={company.color} onEdit={setEdit} />)}
      </div>
      {edit && <UnitModal company={company} unit={edit.unit} parentId={edit.parentId} onClose={() => setEdit(null)} />}
    </div>
  )
}

function Node({ unit, all, isAdmin, color, onEdit }: { unit: OrgUnit; all: OrgUnit[]; isAdmin: boolean; color: string; onEdit: (e: { unit?: OrgUnit; parentId: ID | null }) => void }) {
  const users = useUserMap()
  const memberships = useStore((s) => s.memberships)
  const removeUnit = useStore((s) => s.removeUnit)
  const kids = all.filter((u) => u.parentId === unit.id)
  const count = memberships.filter((m) => m.unitId === unit.id).length
  const mgr = unit.managerId ? users[unit.managerId] : undefined
  const tint = unit.type === 'division' ? color : unit.type === 'department' ? '#A78BFA' : '#FBBF24'
  return (
    <div>
      <div className="tree-node">
        <span className="pill" style={{ background: hexA(tint, 0.14), color: tint }}>{UNIT_LABEL[unit.type]}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{unit.name}</div>
          <div className="muted" style={{ fontSize: 12 }}>{mgr ? `المدير: ${mgr.name}` : 'من غير مدير'} · {count} أعضاء</div>
        </div>
        {mgr && <span className="desktop-only"><Avatar user={mgr} size="sm" /></span>}
        {isAdmin && (
          <span className="row actions" style={{ gap: 2 }}>
            {unit.type !== 'team' && <button className="btn ghost icon sm" aria-label={`ضيفي تحت ${unit.name}`} onClick={() => onEdit({ parentId: unit.id })}><Icon name="plus" size={16} /></button>}
            <button className="btn ghost icon sm" aria-label={`تعديل ${unit.name}`} onClick={() => onEdit({ unit, parentId: unit.parentId })}><Icon name="edit" size={16} /></button>
            <button className="btn ghost icon sm" aria-label={`امسحي ${unit.name}`} onClick={async () => (await ask(`نمسح "${unit.name}"؟ اللي تحته هيطلع مستوى لفوق.`)) && removeUnit(unit.id)}><Icon name="trash" size={16} /></button>
          </span>
        )}
      </div>
      {kids.length > 0 && (
        <div className="tree-children">
          {kids.map((k) => <Node key={k.id} unit={k} all={all} isAdmin={isAdmin} color={color} onEdit={onEdit} />)}
        </div>
      )}
    </div>
  )
}

function UnitModal({ company, unit, parentId, onClose }: { company: Company; unit?: OrgUnit; parentId: ID | null; onClose: () => void }) {
  const units = useStore((s) => s.units)
  const users = useStore((s) => s.users)
  const memberships = useStore((s) => s.memberships)
  const addUnit = useStore((s) => s.addUnit)
  const updateUnit = useStore((s) => s.updateUnit)
  const parent = units.find((u) => u.id === parentId)
  const defaultType: UnitType = !parent ? 'division' : parent.type === 'division' ? 'department' : 'team'
  const [name, setName] = useState(unit?.name ?? '')
  const [type, setType] = useState<UnitType>(unit?.type ?? defaultType)
  const [managerId, setManagerId] = useState<string>(unit?.managerId ?? '')
  const members = users.filter((u) => memberships.some((m) => m.userId === u.id && m.companyId === company.id))

  return (
    <Overlay onClose={onClose} label={unit ? 'تعديل' : 'إضافة'}>
      <form
        className="stack"
        style={{ gap: 14 }}
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          const data = { name: name.trim(), type, managerId: managerId || undefined }
          if (unit) updateUnit(unit.id, data)
          else addUnit({ ...data, companyId: company.id, parentId })
          onClose()
        }}
      >
        <h2>{unit ? `تعديل ${unit.name}` : parent ? `إضافة تحت ${parent.name}` : `إضافة في ${company.short}`}</h2>
        <label className="field"><span>النوع</span>
          <select className="select" value={type} onChange={(e) => setType(e.target.value as UnitType)}>
            {(Object.keys(UNIT_LABEL) as UnitType[]).map((t) => <option key={t} value={t}>{UNIT_LABEL[t]}</option>)}
          </select>
        </label>
        <label className="field"><span>الاسم</span><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً: إدارة المبيعات" /></label>
        <label className="field"><span>المدير المسؤول</span>
          <select className="select" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
            <option value="">من غير مدير</option>
            {members.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <div className="muted" style={{ fontSize: 12 }}>المدير بيشوف كل مهام الوحدة دي واللي تحتها، وبيقدر يوزع عليهم شغل.</div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>إلغاء</button>
          <button className="btn primary" disabled={!name.trim()}>{unit ? 'احفظي' : 'ضيفي'}</button>
        </div>
      </form>
    </Overlay>
  )
}

/* ---------- team ---------- */

function Team({ company, isAdmin }: { company: Company; isAdmin: boolean }) {
  const users = useUserMap()
  const allUsers = useStore((s) => s.users)
  const me = useStore((s) => s.currentUserId)
  const memberships = useStore((s) => s.memberships).filter((m) => m.companyId === company.id)
  const units = useStore((s) => s.units).filter((u) => u.companyId === company.id)
  const tasks = useStore((s) => s.tasks)
  const upsert = useStore((s) => s.upsertMembership)
  const remove = useStore((s) => s.removeMembership)
  const addUser = useStore((s) => s.addUser)
  const updateUser = useStore((s) => s.updateUser)
  const [email, setEmail] = useState('')
  const [adding, setAdding] = useState(false)
  const [pick, setPick] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<Role>('employee')
  const outsiders = allUsers.filter((u) => !memberships.some((m) => m.userId === u.id))

  return (
    <div className="card">
      <div className="card-head">
        <h3>فريق {company.short}</h3>
        <span className="num muted">{memberships.length}</span>
        <span className="spacer" />
        {isAdmin && <button className="btn sm" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> عضو جديد</button>}
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>الاسم</th>{isAdmin && <th>الإيميل (للدخول)</th>}<th>المسمى</th><th>الصلاحية</th><th>تابع لـ</th><th>مهام مفتوحة</th>{isAdmin && <th><span className="sr-only">إجراءات</span></th>}</tr></thead>
          <tbody>
            {memberships.map((m) => {
              const u = users[m.userId]
              const openCount = tasks.filter((t) => t.companyId === company.id && t.assigneeId === m.userId && t.status !== 'done').length
              return (
                <tr key={m.userId}>
                  <td><span className="row" style={{ gap: 8 }}><Avatar user={u} size="sm" />{u?.name}{m.userId === me && <span className="muted"> (أنا)</span>}</span></td>
                  {isAdmin && (
                    <td><input className="input num" dir="ltr" type="email" style={{ minHeight: 36, padding: '6px 10px', minWidth: 190 }} key={u?.email ?? ''} defaultValue={u?.email ?? ''} placeholder="name@mail.com" onBlur={(e) => { const v = e.target.value.trim().toLowerCase() || undefined; if (v !== u?.email) updateUser(m.userId, { email: v }) }} aria-label={`إيميل ${u?.name}`} /></td>
                  )}
                  <td>
                    {isAdmin ? <input className="input" style={{ minHeight: 36, padding: '6px 10px' }} value={m.title ?? ''} placeholder="—" onChange={(e) => upsert({ ...m, title: e.target.value })} aria-label="المسمى" /> : m.title ?? '—'}
                  </td>
                  <td>
                    {isAdmin && m.userId !== me ? (
                      <select className="select" style={{ minHeight: 36, padding: '6px 10px' }} value={m.role} onChange={(e) => upsert({ ...m, role: e.target.value as Role })} aria-label="الصلاحية">
                        {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    ) : ROLE_LABEL[m.role]}
                  </td>
                  <td>
                    {isAdmin ? (
                      <select className="select" style={{ minHeight: 36, padding: '6px 10px' }} value={m.unitId ?? ''} onChange={(e) => upsert({ ...m, unitId: e.target.value || undefined })} aria-label="الوحدة">
                        <option value="">الشركة كلها</option>
                        {units.map((x) => <option key={x.id} value={x.id}>{UNIT_LABEL[x.type]}: {x.name}</option>)}
                      </select>
                    ) : units.find((x) => x.id === m.unitId)?.name ?? '—'}
                  </td>
                  <td className="num">{openCount}</td>
                  {isAdmin && (
                    <td>{m.userId !== me && <button className="btn ghost icon sm" aria-label={`شيلي ${u?.name}`} onClick={async () => (await ask(`نشيل ${u?.name} من ${company.short}؟`)) && remove(m.userId, company.id)}><Icon name="trash" size={16} /></button>}</td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
        مدير عام: بيشوف ويعدل كل حاجة في الشركة · مدير: بيشوف مهام وحدته واللي تحتها · موظف: بيشوف مهامه بس
      </div>

      {adding && (
        <Overlay onClose={() => setAdding(false)} label="عضو جديد">
          <form
            className="stack"
            style={{ gap: 14 }}
            onSubmit={(e) => {
              e.preventDefault()
              let userId = pick
              if (!userId) {
                if (!name.trim()) return
                userId = addUser({ name: name.trim(), phone: phone.trim() || undefined, email: email.trim().toLowerCase() || undefined, initials: initialsOf(name) })
              }
              upsert({ userId, companyId: company.id, role })
              setAdding(false); setPick(''); setName(''); setPhone(''); setEmail('')
            }}
          >
            <h2>ضيفي حد لـ {company.short}</h2>
            {outsiders.length > 0 && (
              <label className="field"><span>من الناس اللي في شركاتك التانية</span>
                <select className="select" value={pick} onChange={(e) => setPick(e.target.value)}>
                  <option value="">— شخص جديد —</option>
                  {outsiders.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>
            )}
            {!pick && (
              <>
                <label className="field"><span>الاسم</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
                <label className="field"><span>الإيميل (هيدخل بيه مدار)</span><input className="input num" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@mail.com" /></label>
                <label className="field"><span>رقم الموبايل (للواتساب بعدين)</span><input className="input num" inputMode="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+20 1xx xxx xxxx" /></label>
              </>
            )}
            <label className="field"><span>الصلاحية</span>
              <select className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </label>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn ghost" onClick={() => setAdding(false)}>إلغاء</button>
              <button className="btn primary" disabled={!pick && !name.trim()}>ضيفي</button>
            </div>
          </form>
        </Overlay>
      )}
    </div>
  )
}

/* ---------- company settings ---------- */

function CompanySettings({ company, onDeleted }: { company: Company; onDeleted: () => void }) {
  const update = useStore((s) => s.updateCompany)
  const removeCompany = useStore((s) => s.removeCompany)
  const toast = useUI((s) => s.toast)
  const [c, setC] = useState(company)
  const [locating, setLocating] = useState(false)
  const set = <K extends keyof Company>(k: K, v: Company[K]) => setC((x) => ({ ...x, [k]: v }))

  const useHere = () => {
    if (!navigator.geolocation) return toast({ title: 'الجهاز مش بيدعم تحديد الموقع', tone: 'warn' })
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false)
        set('geofence', { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), radius: c.geofence?.radius ?? 150, label: c.geofence?.label ?? 'المقر الرئيسي' })
      },
      () => { setLocating(false); toast({ title: 'مش قادرين نحدد الموقع', body: 'اسمحي بالموقع وجربي تاني', tone: 'warn' }) },
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  return (
    <form
      className="grid grid-2"
      style={{ alignItems: 'start' }}
      onSubmit={(e) => { e.preventDefault(); update(company.id, c); toast({ title: 'اتحفظت إعدادات الشركة', tone: 'ok' }) }}
    >
      <div className="card stack" style={{ gap: 14 }}>
        <h3>البيانات</h3>
        <label className="field"><span>اسم الشركة</span><input className="input" value={c.name} onChange={(e) => set('name', e.target.value)} /></label>
        <label className="field"><span>اسم مختصر (بيظهر في الفلاتر)</span><input className="input" value={c.short} onChange={(e) => set('short', e.target.value)} /></label>
        <div className="field"><span>لون الشركة</span>
          <div className="row wrap">
            {COMPANY_COLORS.map((col) => (
              <button type="button" key={col} aria-label={`لون ${col}`} aria-pressed={c.color === col} onClick={() => set('color', col)}
                style={{ width: 36, height: 36, borderRadius: 12, background: col, border: c.color === col ? '3px solid #fff' : '3px solid transparent', boxShadow: `0 0 12px ${hexA(col, 0.5)}`, cursor: 'pointer' }} />
            ))}
          </div>
        </div>
      </div>
      <div className="card stack" style={{ gap: 14 }}>
        <h3>الحضور</h3>
        <div className="grid grid-3" style={{ gap: 10 }}>
          <label className="field"><span>بداية اليوم</span><input className="input" type="time" value={c.workStart} onChange={(e) => set('workStart', e.target.value)} /></label>
          <label className="field"><span>نهاية اليوم</span><input className="input" type="time" value={c.workEnd} onChange={(e) => set('workEnd', e.target.value)} /></label>
          <label className="field"><span>سماح (دقايق)</span><input className="input num" type="number" min={0} max={120} value={c.graceMinutes} onChange={(e) => set('graceMinutes', Number(e.target.value))} /></label>
        </div>
        <div className="field">
          <span>مكان الشركة (للحضور بالموقع)</span>
          {c.geofence ? (
            <div className="stack" style={{ gap: 8 }}>
              <div className="row wrap">
                <input className="input" style={{ flex: 1, minWidth: 140 }} value={c.geofence.label ?? ''} onChange={(e) => set('geofence', { ...c.geofence!, label: e.target.value })} aria-label="اسم المكان" />
                <label className="row" style={{ gap: 6 }}><span className="muted" style={{ fontSize: 13 }}>النطاق</span>
                  <input className="input num" style={{ width: 90 }} type="number" min={30} max={2000} value={c.geofence.radius} onChange={(e) => set('geofence', { ...c.geofence!, radius: Number(e.target.value) })} aria-label="النطاق بالمتر" />
                  <span className="muted" style={{ fontSize: 13 }}>متر</span></label>
              </div>
              <div className="muted num" style={{ fontSize: 12 }} dir="ltr">{c.geofence.lat}, {c.geofence.lng}</div>
              <div className="row wrap">
                <button type="button" className="btn sm" onClick={useHere} disabled={locating}><Icon name="gps" size={16} /> {locating ? 'بنحدد…' : 'حدّثي من مكاني الحالي'}</button>
                <button type="button" className="btn ghost sm" onClick={() => set('geofence', undefined)}>شيلي المكان</button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn" onClick={useHere} disabled={locating} style={{ alignSelf: 'flex-start' }}><Icon name="gps" size={18} /> {locating ? 'بنحدد…' : 'استخدمي مكاني الحالي كمقر'}</button>
          )}
        </div>
        <label className="row" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={c.strictGeofence} onChange={(e) => set('strictGeofence', e.target.checked)} style={{ width: 20, height: 20, accentColor: c.color }} />
          <span>امنعي الحضور بالموقع من برة النطاق</span>
        </label>
        <div className="muted" style={{ fontSize: 12 }}>لو مش مفعّلة، الحضور من برة بيتسجل بس بيظهر للمدير إنه "برة المقر".</div>
      </div>
      <div className="row span-2" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="btn danger" onClick={async () => { if (await ask(`نمسح ${company.name} وكل مهامها وبياناتها؟ مفيش رجوع.`)) { removeCompany(company.id); onDeleted() } }}>
          <Icon name="trash" size={18} /> امسحي الشركة
        </button>
        <button className="btn primary">احفظي الإعدادات</button>
      </div>
    </form>
  )
}

function NewCompany({ onClose, onCreated }: { onClose: () => void; onCreated: (id: ID) => void }) {
  const me = useStore((s) => s.currentUserId)!
  const count = useStore((s) => s.companies.length)
  const addCompany = useStore((s) => s.addCompany)
  const [name, setName] = useState('')
  return (
    <Overlay onClose={onClose} label="شركة جديدة">
      <form
        className="stack"
        style={{ gap: 14 }}
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          const short = name.trim().split(/\s+/)[0]
          const id = addCompany({ name: name.trim(), short, color: COMPANY_COLORS[count % COMPANY_COLORS.length], workStart: '09:00', workEnd: '17:00', graceMinutes: 15, strictGeofence: false }, me)
          onCreated(id)
        }}
      >
        <h2>شركة جديدة</h2>
        <label className="field"><span>اسم الشركة</span><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></label>
        <div className="muted" style={{ fontSize: 13 }}>هتبقي المدير العام فيها، وبعدها تضيفي الهيكل والفريق.</div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>إلغاء</button>
          <button className="btn primary" disabled={!name.trim()}>اعملي الشركة</button>
        </div>
      </form>
    </Overlay>
  )
}
