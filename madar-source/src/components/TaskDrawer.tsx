import { useState } from 'react'
import { ask, useStore, useUI } from '../lib/store'
import { canSeeTask, roleIn, useCompanyMap, useUserMap } from '../lib/access'
import { dueLabel, fmtDay, fmtTime, PRIORITY_COLOR, PRIORITY_LABEL, REMIND_OPTIONS, STATUS_LABEL, STATUS_ORDER, uid, UNIT_LABEL } from '../lib/utils'
import { Avatar, CompanyTag, Overlay } from './ui'
import { TaskEditor } from './TaskForm'
import { Icon } from './Icon'
import { Stars } from '../pages/Performance'

export function TaskDrawer() {
  const id = useUI((s) => s.openTaskId)
  const close = () => useUI.getState().openTask(null)
  const task = useStore((s) => s.tasks.find((t) => t.id === id))
  const me = useStore((s) => s.currentUserId)!
  const units = useStore((s) => s.units)
  const memberships = useStore((s) => s.memberships)
  const updateTask = useStore((s) => s.updateTask)
  const removeTask = useStore((s) => s.removeTask)
  const addComment = useStore((s) => s.addComment)
  const rateTask = useStore((s) => s.rateTask)
  const toast = useUI((s) => s.toast)
  const companies = useCompanyMap()
  const users = useUserMap()
  const [editing, setEditing] = useState(false)
  const [comment, setComment] = useState('')
  const [newSub, setNewSub] = useState('')

  if (!id || !task || !canSeeTask({ units, memberships }, me, task)) return null

  const role = roleIn(memberships, me, task.companyId)
  const canEdit = role === 'admin' || role === 'manager' || task.creatorId === me
  const canDelete = role === 'admin' || task.creatorId === me
  const canRate = task.assigneeId !== me && (role === 'admin' || role === 'manager' || task.creatorId === me)
  const unit = units.find((u) => u.id === task.unitId)
  const due = dueLabel(task.dueAt)
  const subDone = task.subtasks.filter((s) => s.done).length
  const company = companies[task.companyId]

  if (editing)
    return (
      <Overlay onClose={() => setEditing(false)} kind="drawer" label="تعديل المهمة">
        <TaskEditor
          initial={task}
          submitLabel="احفظي"
          onCancel={() => setEditing(false)}
          onSubmit={(t) => {
            updateTask(task.id, t, me)
            setEditing(false)
            toast({ title: 'اتحفظت التعديلات', tone: 'ok' })
          }}
        />
      </Overlay>
    )

  return (
    <Overlay onClose={close} kind="drawer" label={task.title}>
      <div className="stack" style={{ gap: 18 }}>
        <div className="row">
          <CompanyTag company={company} />
          <span className="pill" style={{ background: 'rgba(255,255,255,.06)', color: PRIORITY_COLOR[task.priority] }}>
            <Icon name="flag" size={12} /> {PRIORITY_LABEL[task.priority]}
          </span>
          <span className="spacer" />
          {canEdit && <button className="btn ghost icon" onClick={() => setEditing(true)} aria-label="تعديل"><Icon name="edit" /></button>}
          <button className="btn ghost icon" onClick={close} aria-label="إغلاق"><Icon name="close" /></button>
        </div>

        <div>
          <h2 style={{ fontSize: 22, lineHeight: 1.4 }}>{task.title}</h2>
          {task.description && <p className="soft" style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{task.description}</p>}
        </div>

        <div className="seg" role="group" aria-label="الحالة" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
          {STATUS_ORDER.map((s) => (
            <button key={s} className={task.status === s ? 'on' : ''} aria-pressed={task.status === s} onClick={() => updateTask(task.id, { status: s }, me)}>
              {s === 'done' && <Icon name="check" size={14} />}
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>

        <div className="grid grid-2" style={{ gap: 10 }}>
          <Info label="المسؤول">
            <span className="row" style={{ gap: 8 }}><Avatar user={users[task.assigneeId ?? '']} size="sm" />{users[task.assigneeId ?? '']?.name ?? 'محدش'}</span>
          </Info>
          <Info label="الميعاد">
            {task.dueAt ? (
              <span className={`tone-${task.status === 'done' ? 'muted' : due.tone}`}>{fmtDay(task.dueAt)} · <span className="num">{fmtTime(task.dueAt)}</span></span>
            ) : 'بدون ميعاد'}
          </Info>
          <Info label="التذكير">{REMIND_OPTIONS.find((o) => o.v === task.remindBefore)?.label ?? `قبلها بـ ${task.remindBefore} دقيقة`}</Info>
          <Info label="تابعة لـ">{unit ? `${UNIT_LABEL[unit.type]}: ${unit.name}` : 'الشركة كلها'}</Info>
          <Info label="أنشأها">{users[task.creatorId]?.name ?? '—'}</Info>
          {task.completedAt && <Info label="خلصت">{fmtDay(task.completedAt)} · <span className="num">{fmtTime(task.completedAt)}</span></Info>}
        </div>

        {task.status === 'done' && (task.rating || canRate) && (
          <section className="card row wrap" style={{ padding: 14, justifyContent: 'space-between' }}>
            <div>
              <h3>جودة الشغل</h3>
              <div className="muted" style={{ fontSize: 12 }}>{task.rating ? `قيّمها ${users[task.ratedBy ?? '']?.name ?? ''}` : 'قيّمي المهمة، والتقييم بيدخل في درجة الالتزام'}</div>
            </div>
            <Stars value={task.rating ?? 0} onChange={canRate ? (v) => rateTask(task.id, v, me) : undefined} label="تقييم جودة المهمة" />
          </section>
        )}

        <section className="card" style={{ padding: 14 }}>
          <div className="card-head" style={{ marginBottom: 8 }}>
            <h3>المهام الفرعية</h3>
            <span className="spacer" />
            {task.subtasks.length > 0 && <span className="num muted">{subDone}/{task.subtasks.length}</span>}
          </div>
          {task.subtasks.length > 0 && <div className="progress" style={{ marginBottom: 10 }}><i style={{ width: `${(subDone / task.subtasks.length) * 100}%` }} /></div>}
          <div className="stack" style={{ gap: 6 }}>
            {task.subtasks.map((s) => (
              <div key={s.id} className="row">
                <button
                  className={`check ${s.done ? 'on' : ''}`}
                  aria-label={s.title}
                  aria-pressed={s.done}
                  onClick={() => updateTask(task.id, { subtasks: task.subtasks.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)) }, me)}
                >
                  {s.done && <Icon name="check" size={15} stroke={2.6} />}
                </button>
                <span style={{ flex: 1, textDecoration: s.done ? 'line-through' : 'none', color: s.done ? 'var(--muted)' : undefined }}>{s.title}</span>
                {canEdit && (
                  <button className="btn ghost icon sm" aria-label="شيل الخطوة" onClick={() => updateTask(task.id, { subtasks: task.subtasks.filter((x) => x.id !== s.id) }, me)}>
                    <Icon name="close" size={15} />
                  </button>
                )}
              </div>
            ))}
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault()
                if (!newSub.trim()) return
                updateTask(task.id, { subtasks: [...task.subtasks, { id: uid('s_'), title: newSub.trim(), done: false }] }, me)
                setNewSub('')
              }}
            >
              <input className="input" value={newSub} onChange={(e) => setNewSub(e.target.value)} placeholder="خطوة جديدة" aria-label="خطوة جديدة" />
              <button className="btn icon" aria-label="ضيفي"><Icon name="plus" /></button>
            </form>
          </div>
        </section>

        <section className="stack">
          <h3>التعليقات</h3>
          {task.comments.length === 0 && <span className="muted" style={{ fontSize: 14 }}>مفيش تعليقات لسه</span>}
          {task.comments.map((c) => (
            <div key={c.id} className="row" style={{ alignItems: 'flex-start' }}>
              <Avatar user={users[c.userId]} size="sm" />
              <div style={{ flex: 1, background: 'var(--panel)', border: '1px solid var(--line)', padding: '8px 12px', borderRadius: 14 }}>
                <div className="row" style={{ fontSize: 12 }}>
                  <b style={{ fontWeight: 600 }}>{users[c.userId]?.name}</b>
                  <span className="muted num">{fmtTime(c.at)}</span>
                </div>
                <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{c.text}</div>
              </div>
            </div>
          ))}
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault()
              if (!comment.trim()) return
              addComment(task.id, me, comment.trim())
              setComment('')
            }}
          >
            <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="اكتبي تعليق أو تحديث…" aria-label="تعليق" />
            <button className="btn primary" disabled={!comment.trim()}>ابعتي</button>
          </form>
        </section>

        {canDelete && (
          <button
            className="btn danger"
            style={{ alignSelf: 'flex-start' }}
            onClick={async () => {
              if (await ask('متأكدة إنك عايزة تمسحي المهمة دي؟')) {
                removeTask(task.id)
                close()
              }
            }}
          >
            <Icon name="trash" size={18} /> امسحي المهمة
          </button>
        )}
      </div>
    </Overlay>
  )
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '10px 12px', borderRadius: 14, background: 'var(--panel)', border: '1px solid var(--line)' }}>
      <div className="muted" style={{ fontSize: 12, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14 }}>{children}</div>
    </div>
  )
}
