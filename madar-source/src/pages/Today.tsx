import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useStore, useUI } from '../lib/store'
import { useMe, useMyCompanies, useVisibleTasks } from '../lib/access'
import { endOfDay, fmtDay, fmtTime, greeting, hexA, isToday, PRIORITY_WEIGHT, startOfDay } from '../lib/utils'
import type { Task } from '../lib/types'
import { TaskRow } from '../components/TaskRow'
import { Empty, Ring } from '../components/ui'
import { Icon } from '../components/Icon'

const byUrgency = (a: Task, b: Task) =>
  (a.dueAt ? new Date(a.dueAt).getTime() : Infinity) - (b.dueAt ? new Date(b.dueAt).getTime() : Infinity) ||
  PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority]

export function Today() {
  const me = useMe()!
  const tasks = useVisibleTasks()
  const companies = useMyCompanies()
  const attendance = useStore((s) => s.attendance)
  const memberships = useStore((s) => s.memberships)
  const filter = useUI((s) => s.companyFilter)
  const openNewTask = useUI((s) => s.openNewTask)

  const mine = tasks.filter((t) => t.assigneeId === me.id)
  const now = new Date()
  const groups = useMemo(() => {
    const sod = startOfDay().getTime()
    const eod = endOfDay().getTime()
    const week = eod + 7 * 864e5
    const open = mine.filter((t) => t.status !== 'done')
    return {
      late: open.filter((t) => t.dueAt && new Date(t.dueAt).getTime() < now.getTime()).sort(byUrgency),
      today: open.filter((t) => t.dueAt && new Date(t.dueAt).getTime() >= now.getTime() && new Date(t.dueAt).getTime() <= eod).sort(byUrgency),
      soon: open.filter((t) => t.dueAt && new Date(t.dueAt).getTime() > eod && new Date(t.dueAt).getTime() <= week).sort(byUrgency),
      undated: open.filter((t) => !t.dueAt),
      doneToday: mine.filter((t) => t.status === 'done' && t.completedAt && new Date(t.completedAt).getTime() >= sod),
    }
  }, [mine])

  const todayTotal = groups.late.length + groups.today.length + groups.doneToday.length
  const myOpenShift = attendance.find((a) => a.userId === me.id && !a.checkOutAt && isToday(a.checkInAt))
  const leadCompanies = companies.filter((c) => memberships.some((m) => m.userId === me.id && m.companyId === c.id && m.role !== 'employee'))
  const shownLead = filter === 'all' ? leadCompanies : leadCompanies.filter((c) => c.id === filter)

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div>
        <div className="muted" style={{ fontSize: 13 }}>{fmtDay(now)}</div>
        <h1>{greeting()} يا {me.name.split(' ')[0]}</h1>
      </div>

      <div className="grid grid-3">
        <div className="card glow row span-2" style={{ gap: 16 }}>
          <Ring value={groups.doneToday.length} total={todayTotal} label={`خلصتي ${groups.doneToday.length} من ${todayTotal}`} />
          <div className="stack" style={{ gap: 6 }}>
            <span style={{ fontFamily: 'var(--display)', fontSize: 18, fontWeight: 600 }}>
              {todayTotal - groups.doneToday.length === 0 ? 'يومك خالص، برافو!' : `فاضلك ${todayTotal - groups.doneToday.length} مهام النهارده`}
            </span>
            <span className="soft" style={{ fontSize: 14 }}>
              {groups.late.length > 0 ? `${groups.late.length} منهم متأخرين، ابدئي بـ "${groups.late[0].title}"` : groups.today[0] ? `اللي جاي: ${groups.today[0].title}` : 'مفيش حاجة متأخرة'}
            </span>
            <span style={{ fontSize: 13, color: myOpenShift ? 'var(--green-2)' : 'var(--muted)' }}>
              {myOpenShift ? `حاضرة من ${fmtTime(myOpenShift.checkInAt)}` : <Link to="/attendance">لسه ما سجلتيش حضور</Link>}
            </span>
          </div>
        </div>
        <div className="card grid" style={{ gap: 12, alignContent: 'center', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <Stat v={mine.filter((t) => t.status !== 'done').length} l="مفتوحة ليا" />
          <Stat v={groups.late.length} l="متأخرة" tone={groups.late.length ? 'var(--rose)' : undefined} />
          <Stat v={groups.soon.length} l="الأسبوع ده" />
          <Stat v={groups.doneToday.length} l="خلصت النهارده" tone="var(--green-2)" />
        </div>
      </div>

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div className="stack" style={{ gap: 18 }}>
          <Section title="متأخرة" tone="var(--rose)" tasks={groups.late} />
          <Section title="النهارده" tasks={groups.today} empty={groups.late.length === 0 ? 'مفيش مهام النهارده' : undefined} />
          <Section title="الأيام الجاية" tasks={groups.soon} />
          <Section title="من غير ميعاد" tasks={groups.undated} />
          {mine.length === 0 && (
            <div className="card">
              <Empty icon="tasks" title="مفيش مهام عليكي لسه">
                <button className="btn primary" onClick={() => openNewTask()}><Icon name="plus" /> ضيفي أول مهمة</button>
              </Empty>
            </div>
          )}
        </div>

        <div className="stack" style={{ gap: 16 }}>
          {shownLead.length > 0 && <h2>نظرة على الشركات</h2>}
          {shownLead.map((c) => {
            const ct = tasks.filter((t) => t.companyId === c.id)
            const open = ct.filter((t) => t.status !== 'done')
            const late = open.filter((t) => t.dueAt && new Date(t.dueAt) < now)
            const review = ct.filter((t) => t.status === 'review')
            const members = memberships.filter((m) => m.companyId === c.id).length
            const present = attendance.filter((a) => a.companyId === c.id && isToday(a.checkInAt)).length
            const doneWeek = ct.filter((t) => t.completedAt && Date.now() - new Date(t.completedAt).getTime() < 7 * 864e5).length
            return (
              <div key={c.id} className="card" style={{ borderColor: hexA(c.color, 0.3), background: `linear-gradient(160deg, ${hexA(c.color, 0.1)}, rgba(255,255,255,0.03))` }}>
                <div className="card-head">
                  <span className="cdot" style={{ background: c.color, boxShadow: `0 0 10px ${c.color}`, width: 10, height: 10 }} />
                  <h3>{c.name}</h3>
                  <span className="spacer" />
                  <button className="btn ghost sm" onClick={() => useUI.getState().setCompanyFilter(c.id)}>ركزي عليها</button>
                </div>
                <div className="grid" style={{ gap: 10, gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
                  <Stat v={open.length} l="مفتوحة" />
                  <Stat v={late.length} l="متأخرة" tone={late.length ? 'var(--rose)' : undefined} />
                  <Stat v={review.length} l="مستنية مراجعة" tone={review.length ? 'var(--amber)' : undefined} />
                  <Stat v={`${present}/${members}`} l="حاضرين" />
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>خلص {doneWeek} مهام آخر 7 أيام</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Stat({ v, l, tone }: { v: number | string; l: string; tone?: string }) {
  return (
    <div className="stat">
      <span className="v" style={{ color: tone, fontSize: 24 }}>{v}</span>
      <span className="l">{l}</span>
    </div>
  )
}

function Section({ title, tasks, tone, empty }: { title: string; tasks: Task[]; tone?: string; empty?: string }) {
  if (!tasks.length && !empty) return null
  return (
    <section className="stack">
      <div className="row">
        <h2 style={{ color: tone }}>{title}</h2>
        <span className="num muted">{tasks.length || ''}</span>
      </div>
      {tasks.length ? tasks.map((t) => <TaskRow key={t.id} task={t} />) : <div className="muted" style={{ fontSize: 14 }}>{empty}</div>}
    </section>
  )
}
