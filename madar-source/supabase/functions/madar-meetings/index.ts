// مدار: meetings -> minutes + tasks (Supabase Edge Function "madar-meetings", JWT verification OFF).
//
//  From the app (signed-in member, Authorization: Bearer <user token>):
//    JSON {transcript, context}  or  multipart {audio: File, context: JSON}
//    -> {transcript, title, summary, decisions, points, tasks}. Nothing is saved: the person reviews
//       the tasks in the app and approves them, and the app saves through normal sync.
//
//  Inbox, for outside senders such as the Instinct WhatsApp assistant (header x-madar-key: MEETINGS_INBOX_KEY):
//    JSON {transcript | audio_url | audio_base64 (+mime), title?, company?, from_phone?, at?}  or  multipart {audio, ...same fields}
//    or, when the sender wrote the minutes itself (no Claude key needed):
//    JSON {minutes: {title, summary, points[], decisions[], tasks[{title, description, assignee (name/phone/email), dueAt (ISO), priority}]}, transcript?, from_phone?, company?}
//    -> saves the meeting and its tasks straight into Madar (each task lands on its person, who gets an alert)
//       and answers {ok, meetingId, minutes (ready-to-send text), tasks, link}.
//
// Secrets: ANTHROPIC_API_KEY, MEETINGS_INBOX_KEY, and for audio TRANSCRIBE_API_KEY (+ optional TRANSCRIBE_URL,
// TRANSCRIBE_MODEL: any OpenAI-compatible speech-to-text; Groq's free whisper-large-v3 is the default), APP_URL, TZ_DEFAULT.
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0'
import { createClient } from 'npm:@supabase/supabase-js@2'

const env = (k: string, d = '') => Deno.env.get(k) ?? d
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-madar-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
class Fail extends Error { constructor(public code: string, public status = 400) { super(code) } }

const MAX_AUDIO = 25 * 1024 * 1024
const APP_URL = env('APP_URL', 'https://moreda0.github.io/Madar/')

/* ---------- speech to text ---------- */

async function transcribe(audio: Blob, name = 'meeting.webm'): Promise<string> {
  if (!env('TRANSCRIBE_API_KEY')) throw new Fail('no-transcriber', 501)
  if (audio.size > MAX_AUDIO) throw new Fail('too-big', 413)
  const form = new FormData()
  form.append('file', audio, name)
  form.append('model', env('TRANSCRIBE_MODEL', 'whisper-large-v3'))
  form.append('language', 'ar')
  form.append('response_format', 'json')
  const r = await fetch(env('TRANSCRIBE_URL', 'https://api.groq.com/openai/v1/audio/transcriptions'), {
    method: 'POST', headers: { Authorization: `Bearer ${env('TRANSCRIBE_API_KEY')}` }, body: form,
  })
  if (!r.ok) { console.error('transcribe failed', r.status, await r.text().catch(() => '')); throw new Fail(r.status === 429 ? 'busy' : 'transcribe-failed', 502) }
  const text = String((await r.json()).text ?? '').trim()
  if (!text) throw new Fail('empty-audio')
  return text
}

/* ---------- transcript -> minutes + tasks ---------- */

const SYSTEM = `إنتي كاتبة محاضر اجتماعات جوه تطبيق مدار لإدارة المهام.
هيوصلك نص اجتماع أو مكالمة (غالبًا متحول من صوت، فممكن يبقى فيه أخطاء في الكلمات والأسماء)، ومعاه قايمة الناس في <people>.
- title: عنوان قصير للاجتماع (لحد 8 كلمات).
- summary: ملخص من 2 لـ 4 جمل بالمصري البسيط.
- points: أهم النقاط اللي اتناقشت، كل نقطة جملة واحدة.
- decisions: القرارات اللي اتاخدت بس (مش أي كلام اتقال).
- tasks: كل حاجة حد اتطلب منه يعملها أو وعد إنه يعملها. title يبدأ بفعل وواضح لوحده. description فيها التفاصيل اللي اتقالت.
  assigneeId: id الشخص من <people> لو اسمه أو لقبه اتذكر بوضوح كمسؤول (اتسامحي مع أخطاء الكتابة في الأسماء)، وإلا null. ماتخمنيش.
  dueAt: ISO 8601 بتوقيت الـ timezone لو اتقال ميعاد ("بكرة"، "الخميس"، "آخر الأسبوع" محسوبة من now)، وإلا null.
  priority: urgent لو اتقال "ضروري/حالًا/النهارده"، high لو مهم، وإلا medium.
- companyId: لو في أكتر من شركة في <companies>، اختاري اللي الاجتماع عنها، وإلا أول واحدة.
- ماتخترعيش حاجة مش في النص. لو النص مفيهوش مهام سيبي tasks فاضية.`

const nullable = (type: string, extra: Record<string, unknown> = {}) => ({ anyOf: [{ type, ...extra }, { type: 'null' }] })
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'points', 'decisions', 'tasks', 'companyId'],
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    points: { type: 'array', items: { type: 'string' } },
    decisions: { type: 'array', items: { type: 'string' } },
    companyId: nullable('string'),
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'description', 'assigneeId', 'dueAt', 'priority'],
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          assigneeId: nullable('string'),
          dueAt: nullable('string'),
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        },
      },
    },
  },
}

interface Ctx { now?: string; timezone?: string; companies?: { id: string; name: string }[]; people?: { id: string; name: string; title?: string; companies?: string[] }[] }
interface Minutes { title: string; summary: string; points: string[]; decisions: string[]; companyId: string | null; tasks: { title: string; description: string; assigneeId: string | null; dueAt: string | null; priority: string }[] }

// made on first use: the client throws without ANTHROPIC_API_KEY, and ready-made minutes don't need it
let client: Anthropic | null = null
const anthropic = () => {
  if (!env('ANTHROPIC_API_KEY')) throw new Fail('api-key', 500)
  return (client ??= new Anthropic())
}

async function minutesOf(transcript: string, ctx: Ctx): Promise<Minutes> {
  if (transcript.replace(/\s+/g, ' ').trim().length < 20) throw new Fail('too-short')
  const context = {
    now: ctx.now ?? new Date().toISOString(),
    timezone: ctx.timezone ?? env('TZ_DEFAULT', 'Africa/Cairo'),
  }
  const prompt = `<context>${JSON.stringify(context)}</context>
<companies>${JSON.stringify(ctx.companies ?? []).slice(0, 5000)}</companies>
<people>${JSON.stringify(ctx.people ?? []).slice(0, 30000)}</people>
<transcript>
${transcript.slice(0, 150000)}
</transcript>`
  try {
    const res = await anthropic().beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = res.content.find((b) => b.type === 'text')
    if (res.stop_reason === 'refusal' || !text || text.type !== 'text') throw new Fail('failed', 502)
    const m = JSON.parse(text.text) as Minutes
    // only ids we actually know, and real dates
    const ids = new Set((ctx.people ?? []).map((p) => p.id))
    m.tasks = m.tasks.filter((t) => t.title?.trim()).map((t) => ({
      ...t,
      assigneeId: t.assigneeId && ids.has(t.assigneeId) ? t.assigneeId : null,
      dueAt: t.dueAt && !isNaN(Date.parse(t.dueAt)) ? new Date(t.dueAt).toISOString() : null,
    }))
    if (m.companyId && !(ctx.companies ?? []).some((c) => c.id === m.companyId)) m.companyId = null
    return m
  } catch (e) {
    if (e instanceof Fail) throw e
    if (e instanceof Anthropic.RateLimitError) throw new Fail('busy', 429)
    if (e instanceof Anthropic.AuthenticationError) throw new Fail('api-key', 500)
    console.error('claude failed', e)
    throw new Fail('failed', 502)
  }
}

/* ---------- the inbox: save straight into Madar ---------- */

type Rec = Record<string, any>
const rid = (p: string) => p + crypto.randomUUID().replace(/-/g, '').slice(0, 10)
const db = () => createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

async function load(kind: string): Promise<Rec[]> {
  const out: Rec[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from('records').select('data').eq('kind', kind).eq('deleted', false).range(from, from + 999)
    if (error) throw error
    out.push(...data.map((r) => r.data))
    if (data.length < 1000) return out
  }
}

/** digits only, Egyptian local numbers to international (01xxxxxxxxx -> 201xxxxxxxxx) */
function normPhone(p?: string) {
  let s = (p ?? '').replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/\D/g, '')
  if (s.startsWith('00')) s = s.slice(2)
  if (s.length === 11 && s.startsWith('01')) s = '2' + s
  return s
}

const fmtDue = (iso: string | null) => iso ? new Date(iso).toLocaleString('ar-EG', { timeZone: env('TZ_DEFAULT', 'Africa/Cairo'), weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }) : ''

/** Minutes as plain text (WhatsApp friendly) */
function minutesText(m: Minutes, names: Record<string, string>, company?: string) {
  const lines = [`📝 *محضر اجتماع: ${m.title}*`, company ? `🏢 ${company}` : '', '', m.summary]
  if (m.points.length) lines.push('', '*اللي اتناقش:*', ...m.points.map((p) => `• ${p}`))
  if (m.decisions.length) lines.push('', '*القرارات:*', ...m.decisions.map((d) => `✅ ${d}`))
  if (m.tasks.length) lines.push('', '*المهام:*', ...m.tasks.map((t, i) => `${i + 1}. ${t.title} — ${t.assigneeId ? names[t.assigneeId] : 'من غير مسؤول'}${t.dueAt ? ` (${fmtDue(t.dueAt)})` : ''}`))
  return lines.filter((l, i) => l !== '' || lines[i - 1] !== '').join('\n').trim()
}

/** Arabic-insensitive name key: no diacritics, one alef/yaa/taa marbuta form, no spaces */
const nameKey = (s: string) => String(s ?? '').replace(/[\u064B-\u0652\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim().toLowerCase()

/** Who a sender meant by "assignee": a phone, an email, a full name, or a unique first name */
function findPerson(who: unknown, people: { id: string; name: string }[], users: Rec[]): string | null {
  const w = String(who ?? '').trim()
  if (!w) return null
  const ids = new Set(people.map((p) => p.id))
  const byPhone = normPhone(w).length >= 10 ? users.find((u) => ids.has(u.id) && normPhone(u.phone) === normPhone(w)) : undefined
  if (byPhone) return byPhone.id
  const byMail = users.find((u) => ids.has(u.id) && u.email && u.email.toLowerCase() === w.toLowerCase())
  if (byMail) return byMail.id
  const k = nameKey(w)
  const full = people.find((p) => nameKey(p.name) === k)
  if (full) return full.id
  const first = people.filter((p) => nameKey(p.name).split(' ')[0] === k.split(' ')[0])
  return first.length === 1 ? first[0].id : null
}

/** A due date as ISO; a bare day ("2026-10-31") means end of that working day in Cairo */
function dueOf(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T17:00:00+02:00` : s)
  return isNaN(+d) ? null : d.toISOString()
}

/** Minutes the sender already wrote: {title, summary, points[], decisions[], tasks[{title, description, assignee, dueAt, priority}]} */
function readyMinutes(r: Rec, people: { id: string; name: string }[], pool: Rec[], users: Rec[]): Minutes {
  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [])
  const want = nameKey(r.company ?? '')
  return {
    title: String(r.title ?? 'اجتماع').slice(0, 200),
    summary: String(r.summary ?? ''),
    points: list(r.points),
    decisions: list(r.decisions),
    companyId: (want && pool.find((c) => [c.name, c.short].some((x) => nameKey(x) === want))?.id) || null,
    tasks: (Array.isArray(r.tasks) ? r.tasks : []).filter((t: Rec) => String(t?.title ?? '').trim()).map((t: Rec) => ({
      title: String(t.title).trim(),
      description: String(t.description ?? ''),
      assigneeId: findPerson(t.assignee ?? t.assigneeName ?? t.assignee_name ?? t.assigneePhone ?? t.owner, people, users),
      dueAt: dueOf(t.dueAt ?? t.due ?? t.deadline),
      priority: ['low', 'medium', 'high', 'urgent'].includes(t.priority) ? t.priority : 'medium',
    })),
  }
}

async function inbox(req: Request) {
  const ct = req.headers.get('content-type') ?? ''
  let f: Rec = {}
  let audio: Blob | null = null
  let audioName = 'meeting.ogg'
  if (ct.includes('multipart/form-data')) {
    const form = await req.formData()
    for (const [k, v] of form.entries()) {
      if (typeof v === 'string') f[k] = v
      else if (k === 'audio' || k === 'file') { audio = v; audioName = v.name || audioName }
    }
  } else {
    try { f = await req.json() } catch { throw new Fail('bad-json') }
  }
  if (!audio && f.audio_base64) {
    const bin = Uint8Array.from(atob(String(f.audio_base64).replace(/^data:[^,]*,/, '')), (c) => c.charCodeAt(0))
    audio = new Blob([bin], { type: f.mime || 'audio/ogg' })
  }
  if (!audio && f.audio_url) {
    const r = await fetch(String(f.audio_url))
    if (!r.ok) throw new Fail('audio-url', 400)
    if (Number(r.headers.get('content-length') ?? 0) > MAX_AUDIO) throw new Fail('too-big', 413)
    audio = await r.blob()
    audioName = new URL(String(f.audio_url)).pathname.split('/').pop() || audioName
  }
  // the sender may have written the minutes itself (then no Claude key is needed here)
  for (const k of ['minutes', 'tasks', 'points', 'decisions']) if (typeof f[k] === 'string' && /^\s*[[{]/.test(f[k])) { try { f[k] = JSON.parse(f[k]) } catch { throw new Fail(`bad-${k}`) } }
  // ...wrapped in "minutes", or sent as top-level fields
  let ready: Rec | null = f.minutes && typeof f.minutes === 'object' ? f.minutes as Rec : Array.isArray(f.tasks) || f.summary ? f : null
  // tasks may sit next to "minutes" instead of inside it
  if (ready && ready !== f && !(Array.isArray(ready.tasks) && ready.tasks.length) && Array.isArray(f.tasks)) ready = { ...ready, tasks: f.tasks }
  const transcript = audio && !ready ? await transcribe(audio, audioName) : String(f.transcript ?? f.text ?? '').trim()
  if (!transcript && !ready) throw new Fail('no-transcript')
  console.log('inbox', JSON.stringify({ fields: Object.keys(f), minutes: !!ready, tasks: Array.isArray(ready?.tasks) ? ready!.tasks.length : 0 }))

  const [users, companies, memberships] = await Promise.all([load('users'), load('companies'), load('memberships')])
  // who sent it: by phone, else the workspace owner
  const phone = normPhone(f.from_phone)
  let creator = phone ? users.find((u) => normPhone(u.phone) === phone) : undefined
  if (!creator) {
    const { data: owner } = await db().from('workspace_members').select('email').eq('role', 'owner').maybeSingle()
    creator = users.find((u) => u.email && u.email.toLowerCase() === owner?.email) ?? users.find((u) => memberships.some((m) => m.userId === u.id && m.role === 'admin'))
  }
  if (!creator) throw new Fail('no-owner', 409)
  const mine = companies.filter((c) => memberships.some((m) => m.userId === creator!.id && m.companyId === c.id && m.role !== 'employee'))
  if (!mine.length) throw new Fail('no-company', 409)
  const want = String(f.company ?? '').trim().toLowerCase()
  const named = want ? mine.find((c) => [c.id, c.name, c.short].some((x) => String(x ?? '').toLowerCase() === want)) : undefined
  const pool = named ? [named] : mine
  const people = users
    .filter((u) => memberships.some((m) => m.userId === u.id && pool.some((c) => c.id === m.companyId)))
    .map((u) => ({ id: u.id, name: u.name, title: memberships.find((m) => m.userId === u.id && pool.some((c) => c.id === m.companyId))?.title, companies: memberships.filter((m) => m.userId === u.id).map((m) => m.companyId) }))

  const m = ready ? readyMinutes(ready, people, pool, users) : await minutesOf(transcript, { now: f.at ?? undefined, companies: pool.map((c) => ({ id: c.id, name: c.name })), people })
  const company = pool.find((c) => c.id === m.companyId) ?? pool[0]
  // someone outside the chosen company can't hold its tasks
  const inCompany = new Set(memberships.filter((x) => x.companyId === company.id).map((x) => x.userId))
  const names = Object.fromEntries(users.map((u) => [u.id, u.name]))

  const now = new Date().toISOString()
  const meetingId = rid('mt_')
  const rows: Rec[] = []
  const taskIds: string[] = []
  for (const t of m.tasks) {
    const id = rid('t_')
    const assigneeId = t.assigneeId && inCompany.has(t.assigneeId) ? t.assigneeId : creator.id
    t.assigneeId = assigneeId
    taskIds.push(id)
    const unitId = memberships.find((x) => x.userId === assigneeId && x.companyId === company.id)?.unitId
    rows.push({ kind: 'tasks', id, data: { id, companyId: company.id, title: t.title, description: t.description, status: 'todo', priority: t.priority, assigneeId, creatorId: creator.id, unitId, dueAt: t.dueAt ?? undefined, remindBefore: 30, subtasks: [], comments: [], createdAt: now, meetingId } })
    if (assigneeId !== creator.id) {
      const n = { id: rid('n_'), userId: assigneeId, companyId: company.id, kind: 'assigned', title: `مهمة جديدة من اجتماع "${m.title}"`, body: t.title, taskId: id, at: now, read: false }
      rows.push({ kind: 'notifications', id: n.id, data: n })
    }
  }
  const attendeeIds = [...new Set([creator.id, ...m.tasks.map((t) => t.assigneeId!)])]
  rows.push({ kind: 'meetings', id: meetingId, data: { id: meetingId, companyId: company.id, title: f.title || m.title, at: f.at && !isNaN(Date.parse(f.at)) ? new Date(f.at).toISOString() : now, source: 'whatsapp', attendeeIds, transcript, summary: m.summary, decisions: m.decisions, points: m.points, taskIds, createdBy: creator.id } })
  const n = { id: rid('n_'), userId: creator.id, companyId: company.id, kind: 'meeting', title: `محضر "${f.title || m.title}" جاهز`, body: `${taskIds.length} مهام اتوزعت`, at: now, read: false }
  rows.push({ kind: 'notifications', id: n.id, data: n })

  const { error } = await db().from('records').upsert(rows.map((r) => ({ ...r, deleted: false })), { onConflict: 'kind,id' })
  if (error) { console.error('save failed', error); throw new Fail('save-failed', 500) }

  return json({
    ok: true,
    meetingId,
    company: company.name,
    minutes: minutesText({ ...m, title: f.title || m.title }, names, company.name),
    tasks: m.tasks.map((t) => ({ title: t.title, assignee: names[t.assigneeId!], dueAt: t.dueAt })),
    link: `${APP_URL}#/meetings?m=${meetingId}`,
  })
}

/* ---------- the app: draft for review ---------- */

async function fromApp(req: Request) {
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const { data: member } = await sb.rpc('is_member')
  if (member !== true) throw new Fail('not-member', 403)

  let transcript = ''
  let ctx: Ctx = {}
  if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
    const form = await req.formData()
    try { ctx = JSON.parse(String(form.get('context') ?? '{}')) } catch { /* no context */ }
    const audio = form.get('audio')
    if (audio instanceof File) transcript = await transcribe(audio, audio.name)
    else transcript = String(form.get('transcript') ?? '')
  } else {
    let body: { transcript?: string; context?: Ctx }
    try { body = await req.json() } catch { throw new Fail('bad-json') }
    transcript = String(body.transcript ?? '')
    ctx = body.context ?? {}
  }
  const m = await minutesOf(transcript, ctx)
  return json({ transcript, ...m })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  try {
    const key = (req.headers.get('x-madar-key') ?? new URL(req.url).searchParams.get('key'))?.trim()
    if (key) {
      // pasted secrets often carry a stray space or newline
      const want = env('MEETINGS_INBOX_KEY').trim()
      if (!want) return json({ error: 'inbox-not-configured' }, 503)
      if (key !== want) return json({ error: 'bad-key' }, 401)
      return await inbox(req)
    }
    return await fromApp(req)
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.code }, e.status)
    console.error(e)
    return json({ error: 'failed' }, 500)
  }
})
