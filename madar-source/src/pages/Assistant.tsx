import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { useStore, useUI } from '../lib/store'
import { assistantContext, localAssistant, whenLabel, type AssistantAction, type AssistantData, type AssistantReply } from '../lib/assistant'
import { askOnline, onlineAssistantReady } from '../lib/sync'
import { PRIORITY_LABEL, STATUS_LABEL, uid } from '../lib/utils'
import type { Priority, TaskStatus } from '../lib/types'
import { TaskRow } from '../components/TaskRow'
import { Icon } from '../components/Icon'

interface Msg extends Partial<AssistantReply> {
  id: string
  role: 'user' | 'assistant'
  text: string
  at: string
  done?: number[] // indexes of actions already applied
  online?: boolean
}

const safeStorage = createJSONStorage(() => {
  try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return localStorage } catch { return sessionStorage }
})

const useChat = create<{ msgs: Msg[]; add: (m: Msg) => void; patch: (id: string, p: Partial<Msg>) => void; clear: () => void }>()(
  persist(
    (set) => ({
      msgs: [],
      add: (m) => set((s) => ({ msgs: [...s.msgs, m].slice(-60) })),
      patch: (id, p) => set((s) => ({ msgs: s.msgs.map((m) => (m.id === id ? { ...m, ...p } : m)) })),
      clear: () => set({ msgs: [] }),
    }),
    { name: 'madar-chat', storage: safeStorage },
  ),
)

const STARTERS = ['ملخص النهارده', 'إيه المتأخر عليا؟', 'مين متأخر في الفريق؟', 'ضيفي مهمة بكرة الساعة 3', 'درجة التزامي', 'عندي إيه الأسبوع ده؟']

type SR = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null }
const SpeechRec: (new () => SR) | undefined = (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition

function snapshot(): AssistantData {
  const s = useStore.getState()
  return { me: s.currentUserId!, users: s.users, companies: s.companies, units: s.units, memberships: s.memberships, tasks: s.tasks, attendance: s.attendance, ratings: s.ratings }
}

/** Turn the online answer's flat action rows into checked actions (ids must exist) */
function cleanActions(rows: Record<string, string | null>[], d: AssistantData): AssistantAction[] {
  const out: AssistantAction[] = []
  for (const r of rows) {
    if (r.type === 'create_task' && r.title && d.companies.some((c) => c.id === r.companyId)) {
      const due = r.dueAt && !isNaN(Date.parse(r.dueAt)) ? new Date(r.dueAt).toISOString() : undefined
      out.push({ type: 'create_task', title: r.title, companyId: r.companyId!, dueAt: due, priority: (['low', 'medium', 'high', 'urgent'].includes(r.priority ?? '') ? r.priority : 'medium') as Priority, assigneeId: d.users.some((u) => u.id === r.assigneeId) ? r.assigneeId! : d.me })
    } else if (r.type === 'set_status' && d.tasks.some((t) => t.id === r.taskId) && ['todo', 'doing', 'review', 'done'].includes(r.status ?? '')) {
      out.push({ type: 'set_status', taskId: r.taskId!, status: r.status as TaskStatus })
    } else if (r.type === 'open' && r.path && /^\/[a-z]*$/.test(r.path)) {
      out.push({ type: 'open', path: r.path, label: r.label || 'افتحي' })
    }
  }
  return out
}

export function Assistant() {
  const msgs = useChat((s) => s.msgs)
  const add = useChat((s) => s.add)
  const patch = useChat((s) => s.patch)
  const clear = useChat((s) => s.clear)
  const tasks = useStore((s) => s.tasks)
  const users = useStore((s) => s.users)
  const companies = useStore((s) => s.companies)
  const addTask = useStore((s) => s.addTask)
  const updateTask = useStore((s) => s.updateTask)
  const me = useStore((s) => s.currentUserId)!
  const openNewTask = useUI((s) => s.openNewTask)
  const toast = useUI((s) => s.toast)
  const nav = useNavigate()
  const [text, setText] = useState('')
  const [thinking, setThinking] = useState(false)
  const [listening, setListening] = useState(false)
  const recRef = useRef<SR | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const online = onlineAssistantReady()

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [msgs.length, thinking])

  const send = async (q: string) => {
    const question = q.trim()
    if (!question || thinking) return
    setText('')
    add({ id: uid('m_'), role: 'user', text: question, at: new Date().toISOString() })
    const d = snapshot()
    const local = localAssistant(question, d)
    if (!local.unsure) { add({ id: uid('m_'), role: 'assistant', ...local, at: new Date().toISOString() }); return }
    if (online) {
      setThinking(true)
      try {
        const history = [...useChat.getState().msgs].slice(-12).map((m) => ({ role: m.role, text: m.text }))
        const ans = await askOnline(history, assistantContext(d))
        if (ans) {
          add({ id: uid('m_'), role: 'assistant', text: ans.reply, taskIds: ans.taskIds.filter((id) => d.tasks.some((t) => t.id === id)).slice(0, 8), actions: cleanActions(ans.actions, d), at: new Date().toISOString(), online: true })
          return
        }
      } catch { /* fall through to the local answer */ } finally { setThinking(false) }
    }
    add({ id: uid('m_'), role: 'assistant', ...local, at: new Date().toISOString() })
  }

  const run = (m: Msg, a: AssistantAction, i: number) => {
    if (a.type === 'open') { nav(a.path); return }
    if (a.type === 'create_task') {
      addTask({ companyId: a.companyId, title: a.title, description: '', status: 'todo', priority: a.priority, assigneeId: a.assigneeId, creatorId: me, dueAt: a.dueAt, remindBefore: 30, subtasks: [] }, me)
      toast({ title: 'اتضافت المهمة', body: a.title, tone: 'ok' })
    }
    if (a.type === 'set_status') {
      updateTask(a.taskId, { status: a.status }, me)
      toast({ title: a.status === 'done' ? 'برافو! اتعلمت خلصت' : `بقت ${STATUS_LABEL[a.status]}`, tone: 'ok' })
    }
    patch(m.id, { done: [...(m.done ?? []), i] })
  }

  const listen = () => {
    if (!SpeechRec) return toast({ title: 'المتصفح ده مش بيدعم الكلام', body: 'جربي Chrome، أو اكتبي', tone: 'warn' })
    if (listening) { recRef.current?.stop(); return }
    const rec = new SpeechRec()
    rec.lang = 'ar-EG'
    rec.interimResults = true
    rec.continuous = false
    let finalText = ''
    rec.onresult = (e) => {
      const r = Array.from(e.results)
      finalText = r.map((x) => x[0].transcript).join(' ')
      setText(finalText)
    }
    rec.onerror = (e) => { if (e.error === 'not-allowed') toast({ title: 'اسمحي للمايك من إعدادات المتصفح', tone: 'warn' }) }
    rec.onend = () => { setListening(false); if (finalText.trim()) send(finalText) }
    recRef.current = rec
    setListening(true)
    rec.start()
  }

  const actionLabel = (a: AssistantAction) => {
    if (a.type === 'create_task') {
      const who = users.find((u) => u.id === a.assigneeId)
      return `${a.title} · ${who?.id === me ? 'ليكي' : who?.name ?? ''} · ${companies.find((c) => c.id === a.companyId)?.short ?? ''}${a.dueAt ? ` · ${whenLabel(new Date(a.dueAt))}` : ''}${a.priority !== 'medium' ? ` · ${PRIORITY_LABEL[a.priority]}` : ''}`
    }
    if (a.type === 'set_status') return `${tasks.find((t) => t.id === a.taskId)?.title ?? ''} ← ${STATUS_LABEL[a.status]}`
    return a.label
  }

  return (
    <div className="chat">
      <div className="chat-head row">
        <span className="ai-orb" aria-hidden="true"><Icon name="sparkle" size={20} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>مساعد مدار</div>
          <div className="muted" style={{ fontSize: 12 }}>{online ? 'بيفهم أي سؤال (أونلاين)، والأوامر السريعة على الجهاز' : 'بيشتغل على الجهاز ده، من غير نت'}</div>
        </div>
        {msgs.length > 0 && <button className="btn ghost sm" onClick={clear}>محادثة جديدة</button>}
      </div>

      <div className="chat-body" aria-live="polite">
        {msgs.length === 0 && (
          <div className="chat-empty stack" style={{ gap: 14, alignItems: 'center', textAlign: 'center' }}>
            <span className="ai-orb lg" aria-hidden="true"><Icon name="sparkle" size={30} /></span>
            <h2>أهلاً، أنا مساعدك في مدار</h2>
            <p className="soft" style={{ margin: 0, maxWidth: 420 }}>اسأليني عن يومك والمتأخر، أو قوليلي "ضيفي مهمة…" بالكلام العادي، أو دوسي على المايك واتكلمي.</p>
            <div className="chips" style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
              {STARTERS.map((s) => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}
            </div>
          </div>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={`bubble-wrap ${m.role}`}>
            <div className={`bubble ${m.role}`}>
              <div style={{ whiteSpace: 'pre-line' }}>{m.text}</div>
              {m.taskIds && m.taskIds.length > 0 && (
                <div className="stack" style={{ gap: 6, marginTop: 10 }}>
                  {m.taskIds.map((id) => tasks.find((t) => t.id === id)).filter(Boolean).map((t) => <TaskRow key={t!.id} task={t!} />)}
                </div>
              )}
              {m.actions && m.actions.length > 0 && (
                <div className="stack" style={{ gap: 8, marginTop: 10 }}>
                  {m.actions.map((a, i) => {
                    const done = m.done?.includes(i)
                    return (
                      <div key={i} className="ai-action">
                        {a.type !== 'open' && <div style={{ fontSize: 13, flex: 1, minWidth: 0 }}>{actionLabel(a)}</div>}
                        {done ? (
                          <span className="pill" style={{ background: 'rgba(52,211,153,.14)', color: 'var(--green)' }}><Icon name="check" size={14} /> اتعملت</span>
                        ) : (
                          <div className="row" style={{ gap: 6 }}>
                            <button className="btn primary sm" onClick={() => run(m, a, i)}>
                              {a.type === 'create_task' ? 'أضيفيها' : a.type === 'set_status' ? 'أيوه' : a.label}
                            </button>
                            {a.type === 'create_task' && (
                              <button className="btn ghost sm" onClick={() => { openNewTask({ companyId: a.companyId, title: a.title, dueAt: a.dueAt, priority: a.priority, assigneeId: a.assigneeId }); patch(m.id, { done: [...(m.done ?? []), i] }) }}>عدّلي الأول</button>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              {m.suggestions && (
                <div className="chips" style={{ flexWrap: 'wrap', marginTop: 10 }}>
                  {m.suggestions.map((s) => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}
                </div>
              )}
            </div>
          </div>
        ))}
        {thinking && <div className="bubble-wrap assistant"><div className="bubble assistant typing" aria-label="بيفكر"><span /><span /><span /></div></div>}
        <div ref={endRef} />
      </div>

      <form className="chat-input row" onSubmit={(e) => { e.preventDefault(); send(text) }}>
        <button type="button" className={`btn icon ${listening ? 'primary listening' : 'ghost'}`} onClick={listen} aria-label={listening ? 'وقفي التسجيل' : 'اتكلمي'} title="اتكلمي">
          <Icon name="mic" size={20} />
        </button>
        <input className="input" style={{ flex: 1 }} value={text} onChange={(e) => setText(e.target.value)} placeholder={listening ? 'سامعاكي…' : 'اكتبي أو اتكلمي… مثلاً: ضيفي اجتماع بكرة الساعة 11'} aria-label="رسالتك" />
        <button className="btn primary icon" disabled={!text.trim() || thinking} aria-label="ابعتي"><Icon name="send" size={20} /></button>
      </form>
    </div>
  )
}
