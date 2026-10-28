import { useEffect, useRef } from 'react'
import { useStore, useUI } from './store'

/** Ask once for permission to show system notifications */
export async function requestSystemNotifications(): Promise<NotificationPermission | 'unsupported'> {
  if (!('Notification' in window)) return 'unsupported'
  if (Notification.permission !== 'default') return Notification.permission
  try {
    return await Notification.requestPermission()
  } catch {
    return 'denied'
  }
}

function systemNotify(title: string, body: string, tag?: string) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    const opts: NotificationOptions = { body, tag, icon: './icons/icon-192.png', badge: './icons/icon-192.png', dir: 'rtl', lang: 'ar' }
    // Prefer the service worker so it also works when the app is installed
    navigator.serviceWorker?.getRegistration().then((reg) => {
      if (reg) reg.showNotification(title, opts)
      else new Notification(title, opts)
    }).catch(() => new Notification(title, opts))
  } catch {
    /* notifications blocked in this context */
  }
}

/**
 * Background engine while the app is open:
 *  - fires "due soon" reminders and "overdue" alerts for tasks
 *  - pops a toast + system notification for every new notification addressed to me
 */
export function useReminderEngine() {
  const me = useStore((s) => s.currentUserId)
  const notifications = useStore((s) => s.notifications)
  const toast = useUI((s) => s.toast)
  const seen = useRef<Set<string> | null>(null)

  // scan tasks every 20s
  useEffect(() => {
    if (!me) return
    const tick = () => {
      const s = useStore.getState()
      const now = Date.now()
      for (const t of s.tasks) {
        if (!t.dueAt || t.status === 'done') continue
        const due = new Date(t.dueAt).getTime()
        const audience = new Set([t.assigneeId, t.creatorId].filter(Boolean) as string[])
        const remKey = `rem:${t.id}`
        if (t.remindBefore > 0 && now >= due - t.remindBefore * 60000 && now < due && !s.firedReminders[remKey]) {
          s.markReminderFired(remKey)
          const mins = Math.max(1, Math.round((due - now) / 60000))
          if (t.assigneeId)
            s.notify({ userId: t.assigneeId, companyId: t.companyId, kind: 'reminder', title: `فاضل ${mins} دقيقة على الميعاد`, body: t.title, taskId: t.id })
        }
        const lateKey = `late:${t.id}`
        // only alert for things that became late recently (avoid a flood on first open)
        if (now >= due && now - due < 3 * 864e5 && !s.firedReminders[lateKey]) {
          s.markReminderFired(lateKey)
          audience.forEach((u) =>
            s.notify({ userId: u, companyId: t.companyId, kind: 'overdue', title: 'مهمة عدّت ميعادها', body: t.title, taskId: t.id }),
          )
        }
      }
    }
    tick()
    const h = setInterval(tick, 20000)
    return () => clearInterval(h)
  }, [me])

  // surface new notifications for me
  useEffect(() => {
    if (!me) return
    const mine = notifications.filter((n) => n.userId === me)
    if (seen.current === null) {
      seen.current = new Set(mine.map((n) => n.id))
      return
    }
    const fresh = mine.filter((n) => !seen.current!.has(n.id))
    fresh.forEach((n) => seen.current!.add(n.id))
    const unread = fresh.filter((n) => !n.read)
    if (unread.length > 2) {
      // a burst (e.g. first open after a while): one summary instead of a wall of popups
      toast({ title: `عندك ${unread.length} تنبيهات جديدة`, body: unread[0].body, tone: 'warn' })
      systemNotify(`عندك ${unread.length} تنبيهات جديدة في مدار`, unread.map((n) => n.body).slice(0, 3).join(' · '), 'burst')
      return
    }
    for (const n of unread) {
      toast({ title: n.title, body: n.body, tone: n.kind === 'overdue' ? 'warn' : 'info' })
      if (document.hidden || n.kind === 'reminder' || n.kind === 'overdue') systemNotify(n.title, n.body, n.id)
    }
  }, [notifications, me, toast])
}
