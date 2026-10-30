import { useState } from 'react'
import { useStore, useUI } from '../lib/store'
import { useCompanyMap } from '../lib/access'
import { requestSystemNotifications } from '../lib/reminders'
import type { NotificationKind } from '../lib/types'
import { fmtShortDate, fmtTime, isToday } from '../lib/utils'
import { Empty } from '../components/ui'
import { Icon } from '../components/Icon'

const KIND: Record<NotificationKind, { icon: string; color: string; label: string }> = {
  assigned: { icon: 'user', color: '#22D3EE', label: 'تكليف' },
  reminder: { icon: 'clock', color: '#FBBF24', label: 'تذكير' },
  overdue: { icon: 'alert', color: '#F472B6', label: 'تنبيه تأخير' },
  comment: { icon: 'comment', color: '#A78BFA', label: 'تعليق' },
  status: { icon: 'check', color: '#34D399', label: 'تحديث' },
  attendance: { icon: 'pin', color: '#7DE3F4', label: 'حضور' },
  performance: { icon: 'chart', color: '#FBBF24', label: 'الأداء' },
  meeting: { icon: 'mic', color: '#A78BFA', label: 'اجتماع' },
  system: { icon: 'sparkle', color: '#C4B5FD', label: 'النظام' },
}

export function Notifications() {
  const me = useStore((s) => s.currentUserId)!
  const all = useStore((s) => s.notifications)
  const markRead = useStore((s) => s.markRead)
  const markAllRead = useStore((s) => s.markAllRead)
  const clearRead = useStore((s) => s.clearRead)
  const openTask = useUI((s) => s.openTask)
  const filter = useUI((s) => s.companyFilter)
  const toast = useUI((s) => s.toast)
  const companies = useCompanyMap()
  const [onlyUnread, setOnlyUnread] = useState(false)
  const [perm, setPerm] = useState<string>(() => ('Notification' in window ? Notification.permission : 'unsupported'))

  const list = all
    .filter((n) => n.userId === me && (filter === 'all' || n.companyId === filter) && (!onlyUnread || !n.read))
    .sort((a, b) => +new Date(b.at) - +new Date(a.at))
  const today = list.filter((n) => isToday(n.at))
  const earlier = list.filter((n) => !isToday(n.at))

  return (
    <div className="stack" style={{ gap: 18, maxWidth: 820 }}>
      <div className="page-head">
        <div className="seg" role="group" aria-label="فلتر">
          <button className={!onlyUnread ? 'on' : ''} onClick={() => setOnlyUnread(false)}>الكل</button>
          <button className={onlyUnread ? 'on' : ''} onClick={() => setOnlyUnread(true)}>اللي ما اتقراش</button>
        </div>
        <span className="spacer" />
        <button className="btn sm" onClick={() => markAllRead(me)}><Icon name="check" size={16} /> علّمي الكل مقروء</button>
        <button className="btn ghost sm" onClick={() => clearRead(me)}>امسحي المقروء</button>
      </div>

      {perm !== 'granted' && perm !== 'unsupported' && (
        <div className="card glow row wrap" style={{ gap: 14 }}>
          <Icon name="bell" size={28} style={{ color: 'var(--cyan-2)' }} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 600 }}>فعّلي إشعارات الجهاز</div>
            <div className="soft" style={{ fontSize: 13 }}>عشان التذكيرات توصلك حتى لو التطبيق مش قدامك.</div>
          </div>
          <button
            className="btn primary"
            onClick={async () => {
              const p = await requestSystemNotifications()
              setPerm(p)
              if (p === 'granted') toast({ title: 'تمام، الإشعارات اتفعلت', tone: 'ok' })
              else if (p === 'denied') toast({ title: 'الإشعارات مقفولة من المتصفح', body: 'تقدري تفتحيها من إعدادات الموقع', tone: 'warn' })
            }}
          >
            فعّلي
          </button>
        </div>
      )}

      {list.length === 0 && <div className="card"><Empty icon="bell" title={onlyUnread ? 'قريتي كل حاجة' : 'مفيش تنبيهات'} /></div>}
      {[{ t: 'النهارده', items: today }, { t: 'قبل كده', items: earlier }].map((g) =>
        g.items.length ? (
          <section key={g.t} className="stack">
            <h3 className="muted">{g.t}</h3>
            {g.items.map((n) => {
              const k = KIND[n.kind]
              const c = n.companyId ? companies[n.companyId] : undefined
              return (
                <button
                  key={n.id}
                  className="task-row"
                  style={{ alignItems: 'flex-start', background: n.read ? 'rgba(255,255,255,0.025)' : 'var(--panel-2)' }}
                  onClick={() => {
                    markRead(n.id)
                    if (n.taskId) openTask(n.taskId)
                  }}
                >
                  <span style={{ width: 40, height: 40, borderRadius: 13, display: 'grid', placeItems: 'center', background: `${k.color}22`, color: k.color, flex: 'none' }}>
                    <Icon name={k.icon} size={19} />
                  </span>
                  <span className="body">
                    <span style={{ fontWeight: n.read ? 400 : 600, fontSize: 14.5 }}>{n.title}</span>
                    <span className="soft" style={{ fontSize: 13 }}>{n.body}</span>
                    <span className="meta">
                      <span style={{ color: k.color }}>{k.label}</span>
                      {c && <span style={{ color: c.color }}>{c.short}</span>}
                      <span className="num">{isToday(n.at) ? fmtTime(n.at) : `${fmtShortDate(n.at)} · ${fmtTime(n.at)}`}</span>
                    </span>
                  </span>
                  {!n.read && <span className="dot" style={{ marginTop: 8 }} />}
                </button>
              )
            })}
          </section>
        ) : null,
      )}

      <div className="card row wrap" style={{ gap: 14, borderStyle: 'dashed' }}>
        <Icon name="whatsapp" size={28} style={{ color: '#34D399' }} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 600 }}>التنبيهات على واتساب (رايح جاي)</div>
          <div className="soft" style={{ fontSize: 13 }}>جاية في المرحلة الجاية: التنبيه يوصلك واتساب بأزرار، وردك هناك يحدّث المهمة هنا.</div>
        </div>
        <span className="pill" style={{ background: 'rgba(52,211,153,.12)', color: '#A7F3D0' }}>قريباً</span>
      </div>
    </div>
  )
}
