import { useEffect, useState } from 'react'
import { ask, useStore, useUI } from '../lib/store'
import { useSync } from '../lib/sync'
import { odoo, type OdooConnection } from '../lib/odoo'
import { DEFAULT_WORKDAYS } from '../lib/performance'
import type { Company } from '../lib/types'
import { fmtDay, fmtTime } from '../lib/utils'
import { CompanyTag } from './ui'
import { Icon } from './Icon'
import { syncOn } from './Sync'

const DAYS = ['حد', 'اتنين', 'تلات', 'أربع', 'خميس', 'جمعة', 'سبت']

/** Settings card: each company links its own Odoo database; check-ins/outs feed attendance and the commitment score */
export function OdooCard() {
  const email = useSync((s) => s.email)
  const role = useSync((s) => s.role)
  const isOwner = role === 'owner' || role === 'owner-new'
  const companies = useStore((s) => s.companies)
  const [conns, setConns] = useState<OdooConnection[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!syncOn() || !email) return
    let off = false
    odoo<{ connections: OdooConnection[] }>('status')
      .then((r) => { if (!off) setConns(r.connections) })
      .catch((e) => { if (!off) setError((e as Error).message) })
    return () => { off = true }
  }, [email])

  if (!syncOn()) return null
  const put = (c: OdooConnection | null, companyId: string) =>
    setConns((xs) => [...(xs ?? []).filter((x) => x.companyId !== companyId), ...(c ? [c] : [])])

  return (
    <div className="card stack" style={{ gap: 12 }}>
      <div className="row"><Icon name="clock" /><h2 style={{ flex: 1 }}>الحضور من أودو</h2></div>
      <p className="soft" style={{ margin: 0, fontSize: 14 }}>
        كل شركة بتتربط بقاعدة أودو بتاعتها. بصمات الحضور والانصراف والإجازات بتنزل في مدار كل 10 دقايق، وبتتحسب في "الالتزام بالمواعيد" في التقييم الشهري: التأخير، والخروج بدري، والغياب من غير إجازة.
      </p>
      {!conns && !error && <span className="muted">بنشوف حالة الربط…</span>}
      {error && <div className="tone-late" role="alert" style={{ fontSize: 14 }}>{error}</div>}
      {conns && companies.map((c) => <CompanyOdoo key={c.id} company={c} conn={conns.find((x) => x.companyId === c.id) ?? null} isOwner={isOwner} onChange={(x) => put(x, c.id)} />)}
      {conns && !companies.length && <span className="muted">ضيفي شركة الأول من صفحة الهيكل.</span>}
    </div>
  )
}

function CompanyOdoo({ company, conn, isOwner, onChange }: { company: Company; conn: OdooConnection | null; isOwner: boolean; onChange: (c: OdooConnection | null) => void }) {
  const updateCompany = useStore((s) => s.updateCompany)
  const toast = useUI((s) => s.toast)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ url: '', db: '', login: '', apiKey: '' })
  const r = conn?.lastResult
  const err = r?.lastError && (!r.at || r.lastError.at > r.at) ? r.lastError : null

  const run = async (action: 'sync' | 'resync' | 'configure' | 'disconnect', extra: Record<string, unknown> = {}) => {
    setBusy(action); setError('')
    try {
      const x = await odoo(action, { companyId: company.id, ...extra })
      if (action === 'disconnect') { onChange(null); updateCompany(company.id, { odooLinked: false }) }
      else { onChange(x); if (!company.odooLinked) updateCompany(company.id, { odooLinked: true, countAbsence: company.countAbsence ?? true }) }
      return x
    } catch (e) {
      setError((e as Error).message)
      return null
    } finally { setBusy('') }
  }

  const connectForm = (
    <form
      className="stack"
      style={{ gap: 10 }}
      onSubmit={async (e) => {
        e.preventDefault()
        const ok = await run('configure', form)
        if (ok) { setEditing(false); setForm((f) => ({ ...f, apiKey: '' })); toast({ title: `أودو ${company.short} اتربط`, body: `${ok.lastResult?.added ?? 0} بصمة نزلت`, tone: 'ok' }) }
      }}
    >
      <label className="field"><span>رابط أودو بتاع {company.short}</span>
        <input className="input num" dir="ltr" required placeholder="https://mycompany.odoo.com" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
      </label>
      <label className="field"><span>اسم قاعدة البيانات (سيبيه فاضي لو أودو أونلاين)</span>
        <input className="input num" dir="ltr" value={form.db} onChange={(e) => setForm({ ...form, db: e.target.value })} />
      </label>
      <label className="field"><span>إيميل الدخول على أودو</span>
        <input className="input num" dir="ltr" type="email" required autoComplete="off" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} />
      </label>
      <label className="field"><span>مفتاح الـ API {conn ? '(سيبيه فاضي عشان يفضل القديم)' : ''}</span>
        <input className="input num" dir="ltr" type="password" autoComplete="new-password" required={!conn} value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
      </label>
      <details className="soft" style={{ fontSize: 13 }}>
        <summary style={{ cursor: 'pointer' }}>أجيب مفتاح الـ API منين؟</summary>
        <ol style={{ margin: '8px 0 0', paddingInlineStart: 20, lineHeight: 1.9 }}>
          <li>ادخلي أودو الشركة دي بحساب شايف حضور كل الموظفين (مدير الموارد البشرية مثلًا).</li>
          <li>دوسي على صورتك فوق ← التفضيلات (Preferences / My Profile).</li>
          <li>تبويب أمان الحساب (Account Security) ← مفتاح API جديد (New API Key).</li>
          <li>اكتبي اسم زي "مدار"، وانسخي المفتاح وحطيه هنا. أودو مش هيوريهولك تاني.</li>
        </ol>
        <p style={{ margin: '8px 0 0' }}>المفتاح بيتحفظ على سيرفر مدار بس، ومش بيظهر لحد. لو أودو أونلاين، الربط محتاج باقة Custom.</p>
      </details>
      <div className="row wrap">
        <button className="btn primary" disabled={!!busy}>{busy === 'configure' ? 'بنجرب الدخول…' : 'اربطي وجربي'}</button>
        <button type="button" className="btn ghost" onClick={() => setEditing(false)}>إلغاء</button>
      </div>
    </form>
  )

  return (
    <div className="stack" style={{ gap: 10, padding: 12, border: '1px solid var(--line)', borderRadius: 14 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <CompanyTag company={company} />
        <span className="spacer" />
        {conn
          ? <span className="row" style={{ gap: 6, fontSize: 13 }}><span className="cdot" style={{ background: err ? 'var(--rose)' : 'var(--green)', boxShadow: `0 0 8px ${err ? 'var(--rose)' : 'var(--green)'}` }} />{err ? 'فيه مشكلة' : 'مربوطة'}</span>
          : <span className="muted" style={{ fontSize: 13 }}>مش مربوطة</span>}
      </div>

      {editing && isOwner ? connectForm : !conn ? (
        isOwner
          ? <div><button className="btn" onClick={() => { setForm({ url: '', db: '', login: '', apiKey: '' }); setEditing(true) }}><Icon name="plus" size={18} /> اربطي أودو {company.short}</button></div>
          : <span className="muted" style={{ fontSize: 13 }}>صاحبة مدار هي اللي تربط أودو.</span>
      ) : (
        <>
          <div className="soft num" dir="ltr" style={{ fontSize: 13, textAlign: 'start' }}>{conn.url}{conn.db ? ` · ${conn.db}` : ''} · {conn.login}</div>
          {r?.at && (
            <div style={{ fontSize: 14 }}>
              آخر تحديث {fmtDay(r.at)} الساعة <span className="num">{fmtTime(r.at)}</span>
              {' · '}<span className="num">{r.matched ?? 0}</span> من <span className="num">{r.employees ?? 0}</span> موظف متوصلين بأسمائهم في مدار
              {r.added ? <> · <span className="num">{r.added}</span> بصمة جديدة</> : null}
            </div>
          )}
          {err && <div className="tone-late" role="alert" style={{ fontSize: 14 }}>آخر محاولة فشلت: {err.detail || err.error}</div>}
          {!!r?.unmatchedEmployees?.length && (
            <details style={{ fontSize: 14 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--amber)' }}>{r.unmatchedEmployees.length} موظف في أودو مش لاقيينهم في مدار</summary>
              <p className="soft" style={{ margin: '6px 0' }}>بنوصّل بالإيميل، وبعدين الموبايل، وبعدين الاسم. اكتبي نفس إيميل الشغل بتاع أودو جنب اسمه في صفحة الهيكل، أو ضيفيه.</p>
              <ul style={{ margin: 0, paddingInlineStart: 20, lineHeight: 1.8 }}>
                {r.unmatchedEmployees.slice(0, 40).map((e) => <li key={e.id}>{e.name} <span className="muted num" dir="ltr">{e.email ?? ''}</span></li>)}
              </ul>
            </details>
          )}

          <label className="row" style={{ gap: 8, fontSize: 14, cursor: isOwner ? 'pointer' : 'default' }}>
            <input type="checkbox" disabled={!isOwner} checked={!!company.countAbsence} onChange={(e) => updateCompany(company.id, { countAbsence: e.target.checked })} style={{ width: 18, height: 18, accentColor: 'var(--cyan-2)' }} />
            الغياب في يوم شغل من غير إجازة يتحسب عليه
          </label>
          <div className="row wrap" style={{ gap: 6 }} role="group" aria-label="أيام الشغل">
            <span className="soft" style={{ fontSize: 13 }}>أيام الشغل:</span>
            {DAYS.map((d, i) => {
              const days = company.workDays?.length ? company.workDays : DEFAULT_WORKDAYS
              const on = days.includes(i)
              return <button key={d} type="button" className={`chip ${on ? 'on' : ''}`} aria-pressed={on} disabled={!isOwner} onClick={() => updateCompany(company.id, { workDays: on ? days.filter((x) => x !== i) : [...days, i].sort() })}>{d}</button>
            })}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>التأخير بعد <span className="num">{company.workStart}</span> + <span className="num">{company.graceMinutes}</span> دقيقة سماح، والخروج البدري قبل <span className="num">{company.workEnd}</span> بأكتر من فترة السماح. بتتغير من صفحة الهيكل.</div>

          <div className="row wrap">
            <button className="btn primary sm" disabled={!!busy} onClick={async () => { const x = await run('sync'); if (x) toast({ title: `اتحدّث من أودو ${company.short}`, body: `${x.lastResult?.added ?? 0} جديد · ${x.lastResult?.changed ?? 0} اتعدّل`, tone: 'ok' }) }}>
              <Icon name="refresh" size={16} /> {busy === 'sync' ? 'بنسحب…' : 'حدّثي دلوقتي'}
            </button>
            {isOwner && <button className="btn sm" disabled={!!busy} title="بعد ما تغيّري المواعيد أو الإيميلات" onClick={async () => { const x = await run('resync'); if (x) toast({ title: 'اتحسب التاريخ كله من جديد', tone: 'ok' }) }}>{busy === 'resync' ? 'بنعيد الحساب…' : 'اسحبي التاريخ كله تاني'}</button>}
            {isOwner && <button className="btn ghost sm" disabled={!!busy} onClick={() => { setForm({ url: conn.url ?? '', db: conn.db ?? '', login: conn.login ?? '', apiKey: '' }); setEditing(true) }}>غيّري قاعدة البيانات</button>}
            {isOwner && <button className="btn ghost danger sm" disabled={!!busy} onClick={async () => (await ask(`نفصل أودو ${company.short}؟ الأيام اللي نزلت هتفضل موجودة.`)) && run('disconnect')}>افصلي</button>}
          </div>
        </>
      )}
      {error && <div className="tone-late" role="alert" style={{ fontSize: 14 }}>{error}</div>}
    </div>
  )
}
