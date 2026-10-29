import { useEffect, useMemo, useState } from 'react'
import { ask, useStore, useUI } from '../lib/store'
import { managedUnits, roleIn, useMyCompanies, useUserMap } from '../lib/access'
import type { Company, ID, Kpi, KpiPeriod, Membership, RatingCriterion, ReviewGrade, ReviewRecommendation, Role } from '../lib/types'
import {
  CRITERIA,
  GRADE_COLOR,
  GRADE_LABEL,
  kpiAchievement,
  kpiRollup,
  lastMonths,
  monthKey,
  monthLabel,
  monthScore,
  PERIOD_LABEL,
  personalKpiAchievement,
  ratingAvg,
  RECOMMENDATION_LABEL,
  scoreTone,
  shiftMonth,
  suggestGrade,
  yearAverage,
} from '../lib/performance'
import { fmtShortDate, ROLE_LABEL, UNIT_LABEL } from '../lib/utils'
import { Avatar, Empty, Overlay } from '../components/ui'
import { Icon } from '../components/Icon'

type Tab = 'me' | 'team' | 'kpis' | 'promotions'

/** Who the current user may rate/review in a company */
function useLeadScope(companyId?: ID) {
  const me = useStore((s) => s.currentUserId)!
  const units = useStore((s) => s.units)
  const memberships = useStore((s) => s.memberships)
  return useMemo(() => {
    if (!companyId) return { role: null as Role | null, team: [] as Membership[] }
    const role = roleIn(memberships, me, companyId)
    const members = memberships.filter((m) => m.companyId === companyId && m.userId !== me)
    if (role === 'admin') return { role, team: members }
    if (role === 'manager') {
      const mine = managedUnits(units, memberships, me, companyId)
      return { role, team: members.filter((m) => m.unitId && mine.has(m.unitId)) }
    }
    return { role, team: [] }
  }, [companyId, me, units, memberships])
}

export function Performance() {
  const me = useStore((s) => s.currentUserId)!
  const filter = useUI((s) => s.companyFilter)
  const companies = useMyCompanies()
  const [companyId, setCompanyId] = useState<string>(() => (filter !== 'all' ? filter : companies[0]?.id ?? ''))
  useEffect(() => { if (filter !== 'all') setCompanyId(filter) }, [filter])
  const company = companies.find((c) => c.id === companyId) ?? companies[0]
  const { role, team } = useLeadScope(company?.id)
  const [tab, setTab] = useState<Tab>('me')
  const pendingPromos = useStore((s) => s.promotions.filter((p) => p.companyId === company?.id && p.status === 'proposed').length)

  if (!company) return <div className="card"><Empty icon="chart" title="ضيفي شركة الأول من الهيكل التنظيمي" /></div>
  const lead = role === 'admin' || role === 'manager'

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head">
        <div className="seg" role="tablist" aria-label="أقسام الأداء" style={{ flexWrap: 'wrap' }}>
          <button role="tab" aria-selected={tab === 'me'} className={tab === 'me' ? 'on' : ''} onClick={() => setTab('me')}><Icon name="user" size={16} /> أدائي</button>
          {lead && <button role="tab" aria-selected={tab === 'team'} className={tab === 'team' ? 'on' : ''} onClick={() => setTab('team')}><Icon name="users" size={16} /> الفريق</button>}
          <button role="tab" aria-selected={tab === 'kpis'} className={tab === 'kpis' ? 'on' : ''} onClick={() => setTab('kpis')}><Icon name="target" size={16} /> المؤشرات</button>
          {lead && (
            <button role="tab" aria-selected={tab === 'promotions'} className={tab === 'promotions' ? 'on' : ''} onClick={() => setTab('promotions')}>
              <Icon name="trophy" size={16} /> الترقيات {pendingPromos > 0 && <span className="badge">{pendingPromos}</span>}
            </button>
          )}
        </div>
        <span className="spacer" />
        {companies.length > 1 && (
          <select className="select" style={{ width: 'auto' }} value={company.id} onChange={(e) => setCompanyId(e.target.value)} aria-label="الشركة">
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>

      {tab === 'me' && <PersonPanel company={company} userId={me} self />}
      {tab === 'team' && lead && <TeamPanel company={company} team={team} />}
      {tab === 'kpis' && <KpiPanel company={company} canManage={lead} />}
      {tab === 'promotions' && lead && <PromotionsPanel company={company} isAdmin={role === 'admin'} />}
    </div>
  )
}

/* ---------- one person's performance ---------- */

function PersonPanel({ company, userId, self }: { company: Company; userId: ID; self?: boolean }) {
  const tasks = useStore((s) => s.tasks)
  const attendance = useStore((s) => s.attendance)
  const ratings = useStore((s) => s.ratings)
  const kpis = useStore((s) => s.kpis)
  const reviews = useStore((s) => s.reviews)
  const promotions = useStore((s) => s.promotions)
  const users = useUserMap()
  const [month, setMonth] = useState(monthKey())
  const data = { tasks, attendance, ratings }
  const cur = monthScore(data, userId, company.id, month)
  const history = lastMonths(6, month).map((k) => ({ k, s: monthScore(data, userId, company.id, k).score }))
  const rating = ratings.find((r) => r.userId === userId && r.companyId === company.id && r.month === month)
  const myKpis = kpis.filter((k) => k.companyId === company.id && k.ownerUserId === userId)
  const kpiAvg = personalKpiAchievement(kpis, userId, company.id)
  const year = new Date().getFullYear()
  const review = reviews.find((r) => r.userId === userId && r.companyId === company.id && r.year === year)
  const promos = promotions.filter((p) => p.userId === userId && p.companyId === company.id)
  const isCurrent = month === monthKey()
  const grade = cur.score !== null ? suggestGrade(cur.score) : null

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="grid grid-3">
        <div className="card glow stack span-2" style={{ gap: 14 }}>
          <div className="row">
            <h3>درجة الالتزام</h3>
            <span className="spacer" />
            <button className="btn icon sm" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="الشهر اللي فات"><Icon name="chevronNext" size={16} /></button>
            <span style={{ minWidth: 110, textAlign: 'center', fontSize: 14 }}>{monthLabel(month)}</span>
            <button className="btn icon sm" disabled={isCurrent} onClick={() => setMonth(shiftMonth(month, 1))} aria-label="الشهر الجاي"><Icon name="chevron" size={16} /></button>
          </div>
          <div className="row wrap" style={{ gap: 20 }}>
            <ScoreRing score={cur.score} />
            <div className="stack" style={{ flex: 1, minWidth: 220, gap: 10 }}>
              {cur.parts.map((p) => (
                <div key={p.key} title={p.hint}>
                  <div className="row" style={{ fontSize: 13, marginBottom: 4 }}>
                    <span>{p.label}</span>
                    <span className="muted" style={{ fontSize: 12 }}>· {p.weight}%</span>
                    <span className="spacer" />
                    <span className="muted num" style={{ fontSize: 12 }}>{p.detail}</span>
                  </div>
                  <div className="progress" style={{ height: 7 }}>
                    <i style={{ width: `${(p.value ?? 0) * 100}%`, background: p.value === null ? 'transparent' : undefined }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {grade ? <>المستوى: <b style={{ color: GRADE_COLOR[grade] }}>{GRADE_LABEL[grade]}</b>. </> : null}
            البنود اللي مفيهاش بيانات الشهر ده مش بتتحسب عليكي، ووزنها بيتوزع على الباقي.
          </div>
        </div>

        <div className="card stack" style={{ gap: 10 }}>
          <h3>آخر 6 شهور</h3>
          <HistoryChart points={history} />
          <div className="row" style={{ fontSize: 13 }}>
            <span className="muted">متوسط المؤشرات</span>
            <span className="spacer" />
            <b className="num" style={{ color: kpiAvg === null ? 'var(--muted)' : scoreTone(kpiAvg) }}>{kpiAvg === null ? '—' : `${kpiAvg}%`}</b>
          </div>
        </div>
      </div>

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div className="card stack">
          <div className="card-head" style={{ marginBottom: 4 }}><h3>تقييم المدير · {monthLabel(month)}</h3></div>
          {rating ? (
            <>
              {CRITERIA.map((c) => (
                <div key={c.key} className="row" style={{ fontSize: 14 }}>
                  <span style={{ flex: 1 }}>{c.label}</span>
                  <Stars value={rating.scores[c.key]} />
                </div>
              ))}
              <div className="divider" style={{ margin: '4px 0' }} />
              <div className="row" style={{ fontSize: 13 }}>
                <Avatar user={users[rating.raterId]} size="sm" />
                <span className="soft">{users[rating.raterId]?.name}</span>
                <span className="spacer" />
                <b className="num">{ratingAvg(rating).toFixed(1)} / 5</b>
              </div>
              {rating.note && <p className="soft" style={{ margin: 0, fontSize: 14 }}>"{rating.note}"</p>}
            </>
          ) : (
            <span className="muted" style={{ fontSize: 14 }}>{self ? 'مديرك لسه ما قيّمكيش الشهر ده.' : 'لسه ما اتقيمش الشهر ده.'}</span>
          )}
        </div>

        <div className="card stack">
          <div className="card-head" style={{ marginBottom: 4 }}><h3>{self ? 'مؤشراتي' : 'المؤشرات الشخصية'}</h3></div>
          {myKpis.length === 0 && <span className="muted" style={{ fontSize: 14 }}>مفيش مؤشرات شخصية متحددة.</span>}
          {myKpis.map((k) => <KpiLine key={k.id} k={k} all={kpis} />)}
        </div>
      </div>

      {(review || promos.length > 0) && (
        <div className="grid grid-2" style={{ alignItems: 'start' }}>
          {review && <ReviewCard review={review} />}
          {promos.length > 0 && (
            <div className="card stack">
              <h3>الترقيات</h3>
              {promos.map((p) => <PromoRow key={p.id} p={p} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ScoreRing({ score, size = 150 }: { score: number | null; size?: number }) {
  const r = size / 2 - 11
  const c = 2 * Math.PI * r
  const color = scoreTone(score)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={score === null ? 'مفيش بيانات' : `${score} من 100`} style={{ flex: 'none' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="12" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
        strokeDasharray={`${((score ?? 0) / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dasharray .6s ease', filter: `drop-shadow(0 0 8px ${color})` }} />
      <text x={size / 2} y={size / 2 + 6} textAnchor="middle" fill="#E8ECF6" fontFamily="Readex Pro" fontSize={size / 4} fontWeight="700">{score ?? '—'}</text>
      {size >= 120 && <text x={size / 2} y={size / 2 + 28} textAnchor="middle" fill="#8B96B0" fontFamily="IBM Plex Sans Arabic" fontSize="12">من 100</text>}
    </svg>
  )
}

function HistoryChart({ points }: { points: { k: string; s: number | null }[] }) {
  const W = 300, H = 150, pad = 22
  const bw = (W - pad * 2) / points.length
  return (
    <svg viewBox={`0 0 ${W} ${H + 22}`} width="100%" role="img" aria-label="درجات آخر 6 شهور" style={{ direction: 'ltr' }}>
      {[50, 75, 100].map((g) => {
        const y = H - (g / 100) * (H - 10)
        return (
          <g key={g}>
            <line x1={pad} x2={W - pad} y1={y} y2={y} stroke="rgba(255,255,255,0.07)" strokeDasharray="3 4" />
            <text x={pad - 4} y={y + 4} textAnchor="end" fontSize="9" fill="#8B96B0">{g}</text>
          </g>
        )
      })}
      {/* oldest on the right so time reads right-to-left like the rest of the app */}
      {[...points].reverse().map((p, i) => {
        const h = p.s === null ? 0 : (p.s / 100) * (H - 10)
        const x = pad + i * bw + bw * 0.2
        const last = i === 0
        return (
          <g key={p.k}>
            <rect x={x} y={H - h} width={bw * 0.6} height={Math.max(h, 0)} rx="5" fill={p.s === null ? 'transparent' : scoreTone(p.s)} opacity={last ? 1 : 0.55} />
            {p.s !== null && <text x={x + bw * 0.3} y={H - h - 5} textAnchor="middle" fontSize="10" fill="#E8ECF6" fontFamily="Readex Pro">{p.s}</text>}
            <text x={x + bw * 0.3} y={H + 15} textAnchor="middle" fontSize="10" fill="#8B96B0">{monthLabel(p.k, true)}</text>
          </g>
        )
      })}
    </svg>
  )
}

export function Stars({ value, onChange, size = 18, label }: { value: number; onChange?: (v: number) => void; size?: number; label?: string }) {
  return (
    <span className="row" style={{ gap: 2 }} role={onChange ? 'radiogroup' : 'img'} aria-label={label ?? `${value} من 5`}>
      {[1, 2, 3, 4, 5].map((n) =>
        onChange ? (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} من 5`} onClick={() => onChange(n)}
            style={{ background: 'none', border: 0, padding: 4, cursor: 'pointer', color: n <= value ? '#FBBF24' : 'rgba(255,255,255,0.2)' }}>
            <svg width={size + 6} height={size + 6} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /></svg>
          </button>
        ) : (
          <svg key={n} width={size} height={size} viewBox="0 0 24 24" fill={n <= value ? '#FBBF24' : 'rgba(255,255,255,0.15)'} aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /></svg>
        ),
      )}
    </span>
  )
}

/* ---------- team (managers) ---------- */

function TeamPanel({ company, team }: { company: Company; team: Membership[] }) {
  const tasks = useStore((s) => s.tasks)
  const attendance = useStore((s) => s.attendance)
  const ratings = useStore((s) => s.ratings)
  const kpis = useStore((s) => s.kpis)
  const reviews = useStore((s) => s.reviews)
  const units = useStore((s) => s.units)
  const users = useUserMap()
  const [modal, setModal] = useState<null | { kind: 'rate' | 'review' | 'promote' | 'view'; userId: ID }>(null)
  const month = monthKey()
  const prev = shiftMonth(month, -1)
  const data = { tasks, attendance, ratings }
  const year = new Date().getFullYear()

  const rows = team
    .map((m) => {
      const now = monthScore(data, m.userId, company.id, month).score
      const last = monthScore(data, m.userId, company.id, prev).score
      return { m, now, last, kpi: personalKpiAchievement(kpis, m.userId, company.id), rated: ratings.some((r) => r.userId === m.userId && r.companyId === company.id && r.month === month), reviewed: reviews.some((r) => r.userId === m.userId && r.companyId === company.id && r.year === year) }
    })
    .sort((a, b) => (b.now ?? -1) - (a.now ?? -1))
  const scored = rows.filter((r) => r.now !== null)
  const avg = scored.length ? Math.round(scored.reduce((s, r) => s + (r.now ?? 0), 0) / scored.length) : null
  const notRated = rows.filter((r) => !r.rated).length

  if (!team.length) return <div className="card"><Empty icon="users" title="مفيش حد في فريقك هنا لسه" /></div>

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="grid grid-3">
        <div className="card stat"><span className="v" style={{ color: scoreTone(avg) }}>{avg ?? '—'}</span><span className="l">متوسط الفريق · {monthLabel(month)}</span></div>
        <div className="card stat"><span className="v">{scored[0] ? users[scored[0].m.userId]?.name.split(' ')[0] : '—'}</span><span className="l">الأعلى الشهر ده{scored[0] ? ` (${scored[0].now})` : ''}</span></div>
        <div className="card stat"><span className="v" style={{ color: notRated ? 'var(--amber)' : 'var(--green-2)' }}>{notRated}</span><span className="l">لسه محتاجين تقييم الشهر ده</span></div>
      </div>

      <div className="card">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>الاسم</th><th>الشهر ده</th><th>الشهر اللي فات</th><th>المؤشرات</th><th>تقييم الشهر</th><th><span className="sr-only">إجراءات</span></th></tr>
            </thead>
            <tbody>
              {rows.map(({ m, now, last, kpi, rated, reviewed }) => {
                const u = users[m.userId]
                const diff = now !== null && last !== null ? now - last : null
                return (
                  <tr key={m.userId}>
                    <td>
                      <button className="row" style={{ gap: 8, background: 'none', border: 0, color: 'inherit', cursor: 'pointer', padding: 0, textAlign: 'start' }} onClick={() => setModal({ kind: 'view', userId: m.userId })}>
                        <Avatar user={u} size="sm" />
                        <span>
                          <span style={{ display: 'block' }}>{u?.name}</span>
                          <span className="muted" style={{ fontSize: 12 }}>{m.title || ROLE_LABEL[m.role]}{m.unitId ? ` · ${units.find((x) => x.id === m.unitId)?.name ?? ''}` : ''}</span>
                        </span>
                      </button>
                    </td>
                    <td><b className="num" style={{ color: scoreTone(now), fontSize: 18 }}>{now ?? '—'}</b>{diff !== null && diff !== 0 && <span className="num" style={{ fontSize: 12, color: diff > 0 ? 'var(--green-2)' : 'var(--rose)', marginInlineStart: 6 }}>{diff > 0 ? `+${diff}` : diff}</span>}</td>
                    <td className="num" style={{ color: scoreTone(last) }}>{last ?? '—'}</td>
                    <td className="num">{kpi === null ? '—' : `${kpi}%`}</td>
                    <td>{rated ? <span className="pill" style={{ background: 'rgba(52,211,153,.12)', color: 'var(--green-2)' }}><Icon name="check" size={12} /> اتقيّم</span> : <span className="pill" style={{ background: 'rgba(251,191,36,.12)', color: 'var(--amber)' }}>لسه</span>}</td>
                    <td>
                      <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        <button className="btn sm" onClick={() => setModal({ kind: 'rate', userId: m.userId })}><Icon name="star" size={15} /> {rated ? 'عدّلي' : 'قيّمي'}</button>
                        <button className="btn ghost icon sm" title="التقييم السنوي" aria-label={`التقييم السنوي لـ ${u?.name}`} onClick={() => setModal({ kind: 'review', userId: m.userId })} style={reviewed ? { color: 'var(--green-2)' } : undefined}><Icon name="review" size={17} /></button>
                        <button className="btn ghost icon sm" title="اقتراح ترقية" aria-label={`اقتراح ترقية لـ ${u?.name}`} onClick={() => setModal({ kind: 'promote', userId: m.userId })}><Icon name="trophy" size={17} /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>الدرجة بتتحسب لوحدها من المهام والحضور وتقييمك. دوسي على أي اسم عشان تشوفي التفاصيل.</div>
      </div>

      {modal?.kind === 'rate' && <RateModal company={company} userId={modal.userId} onClose={() => setModal(null)} />}
      {modal?.kind === 'review' && <ReviewModal company={company} userId={modal.userId} onClose={() => setModal(null)} onPromote={() => setModal({ kind: 'promote', userId: modal.userId })} />}
      {modal?.kind === 'promote' && <PromoteModal company={company} userId={modal.userId} onClose={() => setModal(null)} />}
      {modal?.kind === 'view' && (
        <Overlay kind="drawer" label={users[modal.userId]?.name ?? ''} onClose={() => setModal(null)}>
          <div className="stack" style={{ gap: 14 }}>
            <div className="row">
              <Avatar user={users[modal.userId]} size="lg" />
              <h2>{users[modal.userId]?.name}</h2>
              <span className="spacer" />
              <button className="btn ghost icon" onClick={() => setModal(null)} aria-label="إغلاق"><Icon name="close" /></button>
            </div>
            <PersonPanel company={company} userId={modal.userId} />
          </div>
        </Overlay>
      )}
    </div>
  )
}

function RateModal({ company, userId, onClose }: { company: Company; userId: ID; onClose: () => void }) {
  const me = useStore((s) => s.currentUserId)!
  const existing = useStore((s) => s.ratings.find((r) => r.userId === userId && r.companyId === company.id && r.month === monthKey()))
  const rateMonth = useStore((s) => s.rateMonth)
  const toast = useUI((s) => s.toast)
  const users = useUserMap()
  const [scores, setScores] = useState<Record<RatingCriterion, number>>(existing?.scores ?? { quality: 0, speed: 0, teamwork: 0, initiative: 0, discipline: 0 })
  const [note, setNote] = useState(existing?.note ?? '')
  const complete = CRITERIA.every((c) => scores[c.key] > 0)
  return (
    <Overlay onClose={onClose} label="تقييم شهري">
      <form className="stack" style={{ gap: 14 }} onSubmit={(e) => {
        e.preventDefault()
        if (!complete) return
        rateMonth({ companyId: company.id, userId, raterId: me, month: monthKey(), scores, note: note.trim() || undefined })
        toast({ title: `اتسجل تقييم ${users[userId]?.name.split(' ')[0]}`, tone: 'ok' })
        onClose()
      }}>
        <div className="row"><Avatar user={users[userId]} /><div><h2>تقييم {users[userId]?.name}</h2><div className="muted" style={{ fontSize: 13 }}>{monthLabel(monthKey())} · {company.short}</div></div></div>
        {CRITERIA.map((c) => (
          <div key={c.key} className="row wrap" style={{ justifyContent: 'space-between' }}>
            <span>{c.label}</span>
            <Stars value={scores[c.key]} onChange={(v) => setScores((s) => ({ ...s, [c.key]: v }))} label={c.label} />
          </div>
        ))}
        <label className="field"><span>ملاحظة (هتوصله)</span><textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً: شغل ممتاز في عرض الساحل، محتاج يركز في مواعيد التسليم" /></label>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>إلغاء</button>
          <button className="btn primary" disabled={!complete}>احفظي التقييم</button>
        </div>
      </form>
    </Overlay>
  )
}

function ReviewModal({ company, userId, onClose, onPromote }: { company: Company; userId: ID; onClose: () => void; onPromote: () => void }) {
  const me = useStore((s) => s.currentUserId)!
  const tasks = useStore((s) => s.tasks)
  const attendance = useStore((s) => s.attendance)
  const ratings = useStore((s) => s.ratings)
  const kpis = useStore((s) => s.kpis)
  const year = new Date().getFullYear()
  const existing = useStore((s) => s.reviews.find((r) => r.userId === userId && r.companyId === company.id && r.year === year))
  const saveReview = useStore((s) => s.saveReview)
  const toast = useUI((s) => s.toast)
  const users = useUserMap()
  const avgScore = yearAverage({ tasks, attendance, ratings }, userId, company.id, year)
  const kpiAch = personalKpiAchievement(kpis, userId, company.id)
  const blended = avgScore === null ? kpiAch : kpiAch === null ? avgScore : Math.round(avgScore * 0.7 + kpiAch * 0.3)
  const [grade, setGrade] = useState<ReviewGrade>(existing?.grade ?? suggestGrade(blended))
  const [rec, setRec] = useState<ReviewRecommendation>(existing?.recommendation ?? (blended !== null && blended >= 88 ? 'promotion' : blended !== null && blended >= 78 ? 'raise' : blended !== null && blended < 60 ? 'improve' : 'keep'))
  const [strengths, setStrengths] = useState(existing?.strengths ?? '')
  const [improvements, setImprovements] = useState(existing?.improvements ?? '')

  return (
    <Overlay onClose={onClose} label="التقييم السنوي">
      <form className="stack" style={{ gap: 14 }} onSubmit={(e) => {
        e.preventDefault()
        saveReview({ companyId: company.id, userId, reviewerId: me, year, avgScore, kpiAchievement: kpiAch, grade, recommendation: rec, strengths: strengths.trim(), improvements: improvements.trim() })
        toast({ title: 'اتحفظ التقييم السنوي', tone: 'ok' })
        if (rec === 'promotion' && !existing) onPromote()
        else onClose()
      }}>
        <div className="row"><Avatar user={users[userId]} /><div><h2>التقييم السنوي {year}</h2><div className="muted" style={{ fontSize: 13 }}>{users[userId]?.name} · {company.short}</div></div></div>
        <div className="grid grid-3" style={{ gap: 10 }}>
          <div className="card stat" style={{ padding: 12 }}><span className="v" style={{ color: scoreTone(avgScore), fontSize: 24 }}>{avgScore ?? '—'}</span><span className="l">متوسط الالتزام</span></div>
          <div className="card stat" style={{ padding: 12 }}><span className="v" style={{ color: scoreTone(kpiAch), fontSize: 24 }}>{kpiAch === null ? '—' : `${kpiAch}%`}</span><span className="l">تحقيق المؤشرات</span></div>
          <div className="card stat" style={{ padding: 12 }}><span className="v" style={{ color: scoreTone(blended), fontSize: 24 }}>{blended ?? '—'}</span><span className="l">المحصلة (70/30)</span></div>
        </div>
        <div className="field">
          <span>التقدير</span>
          <div className="row wrap" style={{ gap: 6 }}>
            {(Object.keys(GRADE_LABEL) as ReviewGrade[]).map((g) => (
              <button type="button" key={g} className="chip" aria-pressed={grade === g} onClick={() => setGrade(g)}
                style={grade === g ? { background: GRADE_COLOR[g], color: '#070A14', borderColor: GRADE_COLOR[g], fontWeight: 600 } : { color: GRADE_COLOR[g], borderColor: `${GRADE_COLOR[g]}66` }}>{GRADE_LABEL[g]}</button>
            ))}
          </div>
        </div>
        <label className="field"><span>التوصية</span>
          <select className="select" value={rec} onChange={(e) => setRec(e.target.value as ReviewRecommendation)}>
            {(Object.keys(RECOMMENDATION_LABEL) as ReviewRecommendation[]).map((r) => <option key={r} value={r}>{RECOMMENDATION_LABEL[r]}</option>)}
          </select>
        </label>
        <label className="field"><span>نقط القوة</span><textarea className="textarea" value={strengths} onChange={(e) => setStrengths(e.target.value)} /></label>
        <label className="field"><span>محتاج يطوّر</span><textarea className="textarea" value={improvements} onChange={(e) => setImprovements(e.target.value)} /></label>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>إلغاء</button>
          <button className="btn primary">{rec === 'promotion' && !existing ? 'احفظي واقترحي الترقية' : 'احفظي'}</button>
        </div>
      </form>
    </Overlay>
  )
}

function ReviewCard({ review }: { review: import('../lib/types').AnnualReview }) {
  const users = useUserMap()
  return (
    <div className="card stack" style={{ borderColor: `${GRADE_COLOR[review.grade]}55` }}>
      <div className="row">
        <h3>التقييم السنوي {review.year}</h3>
        <span className="spacer" />
        <span className="pill" style={{ background: `${GRADE_COLOR[review.grade]}22`, color: GRADE_COLOR[review.grade], fontWeight: 600 }}>{GRADE_LABEL[review.grade]}</span>
      </div>
      <div className="row wrap" style={{ fontSize: 13, gap: 14 }}>
        <span className="muted">متوسط الالتزام <b className="num" style={{ color: scoreTone(review.avgScore) }}>{review.avgScore ?? '—'}</b></span>
        <span className="muted">المؤشرات <b className="num" style={{ color: scoreTone(review.kpiAchievement) }}>{review.kpiAchievement === null ? '—' : `${review.kpiAchievement}%`}</b></span>
        <span className="muted">التوصية <b style={{ color: 'var(--text)' }}>{RECOMMENDATION_LABEL[review.recommendation]}</b></span>
      </div>
      {review.strengths && <div><div className="muted" style={{ fontSize: 12 }}>نقط القوة</div><div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{review.strengths}</div></div>}
      {review.improvements && <div><div className="muted" style={{ fontSize: 12 }}>محتاج يطوّر</div><div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{review.improvements}</div></div>}
      <div className="muted" style={{ fontSize: 12 }}>بواسطة {users[review.reviewerId]?.name} · {fmtShortDate(review.at)}</div>
    </div>
  )
}

/* ---------- promotions ---------- */

function PromoteModal({ company, userId, onClose }: { company: Company; userId: ID; onClose: () => void }) {
  const me = useStore((s) => s.currentUserId)!
  const membership = useStore((s) => s.memberships.find((m) => m.userId === userId && m.companyId === company.id))
  const propose = useStore((s) => s.proposePromotion)
  const decide = useStore((s) => s.decidePromotion)
  const myRole = useStore((s) => roleIn(s.memberships, me, company.id))
  const toast = useUI((s) => s.toast)
  const users = useUserMap()
  const next = new Date()
  next.setMonth(next.getMonth() + 1, 1)
  const [toTitle, setToTitle] = useState('')
  const [toRole, setToRole] = useState<Role | ''>('')
  const [reason, setReason] = useState('')
  const [date, setDate] = useState(next.toISOString().slice(0, 10))
  return (
    <Overlay onClose={onClose} label="اقتراح ترقية">
      <form className="stack" style={{ gap: 14 }} onSubmit={(e) => {
        e.preventDefault()
        if (!toTitle.trim() || !reason.trim()) return
        propose({ companyId: company.id, userId, proposedBy: me, fromTitle: membership?.title, toTitle: toTitle.trim(), toRole: toRole || undefined, reason: reason.trim(), effectiveDate: date })
        if (myRole === 'admin') {
          // an admin's own proposal is approved on the spot
          const p = useStore.getState().promotions[0]
          decide(p.id, true, me)
          toast({ title: 'اتعتمدت الترقية', body: `${users[userId]?.name} بقى ${toTitle.trim()}`, tone: 'ok' })
        } else toast({ title: 'اتبعت اقتراح الترقية للمدير العام', tone: 'ok' })
        onClose()
      }}>
        <div className="row"><Avatar user={users[userId]} /><div><h2>ترقية {users[userId]?.name}</h2><div className="muted" style={{ fontSize: 13 }}>دلوقتي: {membership?.title || ROLE_LABEL[membership?.role ?? 'employee']}</div></div></div>
        <label className="field"><span>المسمى الجديد</span><input className="input" autoFocus value={toTitle} onChange={(e) => setToTitle(e.target.value)} placeholder="مثلاً: مدير مشتريات أول" /></label>
        <div className="grid grid-2" style={{ gap: 12 }}>
          <label className="field"><span>الصلاحية</span>
            <select className="select" value={toRole} onChange={(e) => setToRole(e.target.value as Role | '')}>
              <option value="">زي ما هي</option>
              {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </label>
          <label className="field"><span>تبدأ من</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        <label className="field"><span>السبب</span><textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="إنجازات أو أرقام تبرر الترقية" /></label>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>إلغاء</button>
          <button className="btn primary" disabled={!toTitle.trim() || !reason.trim()}>{myRole === 'admin' ? 'اعتمدي الترقية' : 'ابعتي الاقتراح'}</button>
        </div>
      </form>
    </Overlay>
  )
}

function PromoRow({ p, actions }: { p: import('../lib/types').Promotion; actions?: React.ReactNode }) {
  const users = useUserMap()
  const st = { proposed: { t: 'مستني اعتماد', c: 'var(--amber)' }, approved: { t: 'اتعتمدت', c: 'var(--green-2)' }, rejected: { t: 'اترفضت', c: 'var(--rose)' } }[p.status]
  return (
    <div className="row wrap" style={{ padding: '12px 14px', borderRadius: 16, background: 'var(--panel)', border: '1px solid var(--line)', alignItems: 'flex-start' }}>
      <Avatar user={users[p.userId]} />
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontWeight: 600 }}>{users[p.userId]?.name}</div>
        <div style={{ fontSize: 14 }}><span className="muted">{p.fromTitle ?? '—'}</span> ← <b style={{ color: 'var(--cyan-2)' }}>{p.toTitle}</b>{p.toRole ? <span className="muted"> ({ROLE_LABEL[p.toRole]})</span> : null}</div>
        <div className="soft" style={{ fontSize: 13, marginTop: 4 }}>{p.reason}</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>اقترحها {users[p.proposedBy]?.name} · تبدأ <span className="num">{p.effectiveDate}</span></div>
      </div>
      <div className="col" style={{ alignItems: 'flex-end', gap: 8 }}>
        <span className="pill" style={{ background: 'rgba(255,255,255,.06)', color: st.c }}>{st.t}</span>
        {actions}
      </div>
    </div>
  )
}

function PromotionsPanel({ company, isAdmin }: { company: Company; isAdmin: boolean }) {
  const me = useStore((s) => s.currentUserId)!
  const promotions = useStore((s) => s.promotions).filter((p) => p.companyId === company.id)
  const decide = useStore((s) => s.decidePromotion)
  const toast = useUI((s) => s.toast)
  const pending = promotions.filter((p) => p.status === 'proposed')
  const done = promotions.filter((p) => p.status !== 'proposed')
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 860 }}>
      <h3>مستنية اعتماد</h3>
      {pending.length === 0 && <span className="muted" style={{ fontSize: 14 }}>مفيش اقتراحات جديدة. اقترحي ترقية من تبويب الفريق.</span>}
      {pending.map((p) => (
        <PromoRow key={p.id} p={p} actions={isAdmin && (
          <div className="row" style={{ gap: 6 }}>
            <button className="btn ghost sm" onClick={() => { decide(p.id, false, me); toast({ title: 'اترفض الاقتراح' }) }}>ارفضي</button>
            <button className="btn primary sm" onClick={() => { decide(p.id, true, me); toast({ title: 'اتعتمدت الترقية', tone: 'ok' }) }}>اعتمدي</button>
          </div>
        )} />
      ))}
      {!isAdmin && pending.length > 0 && <span className="muted" style={{ fontSize: 12 }}>الاعتماد بيبقى من المدير العام.</span>}
      {done.length > 0 && <><h3 style={{ marginTop: 8 }}>اللي اتقرر</h3>{done.map((p) => <PromoRow key={p.id} p={p} />)}</>}
    </div>
  )
}

/* ---------- KPIs ---------- */

function KpiLine({ k, all, onEdit, onAddChild, canUpdate }: { k: Kpi; all: Kpi[]; onEdit?: () => void; onAddChild?: () => void; canUpdate?: boolean }) {
  const updateKpi = useStore((s) => s.updateKpi)
  const users = useUserMap()
  const units = useStore((s) => s.units)
  const hasKids = all.some((x) => x.parentId === k.id)
  const ach = kpiRollup(k, all)
  const own = kpiAchievement(k)
  const owner = k.ownerUserId ? users[k.ownerUserId]?.name : k.ownerUnitId ? units.find((u) => u.id === k.ownerUnitId)?.name : 'الشركة كلها'
  const [val, setVal] = useState(String(k.current))
  useEffect(() => setVal(String(k.current)), [k.current])
  return (
    <div style={{ padding: '10px 12px', borderRadius: 14, background: 'var(--panel)', border: '1px solid var(--line)' }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <span style={{ fontWeight: 600, flex: 1, minWidth: 160 }}>{k.title}</span>
        <span className="pill" style={{ background: 'rgba(255,255,255,.06)', color: 'var(--soft)' }}>{PERIOD_LABEL[k.period]}</span>
        {!k.higherIsBetter && <span className="pill" style={{ background: 'rgba(255,255,255,.06)', color: 'var(--soft)' }}>الأقل أحسن</span>}
        <b className="num" style={{ color: scoreTone(Math.min(ach, 100)), minWidth: 44, textAlign: 'end' }}>{ach}%</b>
      </div>
      <div className="progress" style={{ height: 7, margin: '8px 0 6px' }}>
        <i style={{ width: `${Math.min(ach, 100)}%`, background: scoreTone(Math.min(ach, 100)) }} />
      </div>
      <div className="row wrap" style={{ fontSize: 12, gap: 8 }}>
        <span className="muted">{owner}</span>
        <span className="spacer" />
        {canUpdate && !hasKids ? (
          <label className="row" style={{ gap: 4 }}>
            <span className="muted">الحالي</span>
            <input className="input num" style={{ width: 90, minHeight: 32, padding: '4px 8px' }} inputMode="decimal" value={val} aria-label={`القيمة الحالية لـ ${k.title}`}
              onChange={(e) => setVal(e.target.value)} onBlur={() => { const n = Number(val); if (!Number.isNaN(n)) updateKpi(k.id, { current: n }); else setVal(String(k.current)) }} />
          </label>
        ) : (
          <span className="num soft">{k.current}</span>
        )}
        <span className="muted num">من {k.target} {k.unit}</span>
        {hasKids && <span className="muted">(قيمته الذاتية {own}%، النسبة من المؤشرات اللي تحته)</span>}
        {onAddChild && <button className="btn ghost icon sm" onClick={onAddChild} aria-label={`مؤشر فرعي تحت ${k.title}`} title="مؤشر فرعي"><Icon name="plus" size={15} /></button>}
        {onEdit && <button className="btn ghost icon sm" onClick={onEdit} aria-label={`تعديل ${k.title}`} title="تعديل"><Icon name="edit" size={15} /></button>}
      </div>
    </div>
  )
}

function KpiPanel({ company, canManage }: { company: Company; canManage: boolean }) {
  const me = useStore((s) => s.currentUserId)!
  const kpis = useStore((s) => s.kpis).filter((k) => k.companyId === company.id)
  const [edit, setEdit] = useState<null | { kpi?: Kpi; parentId: ID | null }>(null)
  const roots = kpis.filter((k) => !k.parentId || !kpis.some((x) => x.id === k.parentId))
  const overall = roots.length ? Math.round(roots.reduce((s, k) => s + Math.min(100, kpiRollup(k, kpis)) * k.weight, 0) / roots.reduce((s, k) => s + k.weight, 0)) : null

  const node = (k: Kpi): React.ReactNode => {
    const kids = kpis.filter((x) => x.parentId === k.id)
    return (
      <div key={k.id}>
        <KpiLine k={k} all={kpis} canUpdate={canManage || k.ownerUserId === me}
          onEdit={canManage ? () => setEdit({ kpi: k, parentId: k.parentId }) : undefined}
          onAddChild={canManage ? () => setEdit({ parentId: k.id }) : undefined} />
        {kids.length > 0 && <div className="tree-children">{kids.map(node)}</div>}
      </div>
    )
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card row wrap" style={{ gap: 18 }}>
        <ScoreRing score={overall} size={92} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <h3>أهداف {company.name}</h3>
          <div className="soft" style={{ fontSize: 13 }}>كل هدف كبير بيتقسم على الإدارات والأفراد، ونسبته بتتحسب من اللي تحته. حدّثي الأرقام وهي هتتجمع لوحدها.</div>
        </div>
        {canManage && <button className="btn primary sm" onClick={() => setEdit({ parentId: null })}><Icon name="plus" size={16} /> هدف جديد</button>}
      </div>
      {roots.length === 0 && <div className="card"><Empty icon="target" title="مفيش مؤشرات لسه" /></div>}
      <div className="tree">{roots.map(node)}</div>
      {edit && <KpiModal company={company} kpi={edit.kpi} parentId={edit.parentId} onClose={() => setEdit(null)} />}
    </div>
  )
}

function KpiModal({ company, kpi, parentId, onClose }: { company: Company; kpi?: Kpi; parentId: ID | null; onClose: () => void }) {
  const addKpi = useStore((s) => s.addKpi)
  const updateKpi = useStore((s) => s.updateKpi)
  const removeKpi = useStore((s) => s.removeKpi)
  const units = useStore((s) => s.units).filter((u) => u.companyId === company.id)
  const memberships = useStore((s) => s.memberships).filter((m) => m.companyId === company.id)
  const users = useUserMap()
  const parent = useStore((s) => s.kpis.find((k) => k.id === parentId))
  const [f, setF] = useState<Omit<Kpi, 'id'>>(kpi ?? { companyId: company.id, parentId, title: '', unit: '', target: 0, current: 0, higherIsBetter: true, period: parent?.period ?? 'quarter', weight: 3 })
  const owner = f.ownerUserId ? `u:${f.ownerUserId}` : f.ownerUnitId ? `o:${f.ownerUnitId}` : ''
  const set = <K extends keyof Kpi>(k: K, v: Kpi[K]) => setF((x) => ({ ...x, [k]: v }))
  return (
    <Overlay onClose={onClose} label="مؤشر أداء">
      <form className="stack" style={{ gap: 14 }} onSubmit={(e) => {
        e.preventDefault()
        if (!f.title.trim() || !f.target) return
        if (kpi) updateKpi(kpi.id, f)
        else addKpi({ ...f, title: f.title.trim() })
        onClose()
      }}>
        <h2>{kpi ? 'تعديل المؤشر' : parent ? `مؤشر تحت "${parent.title}"` : 'هدف جديد'}</h2>
        <label className="field"><span>الهدف</span><input className="input" autoFocus value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="مثلاً: عملاء جدد" /></label>
        <div className="grid grid-3" style={{ gap: 10 }}>
          <label className="field"><span>المستهدف</span><input className="input num" inputMode="decimal" value={f.target || ''} onChange={(e) => set('target', Number(e.target.value) || 0)} /></label>
          <label className="field"><span>الحالي</span><input className="input num" inputMode="decimal" value={f.current} onChange={(e) => set('current', Number(e.target.value) || 0)} /></label>
          <label className="field"><span>الوحدة</span><input className="input" value={f.unit} onChange={(e) => set('unit', e.target.value)} placeholder="عميل، %، جنيه" /></label>
        </div>
        <div className="grid grid-3" style={{ gap: 10 }}>
          <label className="field"><span>الفترة</span>
            <select className="select" value={f.period} onChange={(e) => set('period', e.target.value as KpiPeriod)}>
              {(Object.keys(PERIOD_LABEL) as KpiPeriod[]).map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}
            </select>
          </label>
          <label className="field"><span>الأهمية (1-5)</span><input className="input num" type="number" min={1} max={5} value={f.weight} onChange={(e) => set('weight', Math.max(1, Math.min(5, Number(e.target.value) || 1)))} /></label>
          <label className="field"><span>الأحسن</span>
            <select className="select" value={f.higherIsBetter ? 'up' : 'down'} onChange={(e) => set('higherIsBetter', e.target.value === 'up')}>
              <option value="up">الأعلى</option>
              <option value="down">الأقل (زي التكلفة)</option>
            </select>
          </label>
        </div>
        <label className="field"><span>مسؤول عنه</span>
          <select className="select" value={owner} onChange={(e) => {
            const v = e.target.value
            setF((x) => ({ ...x, ownerUserId: v.startsWith('u:') ? v.slice(2) : undefined, ownerUnitId: v.startsWith('o:') ? v.slice(2) : undefined }))
          }}>
            <option value="">الشركة كلها</option>
            <optgroup label="وحدات">{units.map((u) => <option key={u.id} value={`o:${u.id}`}>{UNIT_LABEL[u.type]}: {u.name}</option>)}</optgroup>
            <optgroup label="أفراد">{memberships.map((m) => <option key={m.userId} value={`u:${m.userId}`}>{users[m.userId]?.name}</option>)}</optgroup>
          </select>
        </label>
        <div className="row">
          {kpi && <button type="button" className="btn danger sm" onClick={async () => { if (await ask(`نمسح "${kpi.title}"؟ المؤشرات اللي تحته هتطلع مستوى لفوق.`)) { removeKpi(kpi.id); onClose() } }}><Icon name="trash" size={16} /> امسحي</button>}
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>إلغاء</button>
          <button className="btn primary" disabled={!f.title.trim() || !f.target}>{kpi ? 'احفظي' : 'ضيفي'}</button>
        </div>
      </form>
    </Overlay>
  )
}
