import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ask, useStore, useUI } from '../lib/store'
import { assignableUsers, roleIn, useCompanyMap, useMyCompanies, useUserMap } from '../lib/access'
import { processMeeting, type MeetingDraft } from '../lib/sync'
import type { ID, Meeting, MeetingSource, Priority } from '../lib/types'
import { fmtDay, fmtDuration, fmtTime, fromLocalInput, PRIORITY_LABEL, toLocalInput, uid } from '../lib/utils'
import { CompanyTag, Empty, Overlay } from '../components/ui'
import { TaskRow } from '../components/TaskRow'
import { Icon } from '../components/Icon'

type SR = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null }
const SpeechRec: (new () => SR) | undefined = (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition

const SOURCE_LABEL: Record<MeetingSource, string> = { live: 'متسجل في مدار', upload: 'تسجيل مرفوع', text: 'نص', whatsapp: 'من الواتساب' }

/** Meetings this person may open: admins see the company's, others the ones they were in or got work from */
function useVisibleMeetings(): Meeting[] {
  const me = useStore((s) => s.currentUserId)!
  const meetings = useStore((s) => s.meetings)
  const memberships = useStore((s) => s.memberships)
  const tasks = useStore((s) => s.tasks)
  const filter = useUI((s) => s.companyFilter)
  return meetings
    .filter((m) => filter === 'all' || m.companyId === filter)
    .filter((m) => {
      const role = roleIn(memberships, me, m.companyId)
      if (!role) return false
      return role === 'admin' || m.createdBy === me || m.attendeeIds.includes(me) || tasks.some((t) => t.meetingId === m.id && t.assigneeId === me)
    })
    .sort((a, b) => +new Date(b.at) - +new Date(a.at))
}

function minutesText(m: Meeting, names: Record<ID, string>, taskLines: string[], company?: string) {
  const out = [`📝 محضر اجتماع: ${m.title}`, `${fmtDay(m.at)} · ${fmtTime(m.at)}${company ? ` · ${company}` : ''}`]
  if (m.attendeeIds.length) out.push(`الحضور: ${m.attendeeIds.map((id) => names[id]).filter(Boolean).join('، ')}`)
  if (m.summary) out.push('', m.summary)
  if (m.points.length) out.push('', 'اللي اتناقش:', ...m.points.map((p) => `• ${p}`))
  if (m.decisions.length) out.push('', 'القرارات:', ...m.decisions.map((d) => `✅ ${d}`))
  if (taskLines.length) out.push('', 'المهام:', ...taskLines.map((t, i) => `${i + 1}. ${t}`))
  return out.join('\n')
}

export function Meetings() {
  const list = useVisibleMeetings()
  const companies = useCompanyMap()
  const users = useUserMap()
  const tasks = useStore((s) => s.tasks)
  const [params, setParams] = useSearchParams()
  const [creating, setCreating] = useState(false)
  const openId = params.get('m')
  const open = list.find((m) => m.id === openId)

  return (
    <div className="stack" style={{ gap: 18, maxWidth: 920 }}>
      <div className="page-head">
        <div className="soft" style={{ fontSize: 14, flex: 1, minWidth: 220 }}>سجّلي الاجتماع أو المكالمة، ومدار يطلّع المحضر ويوزع المهام على كل واحد.</div>
        <button className="btn primary" onClick={() => setCreating(true)}><Icon name="mic" size={18} /> اجتماع جديد</button>
      </div>

      {list.length === 0 && (
        <div className="card">
          <Empty icon="mic" title="لسه مفيش اجتماعات">
            <div className="muted" style={{ fontSize: 13, maxWidth: 380 }}>دوسي "اجتماع جديد" وسجّلي، أو ارفعي تسجيل مكالمة، أو ابعتي التسجيل لـ Instinct على الواتساب.</div>
          </Empty>
        </div>
      )}

      {list.map((m) => {
        const mt = tasks.filter((t) => t.meetingId === m.id)
        const done = mt.filter((t) => t.status === 'done').length
        return (
          <button key={m.id} className="card meeting-card" onClick={() => setParams({ m: m.id })}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <CompanyTag company={companies[m.companyId]} />
              <span className="pill" style={{ background: 'rgba(167,139,250,.12)', color: '#C4B5FD' }}><Icon name={m.source === 'whatsapp' ? 'whatsapp' : 'mic'} size={12} /> {SOURCE_LABEL[m.source]}</span>
              <span className="spacer" />
              <span className="muted num" style={{ fontSize: 13 }}>{fmtDay(m.at)} · {fmtTime(m.at)}</span>
            </div>
            <h3 style={{ margin: '10px 0 6px', fontSize: 17 }}>{m.title}</h3>
            {m.summary && <p className="soft clamp-2" style={{ margin: 0, fontSize: 14 }}>{m.summary}</p>}
            <div className="row muted" style={{ gap: 14, marginTop: 10, fontSize: 13 }}>
              <span><Icon name="tasks" size={14} /> {mt.length ? `${done}/${mt.length} مهام خلصت` : 'من غير مهام'}</span>
              {m.decisions.length > 0 && <span><Icon name="check" size={14} /> {m.decisions.length} قرارات</span>}
              {m.attendeeIds.length > 0 && <span><Icon name="users" size={14} /> {m.attendeeIds.map((id) => users[id]?.name.split(' ')[0]).filter(Boolean).slice(0, 4).join('، ')}</span>}
            </div>
          </button>
        )
      })}

      {creating && <NewMeeting onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); setParams({ m: id }) }} />}
      {open && <MeetingView meeting={open} onClose={() => setParams({})} />}
    </div>
  )
}

/* ---------- one meeting ---------- */

function MeetingView({ meeting: m, onClose }: { meeting: Meeting; onClose: () => void }) {
  const me = useStore((s) => s.currentUserId)!
  const memberships = useStore((s) => s.memberships)
  const tasks = useStore((s) => s.tasks).filter((t) => t.meetingId === m.id)
  const removeMeeting = useStore((s) => s.removeMeeting)
  const toast = useUI((s) => s.toast)
  const users = useUserMap()
  const companies = useCompanyMap()
  const names = Object.fromEntries(Object.values(users).map((u) => [u.id, u.name]))
  const canDelete = m.createdBy === me || roleIn(memberships, me, m.companyId) === 'admin'
  const text = minutesText(m, names, tasks.map((t) => `${t.title} — ${names[t.assigneeId ?? ''] ?? 'من غير مسؤول'}${t.dueAt ? ` (${fmtDay(t.dueAt)})` : ''}`), companies[m.companyId]?.name)

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast({ title: 'المحضر اتنسخ', tone: 'ok' }) } catch { toast({ title: 'مقدرتش أنسخ', tone: 'warn' }) }
  }

  return (
    <Overlay onClose={onClose} kind="drawer" label={m.title}>
      <div className="stack" style={{ gap: 18 }}>
        <div className="row">
          <CompanyTag company={companies[m.companyId]} />
          <span className="muted num" style={{ fontSize: 13 }}>{fmtDay(m.at)} · {fmtTime(m.at)}{m.durationMin ? ` · ${fmtDuration(m.durationMin)}` : ''}</span>
          <span className="spacer" />
          {canDelete && (
            <button className="btn ghost icon" aria-label="امسحي الاجتماع" onClick={async () => { if (await ask('نمسح الاجتماع ده؟ المهام اللي طلعت منه هتفضل موجودة.')) { removeMeeting(m.id); onClose() } }}>
              <Icon name="trash" />
            </button>
          )}
          <button className="btn ghost icon" onClick={onClose} aria-label="إغلاق"><Icon name="close" /></button>
        </div>

        <div>
          <h2 style={{ fontSize: 22, lineHeight: 1.4 }}>{m.title}</h2>
          {m.attendeeIds.length > 0 && <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>الحضور: {m.attendeeIds.map((id) => users[id]?.name).filter(Boolean).join('، ')}</div>}
          {m.summary && <p className="soft" style={{ margin: '10px 0 0', lineHeight: 1.8 }}>{m.summary}</p>}
        </div>

        {m.points.length > 0 && (
          <section className="stack" style={{ gap: 6 }}>
            <h3 className="muted">اللي اتناقش</h3>
            <ul className="minutes-list">{m.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
          </section>
        )}
        {m.decisions.length > 0 && (
          <section className="stack" style={{ gap: 6 }}>
            <h3 className="muted">القرارات</h3>
            <ul className="minutes-list decisions">{m.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul>
          </section>
        )}

        <section className="stack" style={{ gap: 8 }}>
          <h3 className="muted">المهام ({tasks.length})</h3>
          {tasks.length ? tasks.map((t) => <TaskRow key={t.id} task={t} />) : <div className="muted" style={{ fontSize: 14 }}>مطلعش منه مهام.</div>}
        </section>

        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn sm" onClick={copy}><Icon name="list" size={16} /> انسخي المحضر</button>
          <a className="btn sm" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"><Icon name="whatsapp" size={16} /> ابعتيه واتساب</a>
        </div>

        {m.transcript && (
          <details className="transcript">
            <summary>النص الكامل للاجتماع</summary>
            <p>{m.transcript}</p>
          </details>
        )}
      </div>
    </Overlay>
  )
}

/* ---------- new meeting: capture -> minutes -> review ---------- */

interface DraftTask { key: string; on: boolean; title: string; description: string; assigneeId: string; dueAt: string; priority: Priority }

function NewMeeting({ onClose, onSaved }: { onClose: () => void; onSaved: (id: ID) => void }) {
  const me = useStore((s) => s.currentUserId)!
  const s = useStore()
  const toast = useUI((st) => st.toast)
  const companies = useMyCompanies()
  const filter = useUI((st) => st.companyFilter)
  const [companyId, setCompanyId] = useState<ID>(filter !== 'all' && companies.some((c) => c.id === filter) ? filter : companies[0]?.id ?? '')
  const [mode, setMode] = useState<'live' | 'upload' | 'text'>('live')
  const [step, setStep] = useState<'capture' | 'working' | 'review'>('capture')
  const [transcript, setTranscript] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [startedAt, setStartedAt] = useState<string>(new Date().toISOString())
  const [minutes, setMinutes] = useState(0)
  // review
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [points, setPoints] = useState('')
  const [decisions, setDecisions] = useState('')
  const [rows, setRows] = useState<DraftTask[]>([])
  const people = assignableUsers(s, me, companyId)
  const members = s.users.filter((u) => s.memberships.some((m) => m.userId === u.id && m.companyId === companyId))

  // live recording: browser speech-to-text, plus the raw audio in case the browser can't transcribe
  const [recording, setRecording] = useState(false)
  const [interim, setInterim] = useState('')
  const recRef = useRef<SR | null>(null)
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const wantRec = useRef(false)
  const t0 = useRef(0)
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => { if (!recording) return; const i = setInterval(() => setElapsed(Math.floor((Date.now() - t0.current) / 1000)), 1000); return () => clearInterval(i) }, [recording])
  useEffect(() => () => { wantRec.current = false; recRef.current?.stop(); mediaRef.current?.stream.getTracks().forEach((t) => t.stop()) }, [])

  const startRec = async () => {
    setError('')
    let stream: MediaStream
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) } catch { setError('اسمحي للمايك من إعدادات المتصفح وجربي تاني.'); return }
    chunks.current = []
    try {
      const mr = new MediaRecorder(stream)
      mr.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
      mr.start(1000)
      mediaRef.current = mr
    } catch { stream.getTracks().forEach((t) => t.stop()) }
    wantRec.current = true
    t0.current = Date.now()
    setElapsed(0)
    setStartedAt(new Date().toISOString())
    setRecording(true)
    if (SpeechRec) {
      const run = () => {
        const rec = new SpeechRec()
        rec.lang = 'ar-EG'
        rec.interimResults = true
        rec.continuous = true
        rec.onresult = (e) => {
          let live = ''
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i]
            if (r.isFinal) setTranscript((x) => (x ? x + ' ' : '') + r[0].transcript.trim())
            else live += r[0].transcript
          }
          setInterim(live)
        }
        rec.onerror = (e) => { if (e.error === 'not-allowed') { wantRec.current = false; setError('اسمحي للمايك من إعدادات المتصفح.') } }
        // the browser stops listening after a pause; keep going until the person presses stop
        rec.onend = () => { setInterim(''); if (wantRec.current) { try { run() } catch { /* already running */ } } }
        recRef.current = rec
        rec.start()
      }
      run()
    }
  }
  const stopRec = () => {
    wantRec.current = false
    recRef.current?.stop()
    const mr = mediaRef.current
    if (mr && mr.state !== 'inactive') {
      mr.onstop = () => {
        mr.stream.getTracks().forEach((t) => t.stop())
        if (chunks.current.length) setFile(new File(chunks.current, 'meeting.webm', { type: mr.mimeType || 'audio/webm' }))
      }
      mr.stop()
    }
    setMinutes(Math.max(1, Math.round((Date.now() - t0.current) / 60000)))
    setRecording(false)
  }

  const context = () => {
    const c = s.companies.find((x) => x.id === companyId)
    return {
      now: new Date().toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      companies: c ? [{ id: c.id, name: c.name }] : [],
      people: members.map((u) => ({ id: u.id, name: u.name, title: s.memberships.find((m) => m.userId === u.id && m.companyId === companyId)?.title })),
    }
  }

  const fill = (d: Partial<MeetingDraft>) => {
    setTitle(d.title ?? '')
    setSummary(d.summary ?? '')
    setPoints((d.points ?? []).join('\n'))
    setDecisions((d.decisions ?? []).join('\n'))
    setRows((d.tasks ?? []).map((t) => ({
      key: uid('dt_'), on: true, title: t.title, description: t.description,
      assigneeId: t.assigneeId && people.some((p) => p.id === t.assigneeId) ? t.assigneeId : me,
      dueAt: toLocalInput(t.dueAt ?? undefined), priority: (['low', 'medium', 'high', 'urgent'].includes(t.priority) ? t.priority : 'medium') as Priority,
    })))
    setStep('review')
  }

  const go = async () => {
    setError('')
    const text = transcript.trim()
    // live: the browser's text when it has some, else the recorded audio
    const useAudio = mode === 'upload' || (mode === 'live' && text.length < 20 && !!file)
    if (!useAudio && text.length < 20) { setError(mode === 'live' ? 'لسه مفيش كلام متسجل.' : 'اكتبي أو الصقي كلام الاجتماع الأول.'); return }
    if (useAudio && !file) { setError('اختاري ملف التسجيل الأول.'); return }
    setStep('working')
    try {
      const d = await processMeeting(useAudio ? { audio: file! } : { transcript: text }, context())
      setTranscript(d.transcript)
      fill(d)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStep('capture')
    }
  }

  const save = () => {
    const company = companyId
    const lines = (v: string) => v.split('\n').map((x) => x.trim()).filter(Boolean)
    const chosen = rows.filter((r) => r.on && r.title.trim())
    const mid = s.addMeeting({
      companyId: company, title: title.trim() || 'اجتماع', at: startedAt, durationMin: mode === 'live' ? minutes || undefined : undefined,
      source: mode, attendeeIds: [...new Set([me, ...chosen.map((r) => r.assigneeId)])], transcript: transcript.trim(),
      summary: summary.trim(), decisions: lines(decisions), points: lines(points), taskIds: [], createdBy: me,
    })
    const ids = chosen.map((r) =>
      s.addTask({ companyId: company, title: r.title.trim(), description: r.description, status: 'todo', priority: r.priority, assigneeId: r.assigneeId, creatorId: me, dueAt: fromLocalInput(r.dueAt), remindBefore: 30, subtasks: [], meetingId: mid,
        unitId: s.memberships.find((m) => m.userId === r.assigneeId && m.companyId === company)?.unitId }, me),
    )
    s.updateMeeting(mid, { taskIds: ids })
    toast({ title: 'المحضر اتحفظ', body: ids.length ? `${ids.length} مهام اتوزعت على أصحابها` : undefined, tone: 'ok' })
    onSaved(mid)
  }

  const patchRow = (key: string, p: Partial<DraftTask>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)))

  if (!companies.length)
    return (
      <Overlay onClose={onClose} label="اجتماع جديد">
        <Empty icon="building" title="ضيفي شركة الأول من الهيكل التنظيمي" />
      </Overlay>
    )

  return (
    <Overlay onClose={() => { if (!recording) onClose() }} kind="drawer" label="اجتماع جديد">
      <div className="stack" style={{ gap: 16 }}>
        <div className="row">
          <h2 style={{ fontSize: 20 }}>{step === 'review' ? 'راجعي المحضر والمهام' : 'اجتماع جديد'}</h2>
          <span className="spacer" />
          <button className="btn ghost icon" onClick={() => { if (recording) stopRec(); onClose() }} aria-label="إغلاق"><Icon name="close" /></button>
        </div>

        {step !== 'review' && (
          <>
            {companies.length > 1 && (
              <label className="field"><span>الشركة</span>
                <select className="select" value={companyId} onChange={(e) => setCompanyId(e.target.value)} disabled={step === 'working'}>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            )}
            <div className="seg" role="group" aria-label="طريقة التسجيل" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
              {([['live', 'mic', 'سجّلي دلوقتي'], ['upload', 'upload', 'ارفعي تسجيل'], ['text', 'edit', 'الصقي النص']] as const).map(([k, icon, label]) => (
                <button key={k} className={mode === k ? 'on' : ''} aria-pressed={mode === k} disabled={recording || step === 'working'} onClick={() => { setMode(k); setError('') }}>
                  <Icon name={icon} size={14} /> {label}
                </button>
              ))}
            </div>

            {mode === 'live' && (
              <div className="card rec-card">
                <button className={`rec-btn ${recording ? 'on' : ''}`} onClick={recording ? stopRec : startRec} disabled={step === 'working'} aria-label={recording ? 'وقّفي التسجيل' : 'ابدئي التسجيل'}>
                  <Icon name={recording ? 'close' : 'mic'} size={30} />
                </button>
                <div className="num" style={{ fontSize: 22, fontWeight: 600 }}>{recording ? `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}` : file || transcript ? 'التسجيل خلص' : 'جاهزة'}</div>
                <div className="muted" style={{ fontSize: 13, textAlign: 'center' }}>
                  {recording ? 'بسمع… خلّي الموبايل أو اللابتوب قريب من اللي بيتكلموا.' : 'للمكالمات: افتحي السبيكر وسجّلي من هنا، أو ارفعي تسجيل المكالمة.'}
                </div>
                {(transcript || interim) && (
                  <textarea className="textarea input" style={{ width: '100%', minHeight: 140 }} value={recording ? `${transcript} ${interim}`.trim() : transcript} readOnly={recording} onChange={(e) => setTranscript(e.target.value)} aria-label="الكلام المتسجل" />
                )}
                {!SpeechRec && <div className="muted" style={{ fontSize: 12 }}>المتصفح ده مش بيكتب الكلام وإنتي بتسجّلي، فالتسجيل هيتبعت للسيرفر يتحول لنص.</div>}
              </div>
            )}

            {mode === 'upload' && (
              <label className="card upload-box">
                <Icon name="upload" size={28} />
                <span>{file ? file.name : 'اختاري تسجيل الاجتماع أو المكالمة'}</span>
                <span className="muted" style={{ fontSize: 12 }}>mp3, m4a, wav, ogg, webm · لحد 25 ميجا</span>
                <input type="file" accept="audio/*,video/mp4,video/webm,.m4a,.mp3,.wav,.ogg,.opus,.aac" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
            )}

            {mode === 'text' && (
              <textarea className="textarea input" style={{ minHeight: 200 }} placeholder="الصقي هنا كلام الاجتماع أو ملاحظاتك عنه…" value={transcript} onChange={(e) => setTranscript(e.target.value)} />
            )}

            {error && <div className="card tone-late" style={{ fontSize: 14 }}>{error}</div>}

            <div className="row wrap" style={{ justifyContent: 'flex-end', gap: 8 }}>
              {error && step === 'capture' && <button className="btn ghost" onClick={() => fill({})}>كمّلي يدوي</button>}
              <button className="btn primary" onClick={go} disabled={recording || step === 'working'}>
                <Icon name="sparkle" size={18} /> {step === 'working' ? 'بكتب المحضر…' : 'طلّعي المحضر والمهام'}
              </button>
            </div>
          </>
        )}

        {step === 'review' && (
          <>
            <label className="field"><span>العنوان</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="اجتماع" /></label>
            <label className="field"><span>الملخص</span><textarea className="textarea input" value={summary} onChange={(e) => setSummary(e.target.value)} /></label>
            <div className="grid grid-2">
              <label className="field"><span>اللي اتناقش (كل نقطة في سطر)</span><textarea className="textarea input" value={points} onChange={(e) => setPoints(e.target.value)} /></label>
              <label className="field"><span>القرارات (كل قرار في سطر)</span><textarea className="textarea input" value={decisions} onChange={(e) => setDecisions(e.target.value)} /></label>
            </div>

            <div className="row"><h3 className="muted">المهام</h3><span className="spacer" />
              <button className="btn sm ghost" onClick={() => setRows((r) => [...r, { key: uid('dt_'), on: true, title: '', description: '', assigneeId: me, dueAt: '', priority: 'medium' }])}><Icon name="plus" size={16} /> مهمة</button>
            </div>
            {rows.length === 0 && <div className="muted" style={{ fontSize: 14 }}>مطلعش مهام. تقدري تضيفي بإيدك.</div>}
            {rows.map((r) => (
              <div key={r.key} className={`card draft-task ${r.on ? '' : 'off'}`}>
                <div className="row" style={{ gap: 10 }}>
                  <input type="checkbox" checked={r.on} onChange={(e) => patchRow(r.key, { on: e.target.checked })} aria-label="ضيفي المهمة دي" />
                  <input className="input" style={{ flex: 1 }} value={r.title} onChange={(e) => patchRow(r.key, { title: e.target.value })} placeholder="المهمة" aria-label="المهمة" />
                </div>
                {r.description && <div className="muted" style={{ fontSize: 13, margin: '6px 28px 0 0' }}>{r.description}</div>}
                <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
                  <select className="select" value={r.assigneeId} onChange={(e) => patchRow(r.key, { assigneeId: e.target.value })} aria-label="المسؤول">
                    {people.map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === me ? ' (أنا)' : ''}</option>)}
                  </select>
                  <input className="input num" type="datetime-local" value={r.dueAt} onChange={(e) => patchRow(r.key, { dueAt: e.target.value })} aria-label="الميعاد" />
                  <select className="select" value={r.priority} onChange={(e) => patchRow(r.key, { priority: e.target.value as Priority })} aria-label="الأولوية">
                    {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
                  </select>
                </div>
              </div>
            ))}

            <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn ghost" onClick={() => setStep('capture')}>رجوع</button>
              <button className="btn primary" onClick={save}><Icon name="check" size={18} /> احفظي ووزّعي المهام</button>
            </div>
          </>
        )}
      </div>
    </Overlay>
  )
}
