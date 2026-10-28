import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useStore, useUI } from '../lib/store'
import { useCompanyMap, useUserMap, useVisibleTasks } from '../lib/access'
import type { Priority, Task, TaskStatus } from '../lib/types'
import { dueLabel, fmtDay, fmtMonth, hexA, PRIORITY_COLOR, PRIORITY_LABEL, PRIORITY_WEIGHT, sameDay, STATUS_LABEL, STATUS_ORDER } from '../lib/utils'
import { TaskRow } from '../components/TaskRow'
import { Avatar, Empty } from '../components/ui'
import { Icon } from '../components/Icon'

type View = 'list' | 'kanban' | 'calendar'

export function Tasks() {
  const [params, setParams] = useSearchParams()
  const view = (params.get('view') as View) || 'list'
  const setView = (v: View) => setParams((p) => { p.set('view', v); return p }, { replace: true })
  const all = useVisibleTasks()
  const me = useStore((s) => s.currentUserId)!
  const [q, setQ] = useState('')
  const [who, setWho] = useState<'all' | 'me' | 'others'>('all')
  const [prio, setPrio] = useState<Priority | 'all'>('all')
  const [showDone, setShowDone] = useState(false)

  const tasks = useMemo(() => {
    const needle = q.trim()
    return all
      .filter((t) => !needle || t.title.includes(needle) || t.description.includes(needle))
      .filter((t) => who === 'all' || (who === 'me' ? t.assigneeId === me : t.assigneeId !== me))
      .filter((t) => prio === 'all' || t.priority === prio)
  }, [all, q, who, prio, me])

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div className="seg" role="group" aria-label="طريقة العرض">
          <button className={view === 'list' ? 'on' : ''} aria-pressed={view === 'list'} onClick={() => setView('list')}><Icon name="list" size={16} /> قائمة</button>
          <button className={view === 'kanban' ? 'on' : ''} aria-pressed={view === 'kanban'} onClick={() => setView('kanban')}><Icon name="board" size={16} /> كانبان</button>
          <button className={view === 'calendar' ? 'on' : ''} aria-pressed={view === 'calendar'} onClick={() => setView('calendar')}><Icon name="calendar" size={16} /> تقويم</button>
        </div>
        <span className="spacer" />
        <div className="row wrap" style={{ gap: 8 }}>
          <div style={{ position: 'relative' }}>
            <Icon name="search" size={16} className="muted" style={{ position: 'absolute', insetInlineStart: 12, top: 14 }} />
            <input className="input" style={{ paddingInlineStart: 36, width: 200 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="دوري على مهمة" aria-label="بحث" />
          </div>
          <select className="select" style={{ width: 'auto' }} value={who} onChange={(e) => setWho(e.target.value as typeof who)} aria-label="المسؤول">
            <option value="all">كل الناس</option>
            <option value="me">مهامي أنا</option>
            <option value="others">مهام الفريق</option>
          </select>
          <select className="select" style={{ width: 'auto' }} value={prio} onChange={(e) => setPrio(e.target.value as Priority | 'all')} aria-label="الأولوية">
            <option value="all">كل الأولويات</option>
            {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </select>
        </div>
      </div>

      {view === 'list' && <ListView tasks={tasks} showDone={showDone} setShowDone={setShowDone} />}
      {view === 'kanban' && <KanbanView tasks={tasks} />}
      {view === 'calendar' && <CalendarView tasks={tasks} />}
    </div>
  )
}

function ListView({ tasks, showDone, setShowDone }: { tasks: Task[]; showDone: boolean; setShowDone: (v: boolean) => void }) {
  const open = tasks
    .filter((t) => t.status !== 'done')
    .sort((a, b) => (a.dueAt ? +new Date(a.dueAt) : Infinity) - (b.dueAt ? +new Date(b.dueAt) : Infinity) || PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority])
  const done = tasks.filter((t) => t.status === 'done').sort((a, b) => +new Date(b.completedAt ?? 0) - +new Date(a.completedAt ?? 0))
  if (!tasks.length) return <div className="card"><Empty icon="tasks" title="مفيش مهام بالفلتر ده" /></div>
  return (
    <div className="stack">
      {open.map((t) => <TaskRow key={t.id} task={t} />)}
      {open.length === 0 && <div className="muted">كل المهام خلصت</div>}
      {done.length > 0 && (
        <button className="btn ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
          {showDone ? 'خبّي' : 'اعرضي'} المهام اللي خلصت ({done.length})
        </button>
      )}
      {showDone && done.map((t) => <TaskRow key={t.id} task={t} />)}
    </div>
  )
}

function KanbanView({ tasks }: { tasks: Task[] }) {
  const me = useStore((s) => s.currentUserId)!
  const updateTask = useStore((s) => s.updateTask)
  const openTask = useUI((s) => s.openTask)
  const openNewTask = useUI((s) => s.openNewTask)
  const companies = useCompanyMap()
  const users = useUserMap()
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<TaskStatus | null>(null)
  const COL_COLOR: Record<TaskStatus, string> = { todo: '#8B96B0', doing: '#22D3EE', review: '#FBBF24', done: '#34D399' }

  return (
    <div className="kanban">
      {STATUS_ORDER.map((st) => {
        const col = tasks.filter((t) => t.status === st).sort((a, b) => PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority])
        return (
          <div
            key={st}
            className={`kcol ${over === st ? 'over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(st) }}
            onDragLeave={() => setOver((o) => (o === st ? null : o))}
            onDrop={(e) => {
              e.preventDefault()
              const id = e.dataTransfer.getData('text/plain') || dragId
              if (id) updateTask(id, { status: st }, me)
              setDragId(null)
              setOver(null)
            }}
          >
            <div className="kcol-head">
              <span className="cdot" style={{ background: COL_COLOR[st], boxShadow: `0 0 8px ${COL_COLOR[st]}` }} />
              {STATUS_LABEL[st]}
              <span className="num muted" style={{ fontWeight: 400 }}>{col.length}</span>
              <span className="spacer" />
              <button className="btn ghost icon sm" aria-label={`ضيفي في ${STATUS_LABEL[st]}`} onClick={() => openNewTask({ status: st })}><Icon name="plus" size={16} /></button>
            </div>
            {col.map((t) => {
              const c = companies[t.companyId]
              const due = dueLabel(t.dueAt)
              const subDone = t.subtasks.filter((s) => s.done).length
              return (
                <button
                  key={t.id}
                  className={`kcard ${dragId === t.id ? 'dragging' : ''}`}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; setDragId(t.id) }}
                  onDragEnd={() => { setDragId(null); setOver(null) }}
                  onClick={() => openTask(t.id)}
                  style={{ borderInlineStart: `3px solid ${c?.color ?? '#22D3EE'}` }}
                >
                  <div className="row" style={{ fontSize: 12 }}>
                    <span style={{ color: c?.color }}>{c?.short}</span>
                    <span className="spacer" />
                    <span style={{ color: PRIORITY_COLOR[t.priority] }}><Icon name="flag" size={12} /> {PRIORITY_LABEL[t.priority]}</span>
                  </div>
                  <div style={{ fontSize: 14, lineHeight: 1.45 }}>{t.title}</div>
                  {t.subtasks.length > 0 && <div className="progress"><i style={{ width: `${(subDone / t.subtasks.length) * 100}%` }} /></div>}
                  <div className="row" style={{ fontSize: 12 }}>
                    {t.assigneeId && <Avatar user={users[t.assigneeId]} size="sm" />}
                    <span className="muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{users[t.assigneeId ?? '']?.name.split(' ')[0]}</span>
                    <span className="spacer" />
                    <span className={`num tone-${st === 'done' ? 'muted' : due.tone}`}>{st === 'done' ? '✓' : due.text}</span>
                  </div>
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

function CalendarView({ tasks }: { tasks: Task[] }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d })
  const companies = useCompanyMap()
  const openTask = useUI((s) => s.openTask)
  const openNewTask = useUI((s) => s.openNewTask)
  const today = new Date()
  const [picked, setPicked] = useState<Date>(today)

  // weeks start on Saturday (common in Egypt)
  const first = new Date(cursor)
  const lead = (first.getDay() + 1) % 7
  const start = new Date(first)
  start.setDate(1 - lead)
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d })
  const dows = ['السبت', 'الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة']
  const move = (n: number) => setCursor((c) => { const d = new Date(c); d.setMonth(c.getMonth() + n); return d })

  return (
    <div className="card">
      <div className="card-head">
        <button className="btn icon sm" onClick={() => move(-1)} aria-label="الشهر اللي فات"><Icon name="chevronNext" size={18} /></button>
        <h2 style={{ minWidth: 150, textAlign: 'center' }}>{fmtMonth(cursor)}</h2>
        <button className="btn icon sm" onClick={() => move(1)} aria-label="الشهر الجاي"><Icon name="chevron" size={18} /></button>
        <span className="spacer" />
        <button className="btn sm" onClick={() => { const d = new Date(); d.setDate(1); setCursor(d) }}>النهارده</button>
      </div>
      <div className="cal">
        {dows.map((d) => <div key={d} className="cal-dow">{d}</div>)}
        {days.map((d) => {
          const evs = tasks.filter((t) => t.dueAt && sameDay(new Date(t.dueAt), d))
          return (
            <div
              key={d.toISOString()}
              className={`cal-day ${d.getMonth() !== cursor.getMonth() ? 'other' : ''} ${sameDay(d, today) ? 'today' : ''}`}
              style={sameDay(d, picked) ? { background: 'rgba(34,211,238,0.10)' } : undefined}
              onClick={() => setPicked(d)}
              onDoubleClick={() => { const x = new Date(d); x.setHours(12, 0, 0, 0); openNewTask({ dueAt: x.toISOString() }) }}
            >
              <span className="d num">{d.getDate()}</span>
              {evs.slice(0, 3).map((t) => {
                const c = companies[t.companyId]?.color ?? '#22D3EE'
                return (
                  <button key={t.id} className="cal-ev" style={{ background: hexA(c, t.status === 'done' ? 0.12 : 0.28), textDecoration: t.status === 'done' ? 'line-through' : 'none' }} onClick={(e) => { e.stopPropagation(); openTask(t.id) }} title={t.title}>
                    {t.title}
                  </button>
                )
              })}
              {evs.length > 3 && <span className="muted" style={{ fontSize: 11 }}>+{evs.length - 3}</span>}
            </div>
          )
        })}
      </div>
      <div className="divider" />
      <div className="row" style={{ marginBottom: 10 }}>
        <h3>{fmtDay(picked)}</h3>
        <span className="spacer" />
        <button className="btn sm" onClick={() => { const x = new Date(picked); x.setHours(12, 0, 0, 0); openNewTask({ dueAt: x.toISOString() }) }}>
          <Icon name="plus" size={16} /> مهمة في اليوم ده
        </button>
      </div>
      <div className="stack">
        {tasks.filter((t) => t.dueAt && sameDay(new Date(t.dueAt), picked)).map((t) => <TaskRow key={t.id} task={t} />)}
        {!tasks.some((t) => t.dueAt && sameDay(new Date(t.dueAt), picked)) && <span className="muted" style={{ fontSize: 14 }}>مفيش مهام في اليوم ده</span>}
      </div>
    </div>
  )
}
