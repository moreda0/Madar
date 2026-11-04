import { useEffect, useState } from 'react'
import { ask, useStore, useUI } from '../lib/store'
import { useSync } from '../lib/sync'
import { odoo, type OdooStatus } from '../lib/odoo'
import { DEFAULT_WORKDAYS } from '../lib/performance'
import { fmtDay, fmtTime } from '../lib/utils'
import { Icon } from './Icon'
import { syncOn } from './Sync'

const DAYS = ['حد', 'اتنين', 'تلات', 'أربع', 'خميس', 'جمعة', 'سبت']

/** Settings card: link Odoo so its check-ins/outs feed attendance and the commitment score */
export function OdooCard() {
  const role = useSync((s) => s.role)
  const email = useSync((s) => s.email)
  const isOwner = role === 'owner' || role === 'owner-new'
  const companies = useStore((s) => s.companies)
  const updateCompany = useStore((s) => s.updateCompany)
  const toast = useUI((s) => s.toast)
  const [st, setSt] = useState<OdooStatus | null>(null)
  const [busy, setBusy] = useState<string>('')
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ url: '', db: '', login: '', apiKey: '' })

  const run = async (action: Parameters<typeof odoo>[0], extra?: Record<string, unknown>, label: string = action) => {
    setBusy(label); setError('')
    try {
      const r = await odoo(action, extra)
      setSt(r)
      return r
    } catch (e) {
      setError((e as Error).message)
      return null
    } finally { setBusy('') }
  }

  useEffect(() => { if (syncOn() && email) run('status', undefined, 'load') }, [email]) // eslint-disable-line react-hooks/exhaustive-deps

  // companies with the same name in both get linked on their own
  useEffect(() => {
    if (!isOwner) return
    for (const oc of st?.lastResult?.companies ?? []) {
      const c = oc.madarId && companies.find((x) => x.id === oc.madarId)
      if (c && !c.odooCompanyId && !companies.some((x) => x.odooCompanyId === oc.id)) updateCompany(c.id, { odooCompanyId: oc.id, countAbsence: c.countAbsence ?? true })
    }
  }, [st, isOwner]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!syncOn()) return null
  const r = st?.lastResult
  const err = r?.lastError && (!r.at || r.lastError.at > r.at) ? r.lastError : null

  const connectForm = (
    <form
      className="stack"
      style={{ gap: 12 }}
      onSubmit={async (e) => {
        e.preventDefault()
        const ok = await run('configure', form, 'configure')
        if (ok) { setEditing(false); setForm((f) => ({ ...f, apiKey: '' })); toast({ title: 'أودو اتربط', body: `${ok.lastResult?.added ?? 0} يوم حضور نزلوا`, tone: 'ok' }) }
      }}
    >
      <label className="field"><span>رابط أودو</span>
        <input className="input num" dir="ltr" required placeholder="https://mycompany.odoo.com" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
      </label>
      <label className="field"><span>اسم قاعدة البيانات (سيبيه فاضي لو أودو أونلاين)</span>
        <input className="input num" dir="ltr" value={form.db} onChange={(e) => setForm({ ...form, db: e.target.value })} />
      </label>
      <label className="field"><span>إيميل الدخول على أودو</span>
        <input className="input num" dir="ltr" type="email" required autoComplete="off" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} />
      </label>
      <label className="field"><span>مفتاح الـ API {st?.configured ? '(سيبيه فاضي عشان يفضل القديم)' : ''}</span>
        <input className="input num" dir="ltr" type="password" autoComplete="new-password" required={!st?.configured} value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
      </label>
      <details className="soft" style={{ fontSize: 13 }}>
        <summary style={{ cursor: 'pointer' }}>أجيب مفتاح الـ API منين؟</summary>
        <ol style={{ margin: '8px 0 0', paddingInlineStart: 20, lineHeight: 1.9 }}>
          <li>ادخلي أودو بحساب شايف حضور كل الشركات (مدير الموارد البشرية مثلًا).</li>
          <li>دوسي على صورتك فوق ← التفضيلات (Preferences / My Profile).</li>
          <li>تبويب أمان الحساب (Account Security) ← مفتاح API جديد (New API Key).</li>
          <li>اكتبي اسم زي "مدار"، وانسخي المفتاح وحطيه هنا. أودو مش هيوريهولك تاني.</li>
        </ol>
        <p style={{ margin: '8px 0 0' }}>المفتاح بيتحفظ على سيرفر مدار بس، ومش بيظهر لحد. لو أودو أونلاين، الربط محتاج باقة Custom.</p>
      </details>
      <div className="row wrap">
        <button className="btn primary" disabled={!!busy}>{busy === 'configure' ? 'بنجرب الدخول…' : 'اربطي وجربي'}</button>
        {st?.configured && <button type="button" className="btn ghost" onClick={() => setEditing(false)}>إلغاء</button>}
      </div>
    </form>
  )

  return (
    <div className="card stack" style={{ gap: 12 }}>
      <div className="row"><Icon name="clock" /><h2 style={{ flex: 1 }}>الحضور من أودو</h2>
        {st?.configured && <span className="cdot" style={{ background: err ? 'var(--rose)' : 'var(--green)', boxShadow: `0 0 8px ${err ? 'var(--rose)' : 'var(--green)'}` }} />}
      </div>
      <p className="soft" style={{ margin: 0, fontSize: 14 }}>
        بصمات الحضور والانصراف اللي في أودو بتنزل في مدار كل 10 دقايق، وبتتحسب في "الالتزام بالمواعيد" في التقييم الشهري: التأخير، والخروج بدري، والغياب من غير إجازة.
      </p>

      {busy === 'load' && !st && <span className="muted">بنشوف حالة الربط…</span>}

      {st && !st.configured && (isOwner ? connectForm : <p className="muted" style={{ margin: 0 }}>أودو لسه مش مربوط. صاحبة مدار هي اللي تربطه من هنا.</p>)}

      {st?.configured && editing && isOwner && connectForm}

      {st?.configured && !editing && (
        <>
          <div className="soft num" dir="ltr" style={{ fontSize: 13, textAlign: 'start' }}>{st.url}{st.db ? ` · ${st.db}` : ''} · {st.login}</div>
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
                {r.unmatchedEmployees.slice(0, 40).map((e) => <li key={e.id}>{e.name} <span className="muted num" dir="ltr">{e.email ?? ''}</span>{e.company ? <span className="muted"> · {e.company}</span> : null}</li>)}
              </ul>
            </details>
          )}

          {!!r?.companies?.length && (
            <div className="stack" style={{ gap: 10 }}>
              <h3 style={{ margin: 0, fontSize: 15 }}>الشركات</h3>
              {r.companies.map((oc) => {
                const linked = companies.find((c) => c.odooCompanyId === oc.id)
                return (
                  <div key={oc.id} className="stack" style={{ gap: 8, padding: 10, border: '1px solid var(--line)', borderRadius: 12 }}>
                    <div className="row wrap" style={{ gap: 8 }}>
                      <span style={{ fontWeight: 600, flex: 1, minWidth: 120 }}>{oc.name} <span className="muted" style={{ fontSize: 12 }}>(أودو)</span></span>
                      <select
                        className="select" style={{ width: 'auto' }} disabled={!isOwner} aria-label={`شركة مدار لـ ${oc.name}`}
                        value={linked?.id ?? ''}
                        onChange={(e) => {
                          if (linked) updateCompany(linked.id, { odooCompanyId: undefined })
                          if (e.target.value) updateCompany(e.target.value, { odooCompanyId: oc.id, countAbsence: companies.find((c) => c.id === e.target.value)?.countAbsence ?? true })
                        }}
                      >
                        <option value="">مش مربوطة</option>
                        {companies.map((c) => <option key={c.id} value={c.id} disabled={!!c.odooCompanyId && c.odooCompanyId !== oc.id}>{c.name}</option>)}
                      </select>
                    </div>
                    {linked && (
                      <>
                        <label className="row" style={{ gap: 8, fontSize: 14, cursor: isOwner ? 'pointer' : 'default' }}>
                          <input type="checkbox" disabled={!isOwner} checked={!!linked.countAbsence} onChange={(e) => updateCompany(linked.id, { countAbsence: e.target.checked })} style={{ width: 18, height: 18, accentColor: 'var(--cyan-2)' }} />
                          الغياب في يوم شغل من غير إجازة يتحسب عليه
                        </label>
                        <div className="row wrap" style={{ gap: 6 }} role="group" aria-label="أيام الشغل">
                          <span className="soft" style={{ fontSize: 13 }}>أيام الشغل:</span>
                          {DAYS.map((d, i) => {
                            const days = linked.workDays?.length ? linked.workDays : DEFAULT_WORKDAYS
                            const on = days.includes(i)
                            return <button key={d} type="button" className={`chip ${on ? 'on' : ''}`} aria-pressed={on} disabled={!isOwner} onClick={() => updateCompany(linked.id, { workDays: on ? days.filter((x) => x !== i) : [...days, i].sort() })}>{d}</button>
                          })}
                        </div>
                        <div className="muted" style={{ fontSize: 12 }}>التأخير بعد <span className="num">{linked.workStart}</span> + <span className="num">{linked.graceMinutes}</span> دقيقة سماح، والخروج البدري قبل <span className="num">{linked.workEnd}</span> بأكتر من فترة السماح. بتتغير من صفحة الهيكل.</div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <div className="row wrap">
            <button className="btn primary" disabled={!!busy} onClick={async () => { const x = await run('sync'); if (x) toast({ title: 'اتحدّث من أودو', body: `${x.lastResult?.added ?? 0} جديد · ${x.lastResult?.changed ?? 0} اتعدّل`, tone: 'ok' }) }}>
              <Icon name="refresh" size={18} /> {busy === 'sync' ? 'بنسحب…' : 'حدّثي دلوقتي'}
            </button>
            {isOwner && <button className="btn" disabled={!!busy} title="بعد ما تغيّري ربط الشركات أو المواعيد" onClick={async () => { const x = await run('resync'); if (x) toast({ title: 'اتحسب التاريخ كله من جديد', tone: 'ok' }) }}>{busy === 'resync' ? 'بنعيد الحساب…' : 'اسحبي التاريخ كله تاني'}</button>}
            {isOwner && <button className="btn ghost" disabled={!!busy} onClick={() => { setForm({ url: st.url ?? '', db: st.db ?? '', login: st.login ?? '', apiKey: '' }); setEditing(true) }}>عدّلي الربط</button>}
            {isOwner && <button className="btn ghost danger" disabled={!!busy} onClick={async () => (await ask('نفصل أودو؟ الأيام اللي نزلت هتفضل موجودة.')) && run('disconnect')}>افصلي</button>}
          </div>
        </>
      )}

      {error && <div className="tone-late" role="alert" style={{ fontSize: 14 }}>{error}</div>}
    </div>
  )
}
