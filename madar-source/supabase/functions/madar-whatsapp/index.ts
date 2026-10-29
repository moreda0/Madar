// مدار: two-way WhatsApp (Supabase Edge Function "madar-whatsapp", JWT verification OFF).
//
//  POST {"tick":true}   every few minutes from Supabase Cron: creates due/overdue reminders (same ids the
//                       app uses) and sends every new alert to people who turned WhatsApp on, with buttons.
//  GET  ?hub.*          Meta's one-time webhook check (WA_VERIFY_TOKEN).
//  POST from Meta       replies: button taps (خلصت / فكّريني بعد ساعة), and text like "مهامي" or "خلصت 2".
//                       Free text goes to Claude when ANTHROPIC_API_KEY is set; anything it would change
//                       waits for a "تمام" tap.
//
// Secrets: WA_TOKEN, WA_PHONE_ID, WA_APP_SECRET, WA_VERIFY_TOKEN, optional WA_TEMPLATE (madar_alert),
// WA_LANG (ar), WA_API_VERSION (v23.0), APP_URL, ANTHROPIC_API_KEY.
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0'
import { createClient } from 'npm:@supabase/supabase-js@2'

const env = (k: string, d = '') => Deno.env.get(k) ?? d
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
const GRAPH = `https://graph.facebook.com/${env('WA_API_VERSION', 'v23.0')}/${env('WA_PHONE_ID')}/messages`
const APP_URL = env('APP_URL', 'https://moreda0.github.io/Madar/')

/* ---------- data (the app's records table) ---------- */

type Rec = Record<string, any>
interface Data { users: Rec[]; companies: Rec[]; units: Rec[]; memberships: Rec[]; tasks: Rec[]; notifications: Rec[] }

async function load(kinds: (keyof Data)[]): Promise<Data> {
  const out: Data = { users: [], companies: [], units: [], memberships: [], tasks: [], notifications: [] }
  for (const kind of kinds) {
    for (let from = 0; ; from += 1000) {
      let q = db.from('records').select('data').eq('kind', kind).eq('deleted', false).range(from, from + 999)
      if (kind === 'notifications') q = q.gt('updated_at', new Date(Date.now() - 3 * 864e5).toISOString())
      const { data, error } = await q
      if (error) throw error
      out[kind].push(...data.map((r) => r.data))
      if (data.length < 1000) break
    }
  }
  return out
}

const save = (kind: string, id: string, data: Rec) => db.from('records').upsert({ kind, id, data, deleted: false }, { onConflict: 'kind,id' })
const rid = (p: string) => p + crypto.randomUUID().replace(/-/g, '').slice(0, 10)

const STATUS_LABEL: Rec = { todo: 'لسه', doing: 'شغالين عليها', review: 'مراجعة', done: 'خلصت' }

async function setStatus(d: Data, task: Rec, status: string, actor: Rec) {
  if (task.status === status) return
  const next = { ...task, status, completedAt: status === 'done' ? new Date().toISOString() : undefined }
  await save('tasks', task.id, next)
  Object.assign(task, next)
  // tell the other people on the task, like the app does
  for (const w of new Set([task.creatorId, task.assigneeId].filter((x) => x && x !== actor.id))) {
    const n = { id: rid('n_'), userId: w, companyId: task.companyId, kind: 'status', title: status === 'done' ? `${actor.name} خلّص مهمة` : `${actor.name} نقل مهمة لـ "${STATUS_LABEL[status]}"`, body: task.title, taskId: task.id, at: new Date().toISOString(), read: false }
    await save('notifications', n.id, n)
  }
  // the alert is handled: clear it on every device
  for (const n of d.notifications.filter((n) => n.taskId === task.id && n.userId === actor.id && !n.read)) await save('notifications', n.id, { ...n, read: true })
}

/* ---------- phones ---------- */

/** digits only, Egyptian local numbers to international (01xxxxxxxxx -> 201xxxxxxxxx) */
export function normPhone(p?: string) {
  let s = (p ?? '').replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/\D/g, '')
  if (s.startsWith('00')) s = s.slice(2)
  if (s.length === 11 && s.startsWith('01')) s = '2' + s
  return s
}

/* ---------- sending ---------- */

const clean = (s: string, max = 300) => (s ?? '').replace(/[\n\t]+/g, ' ').replace(/ {4,}/g, ' ').trim().slice(0, max) || '—'

async function wa(body: Rec): Promise<string | null> {
  const r = await fetch(GRAPH, { method: 'POST', headers: { Authorization: `Bearer ${env('WA_TOKEN')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', ...body }) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) { console.error('whatsapp send failed', r.status, JSON.stringify(j)); return null }
  return j.messages?.[0]?.id ?? null
}
const sendText = (to: string, text: string) => wa({ to, type: 'text', text: { body: text.slice(0, 4000), preview_url: false } })
const sendButtons = (to: string, text: string, buttons: { id: string; title: string }[]) =>
  wa({ to, type: 'interactive', interactive: { type: 'button', body: { text: text.slice(0, 1000) }, action: { buttons: buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title.slice(0, 20) } })) } } })

/** Alerts start conversations, so they go out as the approved template (works outside the 24h window) */
function sendAlert(to: string, n: Rec) {
  const components: Rec[] = [{ type: 'body', parameters: [{ type: 'text', text: clean(n.title, 120) }, { type: 'text', text: clean(n.body, 400) }] }]
  if (n.taskId) {
    components.push({ type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: `done:${n.taskId}` }] })
    components.push({ type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: `snooze:${n.taskId}` }] })
  }
  return wa({ to, type: 'template', template: { name: env('WA_TEMPLATE', 'madar_alert'), language: { code: env('WA_LANG', 'ar') }, components } })
}

/* ---------- tick: reminders + outbox ---------- */

async function tick() {
  const d = await load(['users', 'tasks', 'notifications'])
  const now = Date.now()
  const have = new Set(d.notifications.map((n) => n.id))
  const add = async (n: Rec) => {
    if (have.has(n.id)) return
    const full = { ...n, at: new Date().toISOString(), read: false }
    have.add(n.id); d.notifications.push(full)
    await save('notifications', n.id, full)
  }

  // the same reminders the app fires, with the same ids, so the app and the server never double up
  for (const t of d.tasks) {
    if (!t.dueAt || t.status === 'done') continue
    const due = new Date(t.dueAt).getTime()
    if (t.remindBefore > 0 && now >= due - t.remindBefore * 60000 && now < due && t.assigneeId)
      await add({ id: `rem:${t.id}:${t.dueAt}`, userId: t.assigneeId, companyId: t.companyId, kind: 'reminder', title: `فاضل ${Math.max(1, Math.round((due - now) / 60000))} دقيقة على الميعاد`, body: t.title, taskId: t.id })
    if (now >= due && now - due < 3 * 864e5)
      for (const u of new Set([t.assigneeId, t.creatorId].filter(Boolean)))
        await add({ id: `late:${t.id}:${t.dueAt}:${u}`, userId: u, companyId: t.companyId, kind: 'overdue', title: 'مهمة عدّت ميعادها', body: t.title, taskId: t.id })
  }

  // "فكّريني بعد ساعة"
  const { data: snoozes } = await db.from('wa_snooze').select('*').eq('done', false).lte('remind_at', new Date().toISOString())
  for (const s of snoozes ?? []) {
    const t = d.tasks.find((x) => x.id === s.task_id)
    if (t && t.status !== 'done') await add({ id: `snz:${s.id}`, userId: s.user_id, companyId: t.companyId, kind: 'reminder', title: 'فكّرتك زي ما طلبتي', body: t.title, taskId: t.id })
    await db.from('wa_snooze').update({ done: true }).eq('id', s.id)
  }

  // outbox: fresh, unread alerts for people who turned WhatsApp on
  const people = new Map(d.users.filter((u) => u.waOptIn && normPhone(u.phone).length >= 10).map((u) => [u.id, u]))
  const fresh = d.notifications.filter((n) => {
    const u = people.get(n.userId)
    return u && !n.read && now - new Date(n.at).getTime() < 6 * 3600e3 && (!u.waSince || n.at >= u.waSince)
  })
  if (!fresh.length) return { sent: 0 }
  const { data: sentRows } = await db.from('wa_sent').select('notification_id').in('notification_id', fresh.map((n) => n.id))
  const sent = new Set((sentRows ?? []).map((r) => r.notification_id))
  let count = 0
  for (const n of fresh.filter((n) => !sent.has(n.id)).slice(0, 40)) {
    const phone = normPhone(people.get(n.userId)!.phone)
    // claim first so two ticks never send the same alert
    const { error } = await db.from('wa_sent').insert({ notification_id: n.id, user_id: n.userId, task_id: n.taskId ?? null, phone })
    if (error) continue
    const id = await sendAlert(phone, n)
    if (id) { count++; await db.from('wa_sent').update({ wa_id: id }).eq('notification_id', n.id) }
  }
  return { sent: count }
}

/* ---------- incoming ---------- */

const norm = (s: string) => (s ?? '')
  .replace(/[ً-ْـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
  .replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[،؟?!.,]/g, ' ').toLowerCase().trim()

const fmtWhen = (iso?: string) => iso ? new Date(iso).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'من غير ميعاد'

function visibleTasks(d: Data, me: Rec) {
  const role = (c: string) => d.memberships.find((m) => m.userId === me.id && m.companyId === c)?.role
  const below = (root: string) => {
    const out = new Set([root]); let grew = true
    while (grew) { grew = false; for (const u of d.units) if (u.parentId && out.has(u.parentId) && !out.has(u.id)) { out.add(u.id); grew = true } }
    return out
  }
  return d.tasks.filter((t) => {
    const r = role(t.companyId)
    if (!r) return false
    if (r === 'admin' || t.assigneeId === me.id || t.creatorId === me.id) return true
    if (r !== 'manager') return false
    const units = new Set<string>()
    for (const u of d.units) if (u.companyId === t.companyId && u.managerId === me.id) below(u.id).forEach((x) => units.add(x))
    const mu = d.memberships.find((m) => m.userId === me.id && m.companyId === t.companyId)?.unitId
    if (mu) below(mu).forEach((x) => units.add(x))
    const au = d.memberships.find((m) => m.userId === t.assigneeId && m.companyId === t.companyId)?.unitId
    return (t.unitId && units.has(t.unitId)) || (au && units.has(au))
  })
}

async function setState(phone: string, patch: Rec) {
  await db.from('wa_state').upsert({ phone, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'phone' })
}

const HELP = 'أقدر أساعدك من هنا:\n• "مهامي" أو "ملخص" ← مهام النهارده والمتأخر\n• "خلصت 2" ← أعلّم المهمة رقم 2 من آخر قايمة\n• "ضيفي مراجعة العقد بكرة الساعة 11"\n• ولما يجيلك تنبيه، دوسي "خلصت" أو "فكّريني بعد ساعة"\n\nمدار: ' + APP_URL

async function listMine(d: Data, me: Rec, phone: string, onlyLate = false) {
  const end = new Date(); end.setHours(23, 59, 59, 999)
  const now = Date.now()
  const list = d.tasks
    .filter((t) => t.assigneeId === me.id && t.status !== 'done' && t.dueAt && new Date(t.dueAt) <= end && (!onlyLate || new Date(t.dueAt).getTime() < now))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt)).slice(0, 10)
  await setState(phone, { last_list: list.map((t) => t.id) })
  if (!list.length) return sendText(phone, onlyLate ? 'مفيش حاجة متأخرة عليكي 👏' : 'مفيش مهام عليكي النهارده 👏')
  const lines = list.map((t, i) => `${i + 1}. ${t.title} · ${fmtWhen(t.dueAt)}${new Date(t.dueAt).getTime() < now ? ' ⚠️ متأخرة' : ''}`)
  return sendText(phone, `${onlyLate ? 'المتأخر عليكي' : 'مهامك النهارده'}:\n${lines.join('\n')}\n\nابعتي "خلصت" ورقمها لما تخلصي.`)
}

/* online understanding with Claude (optional) */
const SYSTEM = `إنتي "مساعد مدار" على واتساب. ردي بالمصري، قصير جداً (لحد 4 سطور)، نص عادي من غير Markdown.
- استخدمي بس البيانات اللي في <context>. ماتخترعيش.
- لو الشخص عايز يضيف مهمة أو يغيّر حالة مهمة، حطيها في actions وقولي "أعملها؟". التنفيذ بيستنى زرار "تمام".
- create_task: companyId و assigneeId من الـ context. dueAt بصيغة ISO 8601 بتوقيت القاهرة أو null. priority: low | medium | high | urgent.
- set_status: taskId من الـ context، status: todo | doing | review | done.`
const nullable = (type: string, extra: Rec = {}) => ({ anyOf: [{ type, ...extra }, { type: 'null' }] })
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['reply', 'actions'],
  properties: {
    reply: { type: 'string' },
    actions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['type', 'title', 'companyId', 'dueAt', 'priority', 'assigneeId', 'taskId', 'status'], properties: {
      type: { type: 'string', enum: ['create_task', 'set_status'] }, title: nullable('string'), companyId: nullable('string'), dueAt: nullable('string'),
      priority: nullable('string', { enum: ['low', 'medium', 'high', 'urgent'] }), assigneeId: nullable('string'), taskId: nullable('string'), status: nullable('string', { enum: ['todo', 'doing', 'review', 'done'] }),
    } } },
  },
}

async function askClaude(d: Data, me: Rec, text: string) {
  const mine = visibleTasks(d, me).filter((t) => t.status !== 'done').slice(0, 250)
  const myCompanies = d.companies.filter((c) => d.memberships.some((m) => m.userId === me.id && m.companyId === c.id))
  const context = {
    now: new Date().toISOString(), timezone: 'Africa/Cairo', me: { id: me.id, name: me.name },
    companies: myCompanies.map((c) => ({ id: c.id, name: c.name, short: c.short })),
    people: d.users.filter((u) => d.memberships.some((m) => m.userId === u.id && myCompanies.some((c) => c.id === m.companyId))).map((u) => ({ id: u.id, name: u.name })),
    tasks: mine.map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, dueAt: t.dueAt, assigneeId: t.assigneeId, companyId: t.companyId })),
  }
  const res = await new Anthropic().beta.messages.create({
    model: 'claude-opus-5-5', max_tokens: 3000,
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: `<context>\n${JSON.stringify(context).slice(0, 50000)}\n</context>\n\n${text.slice(0, 1500)}` }],
  })
  if (res.stop_reason === 'refusal') return { reply: 'معلش، مش هقدر أساعد في دي.', actions: [] as Rec[] }
  const block = res.content.find((b) => b.type === 'text')
  if (!block || block.type !== 'text') return null
  const out = JSON.parse(block.text) as { reply: string; actions: Rec[] }
  // keep only actions that point at real things this person can see
  const ids = new Set(mine.map((t) => t.id))
  out.actions = out.actions.filter((a) =>
    (a.type === 'create_task' && a.title && myCompanies.some((c) => c.id === a.companyId)) ||
    (a.type === 'set_status' && ids.has(a.taskId) && a.status))
  return out
}

async function apply(d: Data, me: Rec, a: Rec) {
  if (a.type === 'set_status') {
    const t = d.tasks.find((x) => x.id === a.taskId)
    if (t) await setStatus(d, t, a.status, me)
    return
  }
  const assignee = d.users.some((u) => u.id === a.assigneeId) ? a.assigneeId : me.id
  const dueAt = a.dueAt && !isNaN(Date.parse(a.dueAt)) ? new Date(a.dueAt).toISOString() : undefined
  const t = { id: rid('t_'), companyId: a.companyId, title: a.title, description: '', status: 'todo', priority: a.priority ?? 'medium', assigneeId: assignee, creatorId: me.id, dueAt, remindBefore: 30, subtasks: [], comments: [], createdAt: new Date().toISOString() }
  await save('tasks', t.id, t)
  if (assignee !== me.id) {
    const n = { id: rid('n_'), userId: assignee, companyId: t.companyId, kind: 'assigned', title: `${me.name} كلّفك بمهمة جديدة`, body: t.title, taskId: t.id, at: new Date().toISOString(), read: false }
    await save('notifications', n.id, n)
  }
}

const describe = (d: Data, a: Rec) =>
  a.type === 'create_task'
    ? `➕ ${a.title}${a.dueAt ? ` · ${fmtWhen(a.dueAt)}` : ''}${a.assigneeId ? ` · ${d.users.find((u) => u.id === a.assigneeId)?.name ?? ''}` : ''}`
    : `✔️ ${d.tasks.find((t) => t.id === a.taskId)?.title ?? ''} ← ${STATUS_LABEL[a.status]}`

async function handleMessage(m: Rec) {
  const phone = normPhone(m.from)
  const d = await load(['users', 'companies', 'units', 'memberships', 'tasks', 'notifications'])
  const me = d.users.find((u) => normPhone(u.phone) === phone)
  if (!me) return sendText(phone, 'أهلاً! الرقم ده مش متسجل في مدار. اطلبي من المدير يكتب رقمك في ملفك، أو ضيفيه من الإعدادات في التطبيق.')

  // button taps: template quick replies and our own reply buttons
  const payload: string | undefined = m.button?.payload ?? m.interactive?.button_reply?.id
  if (payload) {
    const [kind, id] = payload.split(':')
    const task = id ? d.tasks.find((t) => t.id === id) : undefined
    if (kind === 'done') {
      if (!task) return sendText(phone, 'مش لاقية المهمة دي، يمكن اتمسحت.')
      await setStatus(d, task, 'done', me)
      return sendText(phone, `برافو ✅ "${task.title}" اتعلمت خلصت، واتشالت من التنبيهات في كل مكان.`)
    }
    if (kind === 'snooze') {
      if (!task) return sendText(phone, 'مش لاقية المهمة دي.')
      await db.from('wa_snooze').insert({ task_id: task.id, user_id: me.id, remind_at: new Date(Date.now() + 3600e3).toISOString() })
      for (const n of d.notifications.filter((n) => n.taskId === task.id && n.userId === me.id && !n.read)) await save('notifications', n.id, { ...n, read: true })
      return sendText(phone, `تمام ⏰ هفكّرك بـ "${task.title}" كمان ساعة.`)
    }
    if (kind === 'ok' || kind === 'no') {
      const { data: st } = await db.from('wa_state').select('pending').eq('phone', phone).maybeSingle()
      const pending = st?.pending
      await setState(phone, { pending: null })
      if (!pending || pending.id !== id) return sendText(phone, 'الطلب ده خلص وقته، ابعتيه تاني لو سمحتي.')
      if (kind === 'no') return sendText(phone, 'ماشي، لغيته 👍')
      for (const a of pending.actions) await apply(d, me, a)
      return sendText(phone, 'تمام ✅ اتعمل، وهتلاقيه في مدار على كل الأجهزة.')
    }
    // a template button pressed with no task attached
    if (/خلص/.test(payload)) return sendText(phone, 'تمام 👍')
    return sendText(phone, HELP)
  }

  if (m.type === 'audio') return sendText(phone, 'لسه مش بفهم الرسايل الصوتية 🙏 ابعتيها كتابة، أو استخدمي المايك في مساعد مدار جوه التطبيق.')
  if (m.type !== 'text') return sendText(phone, HELP)

  const raw: string = m.text?.body ?? ''
  const t = norm(raw)
  if (/^(مهامي|مهام|ملخص|النهارده|انهارده|عندي ايه|ورايا ايه|المهام)$/.test(t)) return listMine(d, me, phone)
  if (/^(المتاخر|متاخر|ايه المتاخر)$/.test(t)) return listMine(d, me, phone, true)
  if (/^(مساعده|ساعديني|help|\?|اوامر|ازاي)$/.test(t)) return sendText(phone, HELP)
  if (/^(شكرا|متشكره|تسلمي|ميرسي|تمام|اوك|ok)$/.test(t)) return sendText(phone, '🌸')

  const doneNum = t.match(/^(خلصت|خلص|تم|قفلت)( رقم)? (\d{1,2})$/)
  if (doneNum) {
    const { data: st } = await db.from('wa_state').select('last_list').eq('phone', phone).maybeSingle()
    const id = (st?.last_list ?? [])[+doneNum[3] - 1]
    const task = id && d.tasks.find((x) => x.id === id)
    if (!task) return sendText(phone, 'ابعتي "مهامي" الأول عشان أبعتلك القايمة بأرقامها.')
    await setStatus(d, task, 'done', me)
    return sendText(phone, `برافو ✅ "${task.title}" اتعلمت خلصت.`)
  }

  if (!env('ANTHROPIC_API_KEY')) return sendText(phone, `مش فاهمة قوي 🙈\n\n${HELP}`)
  try {
    const ans = await askClaude(d, me, raw)
    if (!ans) return sendText(phone, HELP)
    if (!ans.actions.length) return sendText(phone, ans.reply)
    const pending = { id: crypto.randomUUID().slice(0, 8), actions: ans.actions }
    await setState(phone, { pending })
    return sendButtons(phone, `${ans.reply}\n\n${ans.actions.map((a) => describe(d, a)).join('\n')}`, [{ id: `ok:${pending.id}`, title: 'تمام، اعمليها' }, { id: `no:${pending.id}`, title: 'لأ' }])
  } catch (e) {
    console.error('assistant failed', e)
    return sendText(phone, `معلش حصلت مشكلة، جربي تاني كمان شوية.\n\n${HELP}`)
  }
}

/* ---------- http ---------- */

async function validSignature(req: Request, raw: string) {
  const sig = req.headers.get('x-hub-signature-256') ?? ''
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env('WA_APP_SECRET')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)))
  const hex = 'sha256=' + Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('')
  if (hex.length !== sig.length) return false
  let diff = 0
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ sig.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req) => {
  const url = new URL(req.url)

  if (req.method === 'GET') {
    // Meta checks the webhook once when you save it
    if (url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === env('WA_VERIFY_TOKEN') && env('WA_VERIFY_TOKEN'))
      return new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 })
    return new Response('madar-whatsapp ok', { status: 200 })
  }
  if (req.method !== 'POST') return new Response('method', { status: 405 })

  const raw = await req.text()
  let body: Rec
  try { body = JSON.parse(raw || '{}') } catch { return new Response('bad json', { status: 400 }) }

  // Cron: safe to call any time, it only sends what is due and not sent yet
  if (body.tick) {
    try { return Response.json(await tick()) } catch (e) { console.error('tick failed', e); return Response.json({ error: 'tick' }, { status: 500 }) }
  }

  if (body.object !== 'whatsapp_business_account') return new Response('ignored', { status: 200 })
  if (!(await validSignature(req, raw))) return new Response('bad signature', { status: 401 })

  const messages: Rec[] = (body.entry ?? []).flatMap((e: Rec) => (e.changes ?? []).flatMap((c: Rec) => c.value?.messages ?? []))
  for (const m of messages) {
    try { await handleMessage(m) } catch (e) { console.error('message failed', e) }
  }
  // Meta only needs a quick 200
  return new Response('ok', { status: 200 })
})
