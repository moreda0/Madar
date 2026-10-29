// مدار: online assistant (Supabase Edge Function "madar-assistant").
// The Claude API key stays here on the server (secret ANTHROPIC_API_KEY); the app never sees it.
// The app sends the conversation plus a snapshot of what this person can see; Claude answers in
// Egyptian Arabic and may propose actions, which the app shows as buttons for the person to confirm.
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0'
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const SYSTEM = `إنتي "مساعد مدار"، مساعدة شخصية جوه تطبيق مدار لإدارة المهام في كذا شركة.
- اتكلمي مصري بسيط ودافي، جمل قصيرة، ومن غير رطانة. خاطبي الشخص بصيغة المؤنث إلا لو اسمه واضح إنه راجل.
- إجاباتك مبنية بس على البيانات اللي في <context>. ماتخترعيش مهام أو أرقام. لو المعلومة مش موجودة قولي كده.
- لو الشخص طلب يضيف مهمة أو يغيّر حالة مهمة أو يروح لصفحة، حطي ده في actions، والتطبيق هيعرضه زرار يأكد عليه. ماتقوليش إنك عملتيها، قولي "أضيفها؟" أو "أعلّمها خلصت؟".
- create_task: استخدمي companyId و assigneeId من الـ context بالظبط. dueAt بصيغة ISO 8601 بتوقيت الشخص (timezone في الـ context)، ولو مقالش ميعاد سيبيه null. priority: low | medium | high | urgent.
- set_status: taskId من الـ context، و status: todo | doing | review | done.
- open: path واحد من /, /tasks, /attendance, /performance, /notifications, /org, /settings، و label كلمتين بالعربي.
- taskIds: المهام اللي ليها علاقة بالرد (لحد 8) عشان تتعرض كروت تحت الرد.
- الرد (reply) نص عادي من غير Markdown، ولحد 6 سطور.`

const nullable = (type: string, extra: Record<string, unknown> = {}) => ({ anyOf: [{ type, ...extra }, { type: 'null' }] })
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'taskIds', 'actions'],
  properties: {
    reply: { type: 'string' },
    taskIds: { type: 'array', items: { type: 'string' } },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'title', 'companyId', 'dueAt', 'priority', 'assigneeId', 'taskId', 'status', 'path', 'label'],
        properties: {
          type: { type: 'string', enum: ['create_task', 'set_status', 'open'] },
          title: nullable('string'),
          companyId: nullable('string'),
          dueAt: nullable('string'),
          priority: nullable('string', { enum: ['low', 'medium', 'high', 'urgent'] }),
          assigneeId: nullable('string'),
          taskId: nullable('string'),
          status: nullable('string', { enum: ['todo', 'doing', 'review', 'done'] }),
          path: nullable('string'),
          label: nullable('string'),
        },
      },
    },
  },
}

const anthropic = new Anthropic() // reads ANTHROPIC_API_KEY

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method' }, 405)

  // only people in this Madar workspace may use it
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: member } = await sb.rpc('is_member')
  if (member !== true) return json({ error: 'not-member' }, 403)

  let body: { messages?: { role: 'user' | 'assistant'; text: string }[]; context?: unknown }
  try { body = await req.json() } catch { return json({ error: 'bad-json' }, 400) }
  const history = (body.messages ?? []).filter((m) => m.text?.trim()).slice(-12)
  if (!history.length || history[history.length - 1].role !== 'user') return json({ error: 'no-question' }, 400)

  // the API wants turns to alternate, starting with the person
  const turns: Anthropic.Beta.BetaMessageParam[] = []
  for (const m of history) {
    const prev = turns[turns.length - 1]
    if (prev && prev.role === m.role) prev.content = `${prev.content}\n${m.text}`
    else turns.push({ role: m.role, content: m.text.slice(0, 2000) })
  }
  while (turns[0]?.role === 'assistant') turns.shift()
  const last = turns[turns.length - 1]
  last.content = `<context>\n${JSON.stringify(body.context ?? {}).slice(0, 60000)}\n</context>\n\n${last.content}`

  try {
    const res = await anthropic.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: turns,
    })
    if (res.stop_reason === 'refusal') return json({ reply: 'معلش، مش هقدر أساعد في دي.', taskIds: [], actions: [] })
    const text = res.content.find((b) => b.type === 'text')
    if (!text || text.type !== 'text') return json({ error: 'empty' }, 502)
    return json(JSON.parse(text.text))
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'busy' }, 429)
    if (e instanceof Anthropic.AuthenticationError) return json({ error: 'api-key' }, 500)
    if (e instanceof Anthropic.APIError) return json({ error: 'api', status: e.status }, 502)
    return json({ error: 'failed' }, 500)
  }
})
