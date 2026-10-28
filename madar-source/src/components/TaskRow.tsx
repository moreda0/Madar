import type { Task } from '../lib/types'
import { useStore, useUI } from '../lib/store'
import { useCompanyMap, useUserMap } from '../lib/access'
import { dueLabel, PRIORITY_COLOR, PRIORITY_LABEL } from '../lib/utils'
import { Avatar } from './ui'
import { Icon } from './Icon'

export function TaskRow({ task, showCompany = true }: { task: Task; showCompany?: boolean }) {
  const companies = useCompanyMap()
  const users = useUserMap()
  const me = useStore((s) => s.currentUserId)!
  const updateTask = useStore((s) => s.updateTask)
  const openTask = useUI((s) => s.openTask)
  const company = companies[task.companyId]
  const due = dueLabel(task.dueAt)
  const done = task.status === 'done'
  const subDone = task.subtasks.filter((s) => s.done).length
  const color = company?.color ?? '#22D3EE'

  return (
    <div className={`task-row ${done ? 'done' : ''}`} onClick={() => openTask(task.id)} role="group" aria-label={task.title}>
      <span className="bar" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
      <button
        className={`check ${done ? 'on' : ''}`}
        aria-label={done ? 'رجّعها مفتوحة' : 'خلّصها'}
        aria-pressed={done}
        onClick={(e) => {
          e.stopPropagation()
          updateTask(task.id, { status: done ? 'todo' : 'done' }, me)
        }}
      >
        {done && <Icon name="check" size={16} stroke={2.6} />}
      </button>
      <button className="body" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'start' }} onClick={() => openTask(task.id)}>
        <span className="title">{task.title}</span>
        <span className="meta">
          {showCompany && company && <span style={{ color }}>{company.short}</span>}
          {task.priority !== 'medium' && task.priority !== 'low' && (
            <span style={{ color: PRIORITY_COLOR[task.priority] }}>
              <Icon name="flag" size={12} style={{ verticalAlign: '-2px' }} /> {PRIORITY_LABEL[task.priority]}
            </span>
          )}
          {task.subtasks.length > 0 && <span className="num">{subDone}/{task.subtasks.length}</span>}
          {task.comments.length > 0 && (
            <span>
              <Icon name="comment" size={12} style={{ verticalAlign: '-2px' }} /> <span className="num">{task.comments.length}</span>
            </span>
          )}
        </span>
      </button>
      {task.assigneeId && task.assigneeId !== me && <Avatar user={users[task.assigneeId]} size="sm" />}
      <span className={`num tone-${done ? 'muted' : due.tone}`} style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
        {done ? 'خلصت' : due.text}
      </span>
    </div>
  )
}
