import { useMemo, useState } from 'react'
import { useStore, useUI } from '../lib/store'
import { assignableUsers, useMyCompanies } from '../lib/access'
import type { Priority, Task, TaskStatus } from '../lib/types'
import { fromLocalInput, PRIORITY_LABEL, REMIND_OPTIONS, STATUS_LABEL, STATUS_ORDER, toLocalInput, uid, UNIT_LABEL } from '../lib/utils'
import { Overlay } from './ui'
import { Icon } from './Icon'
import { waNumber } from '../lib/whatsapp'

const defaultDue = () => {
  const d = new Date()
  d.setHours(d.getHours() + 3, 0, 0, 0)
  return d.toISOString()
}

export function NewTaskModal() {
  const preset = useUI((s) => s.newTask)
  const close = useUI((s) => s.closeNewTask)
  const filter = useUI((s) => s.companyFilter)
  const toast = useUI((s) => s.toast)
  const me = useStore((s) => s.currentUserId)!
  const addTask = useStore((s) => s.addTask)
  const companies = useMyCompanies()
  if (!preset) return null
  const companyId = preset.companyId ?? (filter !== 'all' ? filter : companies[0]?.id)
  if (!companyId)
    return (
      <Overlay onClose={close} label="مهمة جديدة">
        <h2>مفيش شركات لسه</h2>
        <p className="soft">ضيفي شركة الأول من صفحة الهيكل التنظيمي، وبعدها تقدري تضيفي مهام.</p>
        <button className="btn" onClick={close}>تمام</button>
      </Overlay>
    )
  return (
    <Overlay onClose={close} label="مهمة جديدة">
      <TaskEditor
        initial={{
          companyId,
          title: preset.title ?? '',
          description: '',
          status: preset.status ?? 'todo',
          priority: preset.priority ?? 'medium',
          assigneeId: preset.assigneeId ?? me,
          creatorId: me,
          dueAt: preset.dueAt ?? defaultDue(),
          remindBefore: 30,
          subtasks: [],
        }}
        submitLabel="ضيفي المهمة"
        onCancel={close}
        onSubmit={(t) => {
          const id = addTask(t, me)
          const assignee = useStore.getState().users.find((u) => u.id === t.assigneeId)
          const viaWa = t.assigneeId !== me && !!waNumber(assignee?.phone)
          toast({ title: 'اتضافت المهمة', body: viaWa ? `ابعتيها لـ ${assignee!.name} على واتساب من الزرار الأخضر` : t.title, tone: 'ok' })
          close()
          // straight to the task so the WhatsApp button is one tap away
          if (viaWa) useUI.getState().openTask(id)
        }}
      />
    </Overlay>
  )
}

type Draft = Omit<Task, 'id' | 'createdAt' | 'comments'>

export function TaskEditor({ initial, onSubmit, onCancel, submitLabel }: { initial: Draft; onSubmit: (t: Draft) => void; onCancel: () => void; submitLabel: string }) {
  const [t, setT] = useState<Draft>(initial)
  const [newSub, setNewSub] = useState('')
  const me = useStore((s) => s.currentUserId)!
  const users = useStore((s) => s.users)
  const units = useStore((s) => s.units)
  const memberships = useStore((s) => s.memberships)
  const companies = useMyCompanies()
  const people = useMemo(() => {
    const list = assignableUsers({ users, units, memberships }, me, t.companyId)
    const current = users.find((u) => u.id === t.assigneeId)
    return current && !list.includes(current) ? [...list, current] : list
  }, [users, units, memberships, me, t.companyId, t.assigneeId])
  const companyUnits = units.filter((u) => u.companyId === t.companyId)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setT((x) => ({ ...x, [k]: v }))

  return (
    <form
      className="stack"
      style={{ gap: 14 }}
      onSubmit={(e) => {
        e.preventDefault()
        if (!t.title.trim()) return
        const extra = newSub.trim() ? [{ id: uid('s_'), title: newSub.trim(), done: false }] : []
        onSubmit({ ...t, title: t.title.trim(), subtasks: [...t.subtasks, ...extra] })
      }}
    >
      <div className="row">
        <h2>{submitLabel === 'احفظي' ? 'تعديل المهمة' : 'مهمة جديدة'}</h2>
        <span className="spacer" />
        <button type="button" className="btn ghost icon" onClick={onCancel} aria-label="إغلاق"><Icon name="close" /></button>
      </div>
      <label className="field">
        <span>المهمة</span>
        <input className="input" autoFocus value={t.title} onChange={(e) => set('title', e.target.value)} placeholder="مثلاً: مراجعة عقد المورد" required />
      </label>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <label className="field">
          <span>الشركة</span>
          <select className="select" value={t.companyId} onChange={(e) => setT((x) => ({ ...x, companyId: e.target.value, unitId: undefined, assigneeId: me }))}>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>المسؤول</span>
          <select className="select" value={t.assigneeId ?? ''} onChange={(e) => set('assigneeId', e.target.value || undefined)}>
            {people.map((u) => <option key={u.id} value={u.id}>{u.id === me ? `أنا (${u.name})` : u.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>الميعاد</span>
          <input className="input" type="datetime-local" value={toLocalInput(t.dueAt)} onChange={(e) => set('dueAt', fromLocalInput(e.target.value))} />
        </label>
        <label className="field">
          <span>التذكير</span>
          <select className="select" value={t.remindBefore} onChange={(e) => set('remindBefore', Number(e.target.value))}>
            {REMIND_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>الأولوية</span>
          <select className="select" value={t.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
            {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </select>
        </label>
        <label className="field">
          <span>الحالة</span>
          <select className="select" value={t.status} onChange={(e) => set('status', e.target.value as TaskStatus)}>
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
      </div>
      {companyUnits.length > 0 && (
        <label className="field">
          <span>تابعة لـ (اختياري)</span>
          <select className="select" value={t.unitId ?? ''} onChange={(e) => set('unitId', e.target.value || undefined)}>
            <option value="">الشركة كلها</option>
            {companyUnits.map((u) => <option key={u.id} value={u.id}>{UNIT_LABEL[u.type]}: {u.name}</option>)}
          </select>
        </label>
      )}
      <label className="field">
        <span>تفاصيل</span>
        <textarea className="textarea" value={t.description} onChange={(e) => set('description', e.target.value)} placeholder="أي تفاصيل أو روابط تساعد" />
      </label>
      <div className="field">
        <span className="soft" style={{ fontSize: 13 }}>مهام فرعية</span>
        {t.subtasks.map((s) => (
          <div key={s.id} className="row">
            <Icon name="check" size={16} className="muted" />
            <span style={{ flex: 1 }}>{s.title}</span>
            <button type="button" className="btn ghost icon sm" aria-label="شيل" onClick={() => set('subtasks', t.subtasks.filter((x) => x.id !== s.id))}><Icon name="close" size={16} /></button>
          </div>
        ))}
        <div className="row">
          <input
            className="input"
            value={newSub}
            onChange={(e) => setNewSub(e.target.value)}
            placeholder="ضيفي خطوة واضغطي Enter"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newSub.trim()) {
                e.preventDefault()
                set('subtasks', [...t.subtasks, { id: uid('s_'), title: newSub.trim(), done: false }])
                setNewSub('')
              }
            }}
          />
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 4 }}>
        <button type="button" className="btn ghost" onClick={onCancel}>إلغاء</button>
        <button type="submit" className="btn primary" disabled={!t.title.trim()}>{submitLabel}</button>
      </div>
    </form>
  )
}
