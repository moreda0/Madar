import type { Company, Task, User } from './types'
import { fmtDay, fmtTime, PRIORITY_LABEL, STATUS_LABEL } from './utils'

/**
 * Click-to-send: these links open WhatsApp (app on the phone, WhatsApp Web/Desktop on a laptop)
 * on the sender's own number with the message already typed. Nothing is sent until they press Send.
 */

/** "01012345678", "+20 101 234 5678", "0020..." -> "201012345678". Empty when it doesn't look like a number. */
export function waNumber(phone?: string): string {
  if (!phone) return ''
  let d = phone.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660)).replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  else if (d.startsWith('0') && d.length === 11) d = '20' + d.slice(1) // Egyptian mobile written locally
  return d.length >= 8 ? d : ''
}

export const waLink = (phone: string | undefined, text: string) => {
  const n = waNumber(phone)
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`
}

/** Link back into Madar that opens the task (works for anyone signed in to the same workspace) */
export const taskUrl = (id: string) => `${location.origin}${location.pathname}#/tasks?t=${id}`

const firstName = (u?: User) => u?.name.trim().split(/\s+/)[0] ?? ''

export function taskMessage(task: Task, to: User | undefined, company?: Company): string {
  const lines = [
    `أهلاً ${firstName(to)} 👋`,
    `عندك مهمة على مدار${company ? ` (${company.short})` : ''}:`,
    '',
    `📌 *${task.title}*`,
  ]
  if (task.description) lines.push(task.description)
  lines.push('')
  if (task.dueAt) lines.push(`⏰ الميعاد: ${fmtDay(task.dueAt)} الساعة ${fmtTime(task.dueAt)}`)
  lines.push(`🚩 الأولوية: ${PRIORITY_LABEL[task.priority]}`)
  if (task.status !== 'todo') lines.push(`📍 الحالة: ${STATUS_LABEL[task.status]}`)
  lines.push('', `افتحها من هنا: ${taskUrl(task.id)}`)
  return lines.join('\n')
}

/** One message with everything still open on someone's plate, earliest deadline first */
export function openTasksMessage(to: User | undefined, tasks: Task[], company?: Company): string {
  const open = tasks
    .filter((t) => t.status !== 'done')
    .sort((a, b) => (a.dueAt ?? '9').localeCompare(b.dueAt ?? '9'))
  if (!open.length) return `أهلاً ${firstName(to)} 👋\nمفيش عندك مهام مفتوحة على مدار دلوقتي. شغل عظيم 👏`
  const lines = [`أهلاً ${firstName(to)} 👋`, `دي مهامك المفتوحة على مدار${company ? ` (${company.short})` : ''}:`, '']
  open.forEach((t, i) => {
    lines.push(`${i + 1}. *${t.title}*${t.dueAt ? ` · ${fmtDay(t.dueAt)} ${fmtTime(t.dueAt)}` : ''}${t.priority === 'urgent' || t.priority === 'high' ? ` · ${PRIORITY_LABEL[t.priority]}` : ''}`)
  })
  lines.push('', `التفاصيل على مدار: ${location.origin}${location.pathname}#/tasks`)
  return lines.join('\n')
}
