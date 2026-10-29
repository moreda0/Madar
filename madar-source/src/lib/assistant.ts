import type { AttendanceRecord, Company, ID, Membership, MonthlyRating, OrgUnit, Priority, Task, TaskStatus, User } from './types'
import { canSeeTask } from './access'
import { monthKey, monthScore } from './performance'
import { fmtTime, isToday, PRIORITY_LABEL, PRIORITY_WEIGHT, STATUS_LABEL } from './utils'

/**
 * مساعد مدار: understands short Egyptian Arabic requests on the device, with no server.
 * Anything it can change comes back as a proposed action the person confirms with a tap.
 */

export type AssistantAction =
  | { type: 'create_task'; title: string; companyId: ID; dueAt?: string; priority: Priority; assigneeId?: ID }
  | { type: 'set_status'; taskId: ID; status: TaskStatus }
  | { type: 'open'; path: string; label: string }

export interface AssistantReply {
  text: string
  taskIds?: ID[]
  actions?: AssistantAction[]
  suggestions?: string[]
  /** true when the local engine didn't understand, so the online assistant may try */
  unsure?: boolean
}

export interface AssistantData {
  me: ID
  users: User[]
  companies: Company[]
  units: OrgUnit[]
  memberships: Membership[]
  tasks: Task[]
  attendance: AttendanceRecord[]
  ratings: MonthlyRating[]
}

/* ---------- text helpers ---------- */

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'
export function norm(s: string) {
  return s
    .replace(/[ً-ْـ]/g, '') // harakat + tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/[،؟?!.,]/g, ' ')
    .toLowerCase()
    .trim()
}

const has = (t: string, ...words: string[]) => words.some((w) => t.includes(w))

/* ---------- dates & times ---------- */

const DAYS: [RegExp, number][] = [
  [/^(ال)?حد$|^(ال)?احد$/, 0],
  [/^(ال)?اتنين$|^(ال)?اثنين$/, 1],
  [/^(ال)?تلات$|^(ال)?ثلاثاء$|^(ال)?تلاتاء$/, 2],
  [/^(ال)?اربع$|^(ال)?اربعاء$|^(ال)?اربعا$/, 3],
  [/^(ال)?خميس$/, 4],
  [/^(ال)?جمعه$/, 5],
  [/^(ال)?سبت$/, 6],
]

const NUM_WORDS: Record<string, number> = {
  واحده: 1, واحد: 1, اتنين: 2, اثنين: 2, تلاته: 3, ثلاثه: 3, اربعه: 4, خمسه: 5, سته: 6, سبعه: 7, تمانيه: 8, ثمانيه: 8, تسعه: 9, عشره: 10, حداشر: 11, اتناشر: 12,
}

interface Tok { raw: string; n: string; used: boolean }

/** Finds a date/time in the words and marks them used. Returns undefined when none was said. */
function takeWhen(toks: Tok[], now: Date): Date | undefined {
  let day: Date | undefined
  let hour: number | undefined
  let minute = 0
  let part: 'am' | 'pm' | 'noon' | 'asr' | 'evening' | undefined
  const at = (i: number) => toks[i]?.n ?? ''
  const use = (...is: number[]) => is.forEach((i) => toks[i] && (toks[i].used = true))
  const base = new Date(now)
  base.setHours(0, 0, 0, 0)
  const plus = (n: number) => { const d = new Date(base); d.setDate(d.getDate() + n); return d }

  for (let i = 0; i < toks.length; i++) {
    const w = at(i)
    if (w === 'بعد' && /^بكر[اه]$/.test(at(i + 1))) { day = plus(2); use(i, i + 1); i++; continue }
    if (/^(النهارده|انهارده|النهاردا|اليوم)$/.test(w)) { day = plus(0); use(i); continue }
    if (/^(ب|ل)?بكر[اه]$/.test(w)) { day = plus(1); use(i); continue }
    if (w === 'بعد' && /^(يومين|تلات|اسبوع|\d+)$/.test(at(i + 1))) {
      const n = at(i + 1) === 'يومين' ? 2 : at(i + 1) === 'اسبوع' ? 7 : at(i + 1) === 'تلات' ? 3 : +at(i + 1)
      day = plus(n); use(i, i + 1); if (/^(ايام|يوم)$/.test(at(i + 2))) use(i + 2); i++; continue
    }
    if (/^(الاسبوع|الأسبوع)$/.test(w) && /^(الجاي|القادم)$/.test(at(i + 1))) { day = plus(7); use(i, i + 1); i++; continue }
    const dn = DAYS.find(([re]) => re.test(w.replace(/^يوم/, '')))
    if (dn && (i === 0 || /^(يوم|الجاي)$/.test(at(i - 1)) || /^ال/.test(w))) {
      const diff = (dn[1] - now.getDay() + 7) % 7
      day = plus(diff === 0 ? 7 : diff)
      use(i); if (at(i - 1) === 'يوم') use(i - 1); if (at(i + 1) === 'الجاي') use(i + 1)
      continue
    }
    // الساعه 3 / الساعه 3:30 / 3:30
    if (/^(ال)?ساعه$/.test(w) || /^\d{1,2}([:.]\d{2})?$/.test(w)) {
      const j = /^\d/.test(w) ? i : i + 1
      const v = at(j)
      let h: number | undefined, m = 0
      const mm = v.match(/^(\d{1,2})(?:[:.](\d{2}))?$/)
      if (mm) { h = +mm[1]; m = mm[2] ? +mm[2] : 0 } else if (NUM_WORDS[v] && j !== i) h = NUM_WORDS[v]
      if (h !== undefined && h <= 24 && (j !== i || /^(ال)?ساعه$/.test(at(i - 1)) || mm?.[2])) {
        hour = h; minute = m; use(i, j)
        const nx = at(j + 1)
        if (nx === 'ونص') { minute = 30; use(j + 1) } else if (nx === 'وربع') { minute = 15; use(j + 1) }
        else if (nx === 'الا' && at(j + 2) === 'ربع') { hour = h - 1; minute = 45; use(j + 1, j + 2) }
        i = j
        continue
      }
    }
    if (/^(الصبح|صباحا|صباح)$/.test(w)) { part = 'am'; use(i); continue }
    if (/^(بالليل|بليل|مساء|مساءا|بالمسا|المسا|المغرب|بعد)$/.test(w) && (w !== 'بعد' || /^(الضهر|الظهر)$/.test(at(i + 1)))) {
      part = w === 'بعد' ? 'pm' : 'evening'; use(i); if (w === 'بعد') use(i + 1); continue
    }
    if (/^(الضهر|الظهر)$/.test(w)) { part = 'noon'; use(i); continue }
    if (/^(العصر)$/.test(w)) { part = 'asr'; use(i); continue }
  }

  if (!day && hour === undefined && !part) return undefined
  const d = day ?? plus(0)
  if (hour === undefined) hour = part === 'am' ? 10 : part === 'noon' ? 12 : part === 'asr' ? 16 : part === 'evening' ? 20 : part === 'pm' ? 14 : 17
  else if (hour < 12 && (part === 'evening' || part === 'pm' || part === 'asr' || (!part && hour >= 1 && hour <= 7))) hour += 12
  d.setHours(hour, minute, 0, 0)
  // a bare time that already passed today means tomorrow
  if (!day && d < now) d.setDate(d.getDate() + 1)
  return d
}

/* ---------- lookups ---------- */

const firstName = (u: User) => norm(u.name).split(/\s+/)[0]

function findPerson(n: string, people: User[]): User | undefined {
  const w = n.replace(/^(ل|لـ|ل_|علي|مع)/, '')
  if (w.length < 2) return undefined
  return people.find((u) => firstName(u) === w) ?? people.find((u) => norm(u.name) === w)
}

function findCompany(n: string, companies: Company[]): Company | undefined {
  const w = n.replace(/^(ل|ب|في|و)?(ال)?/, '')
  if (w.length < 2) return undefined
  return companies.find((c) => {
    const names = [norm(c.short), ...norm(c.name).split(/\s+/)].map((x) => x.replace(/^ال/, ''))
    return names.some((x) => x.length > 1 && x === w)
  })
}

/** Score how well the words match a task title */
function matchTask(words: string[], tasks: Task[]): Task | undefined {
  const ws = words.filter((w) => w.length > 1 && !STOP.has(w))
  if (!ws.length) return undefined
  let best: Task | undefined, bestScore = 0
  for (const t of tasks) {
    const tw = norm(t.title).split(/\s+/).map((x) => x.replace(/^ال/, ''))
    const s = ws.filter((w) => tw.some((x) => x === w.replace(/^ال/, '') || (w.length > 3 && x.startsWith(w.replace(/^ال/, ''))))).length / ws.length
    if (s > bestScore) { best = t; bestScore = s }
  }
  return bestScore >= 0.5 ? best : undefined
}

const STOP = new Set(['مهمه', 'المهمه', 'تاسك', 'بتاعه', 'بتاع', 'اللي', 'بتاعت', 'خلاص', 'يا', 'من', 'في', 'علي', 'عن', 'و', 'ال', 'دي', 'ده'])

/* ---------- the engine ---------- */

const SUGGEST = ['ملخص النهارده', 'إيه المتأخر؟', 'ضيفي مهمة بكرة الساعة 3', 'درجة التزامي']

export function localAssistant(input: string, d: AssistantData, now = new Date()): AssistantReply {
  const t = norm(input)
  const me = d.users.find((u) => u.id === d.me)
  const myCompanies = d.companies.filter((c) => d.memberships.some((m) => m.userId === d.me && m.companyId === c.id))
  const visible = d.tasks.filter((x) => canSeeTask(d, d.me, x))
  const open = visible.filter((x) => x.status !== 'done')
  const mine = open.filter((x) => x.assigneeId === d.me)
  const late = (list: Task[]) => list.filter((x) => x.dueAt && new Date(x.dueAt) < now).sort(byDue)
  const today = mine.filter((x) => isToday(x.dueAt)).sort(byDue)
  const name = me?.name.split(' ')[0] ?? ''
  const people = d.users.filter((u) => u.id !== d.me && d.memberships.some((m) => m.userId === u.id && myCompanies.some((c) => c.id === m.companyId)))

  if (!t) return { text: 'قوليلي محتاجة إيه 🙂', suggestions: SUGGEST }

  /* create */
  if (/^(ضيف|ضيفي|اضيف|اضيفي|اعمل|اعملي|سجل|سجلي|فكرني|فكريني|عاوزه اعمل|عايزه اعمل|محتاجه اعمل|مهمه جديده|زود|زودي|حط|حطي)( |$)/.test(t) || /^(ممكن|لو سمحت) (تضيف|تعمل|تفكر)/.test(t)) {
    const toks: Tok[] = input.trim().split(/\s+/).map((raw) => ({ raw, n: norm(raw), used: false }))
    // drop the opening verb ("ضيفي مهمة", "فكريني إني"…)
    let i = 0
    while (i < toks.length && /^(ضيف|ضيفي|اضيف|اضيفي|اعمل|اعملي|سجل|سجلي|فكرني|فكريني|عاوزه|عايزه|محتاجه|زود|زودي|حط|حطي|ممكن|لو|سمحت|تضيف|تعمل|تفكر|تفكرني|مهمه|جديده|لي|ليا|اني|بان|ب|ان|عشان)$/.test(toks[i].n)) toks[i++].used = true
    const dueAt = takeWhen(toks, now)
    let priority: Priority = 'medium'
    let assignee: User | undefined
    let company: Company | undefined
    toks.forEach((k, j) => {
      if (k.used) return
      if (/^(عاجل|عاجله|ضروري|ضروريه|طارئ|طارئه)$/.test(k.n)) { priority = 'urgent'; k.used = true; if (toks[j - 1]?.n === 'و') toks[j - 1].used = true; return }
      if (/^(مهم|مهمه|هامه|هام)$/.test(k.n) && j > 0) { priority = 'high'; k.used = true; if (/^(جدا|اوي|قوي)$/.test(toks[j + 1]?.n ?? '')) toks[j + 1].used = true; return }
      if (/^(اولويه)$/.test(k.n)) { k.used = true; if (/^(عاليه|عالي)$/.test(toks[j + 1]?.n ?? '')) { priority = 'high'; toks[j + 1].used = true } return }
      if (!assignee && /^(ل|لـ|علي|مع)/.test(k.n)) {
        const p = findPerson(k.n, people)
        if (p) { assignee = p; k.used = true; return }
      }
      if (!assignee && /^(ل|لـ|علي)$/.test(k.n) && toks[j + 1]) {
        const p = findPerson(toks[j + 1].n, people)
        if (p) { assignee = p; k.used = true; toks[j + 1].used = true; return }
      }
      if (!company) {
        const c = findCompany(k.n, myCompanies)
        if (c && (j > 0 && /^(في|ل|لشركه|شركه|بتاع|بتاعه)$/.test(toks[j - 1].n) || /^(ل|ب|في)/.test(k.n))) {
          company = c; k.used = true
          if (j > 0 && /^(في|ل|لشركه|شركه|بتاع|بتاعه)$/.test(toks[j - 1].n)) toks[j - 1].used = true
        }
      }
    })
    // tidy edges: dangling little words left behind by removed phrases
    const words = toks.filter((k) => !k.used).map((k) => k.raw)
    while (words.length && /^(و|في|يوم|علي|على|ل|الساعة|الساعه|ب)$/.test(norm(words[words.length - 1]))) words.pop()
    while (words.length && /^(و|ان|إن|إني|اني)$/.test(norm(words[0]))) words.shift()
    const title = words.join(' ').replace(/^[-:،,\s]+|[-:،,\s]+$/g, '')
    if (!title) return { text: 'تمام، اسم المهمة إيه؟ قوليها مرة واحدة، مثلاً: "ضيفي مراجعة العقد بكرة الساعة 11"' }
    // company: the one named, else the assignee's, else the only/first one
    if (!company && assignee) company = myCompanies.find((c) => d.memberships.some((m) => m.userId === assignee!.id && m.companyId === c.id))
    if (!company) company = myCompanies[0]
    if (!company) return { text: 'لسه مفيش شركات عندك. ضيفي شركة الأول من الهيكل التنظيمي.', actions: [{ type: 'open', path: '/org', label: 'افتحي الهيكل' }] }
    const due = dueAt ?? endOfWorkday(now, company)
    const who = assignee ? `لـ ${assignee.name}` : 'ليكي'
    return {
      text: `هضيف مهمة "${title}" ${who} في ${company.short}، ميعادها ${whenLabel(due, now)}${priority !== 'medium' ? `، وأولويتها ${PRIORITY_LABEL[priority]}` : ''}. أضيفها؟`,
      actions: [{ type: 'create_task', title, companyId: company.id, dueAt: due.toISOString(), priority, assigneeId: assignee?.id ?? d.me }],
    }
  }

  /* complete */
  const doneM = t.match(/^(خلصت|خلصنا|خلصي|خلص|قفلت|قفلي|اقفلي|علمي|خلاص خلصت|تم)( علي)?( مهمه| المهمه)? (.+)/)
  if (doneM) {
    const words = doneM[4].split(/\s+/)
    const task = matchTask(words, open)
    if (!task) return { text: `مش لاقية مهمة مفتوحة اسمها "${doneM[4]}". جربي كلمة من اسمها.`, taskIds: mine.slice(0, 5).map((x) => x.id) }
    return { text: `قصدك "${task.title}"؟ أعلّمها خلصت؟`, taskIds: [task.id], actions: [{ type: 'set_status', taskId: task.id, status: 'done' }] }
  }
  const startM = t.match(/^(ابدئي|ابتدي|بدات|ابدا|شغاله علي|بشتغل علي) (في |علي )?(مهمه )?(.+)/)
  if (startM) {
    const task = matchTask(startM[4].split(/\s+/), open)
    if (task) return { text: `"${task.title}" أخليها شغالة عليها دلوقتي؟`, taskIds: [task.id], actions: [{ type: 'set_status', taskId: task.id, status: 'doing' }] }
  }

  /* late */
  if (has(t, 'متاخر', 'اتاخر', 'فات ميعاد', 'عدي ميعاد', 'فاتت')) {
    const team = has(t, 'فريق', 'الناس', 'مين', 'الموظفين')
    const list = late(team ? open : mine)
    if (!list.length) return { text: team ? 'مفيش حاجة متأخرة عند الفريق. برافو عليهم 👏' : 'مفيش ولا مهمة متأخرة عليكي 👏', suggestions: ['ملخص النهارده'] }
    if (team) {
      const by = new Map<string, number>()
      list.forEach((x) => by.set(x.assigneeId ?? '', (by.get(x.assigneeId ?? '') ?? 0) + 1))
      const lines = [...by].sort((a, b) => b[1] - a[1]).map(([u, n]) => `• ${d.users.find((x) => x.id === u)?.name ?? 'من غير مسؤول'}: ${n}`)
      return { text: `في ${tasksWord(list.length)} متأخرة:\n${lines.join('\n')}`, taskIds: list.slice(0, 6).map((x) => x.id) }
    }
    return { text: `عليكي ${tasksWord(list.length)} متأخرة، أقدمهم الأول:`, taskIds: list.slice(0, 6).map((x) => x.id) }
  }

  /* score */
  if (has(t, 'التزام', 'درجتي', 'درجه', 'تقييمي', 'سكور')) {
    const key = monthKey(now)
    const lines = myCompanies.map((c) => {
      const s = monthScore({ tasks: d.tasks, attendance: d.attendance, ratings: d.ratings }, d.me, c.id, key, now)
      return s.score === null ? `• ${c.short}: لسه مفيش بيانات كفاية الشهر ده` : `• ${c.short}: ${s.score} من 100`
    })
    return { text: `درجة التزامك الشهر ده:\n${lines.join('\n')}`, actions: [{ type: 'open', path: '/performance', label: 'تفاصيل الأداء' }] }
  }

  /* attendance */
  if (has(t, 'حضور', 'بصمه', 'وصلت', 'انصراف', 'مشيت', 'سجلت')) {
    const rec = d.attendance.filter((a) => a.userId === d.me && isToday(a.checkInAt))
    const txt = rec.length
      ? rec.map((a) => `سجلتي حضور ${d.companies.find((c) => c.id === a.companyId)?.short ?? ''} الساعة ${fmtTime(a.checkInAt)}${a.late ? ' (متأخر)' : ''}${a.checkOutAt ? `، وانصراف ${fmtTime(a.checkOutAt)}` : ''}`).join('\n')
      : 'لسه ما سجلتيش حضور النهارده.'
    return { text: txt, actions: [{ type: 'open', path: '/attendance', label: rec.length ? 'صفحة الحضور' : 'سجلي حضور' }] }
  }

  /* week */
  if (has(t, 'الاسبوع', 'الأسبوع', 'الجمعه دي')) {
    const end = new Date(now); end.setDate(end.getDate() + 7)
    const list = mine.filter((x) => x.dueAt && new Date(x.dueAt) <= end).sort(byDue)
    return list.length ? { text: `عليكي ${tasksWord(list.length)} لحد آخر الأسبوع:`, taskIds: list.slice(0, 8).map((x) => x.id) } : { text: 'الأسبوع فاضي من المهام المتسجلة عليكي.' }
  }

  /* find */
  const findM = t.match(/^(فين|دوري علي|دور علي|هاتي|ابحثي عن|ابحث عن|لاقيلي) (مهمه )?(.+)/)
  if (findM) {
    const task = matchTask(findM[3].split(/\s+/), visible)
    return task ? { text: `لقيتها: "${task.title}"، ${STATUS_LABEL[task.status]}${task.dueAt ? `، ميعادها ${whenLabel(new Date(task.dueAt), now)}` : ''}.`, taskIds: [task.id] } : { text: 'مش لاقياها. جربي كلمة تانية من اسمها.' }
  }

  /* brief */
  if (has(t, 'ملخص', 'عندي ايه', 'ورايا', 'النهارده', 'انهارده', 'يومي', 'اعمل ايه', 'ابدا بايه', 'ابدأ', 'اولوي', 'برنامج')) {
    const l = late(mine)
    const checked = d.attendance.some((a) => a.userId === d.me && isToday(a.checkInAt))
    const top = [...l, ...today.filter((x) => !l.includes(x))].sort((a, b) => PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority])
    const parts = [
      `${greet(now)} يا ${name}.`,
      today.length ? `النهارده عليكي ${tasksWord(today.length)}.` : 'مفيش مهام ميعادها النهارده.',
      l.length ? `وفي ${tasksWord(l.length)} متأخرة، دول أولى حاجة.` : 'ومفيش حاجة متأخرة 👏',
      checked ? '' : 'ومتنسيش تسجلي حضورك.',
      top[0] ? `لو هبدأ بحاجة: "${top[0].title}".` : '',
    ].filter(Boolean)
    return { text: parts.join(' '), taskIds: top.slice(0, 6).map((x) => x.id), actions: checked ? undefined : [{ type: 'open', path: '/attendance', label: 'سجلي حضور' }] }
  }

  /* chit-chat */
  if (/^(ازيك|ازيكي|اهلا|هاي|هلو|صباح|مساء|السلام)/.test(t)) return { text: `${greet(now)} يا ${name} 🌸 أقدر أساعدك في مهامك ومواعيدك. تحبي أبدأ بملخص النهارده؟`, suggestions: SUGGEST }
  if (/^(شكرا|متشكره|تسلمي|ميرسي|حبيبتي)/.test(t)) return { text: 'العفو، أنا هنا لو احتجتي حاجة 🌸' }
  if (has(t, 'بتعرف', 'تقدري تعملي', 'مساعده', 'ساعديني', 'ازاي استخدم')) return { text: 'أقدر:\n• أديكي ملخص يومك والمتأخر\n• أضيف مهمة بالكلام: "ضيفي اجتماع مع سارة بكرة الساعة 11"\n• أعلّم مهمة خلصت: "خلصت تقرير المبيعات"\n• أقولك درجة التزامك وحضورك\n• أدور على مهمة: "فين مهمة العقد"', suggestions: SUGGEST }

  return { text: 'معلش مش فاهمة قوي 🙈 جربي حاجة من دول:', suggestions: SUGGEST, unsure: true }
}

export const tasksWord = (n: number) => (n === 1 ? 'مهمة واحدة' : n === 2 ? 'مهمتين' : n <= 10 ? `${n} مهام` : `${n} مهمة`)

const byDue = (a: Task, b: Task) => (a.dueAt ?? '9').localeCompare(b.dueAt ?? '9')

function endOfWorkday(now: Date, c: Company) {
  const [h, m] = (c.workEnd ?? '17:00').split(':').map(Number)
  const d = new Date(now)
  d.setHours(h, m || 0, 0, 0)
  if (d <= now) d.setDate(d.getDate() + 1)
  return d
}

const greet = (now: Date) => (now.getHours() < 12 ? 'صباح الخير' : 'مساء الخير')

export function whenLabel(d: Date, now = new Date()) {
  const day = new Date(d); day.setHours(0, 0, 0, 0)
  const base = new Date(now); base.setHours(0, 0, 0, 0)
  const diff = Math.round((day.getTime() - base.getTime()) / 86400000)
  const dayTxt = diff === 0 ? 'النهارده' : diff === 1 ? 'بكرة' : diff === 2 ? 'بعد بكرة' : diff === -1 ? 'امبارح' : d.toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })
  return `${dayTxt} الساعة ${fmtTime(d)}`
}

/** Compact snapshot sent to the online assistant (only what this person can see) */
export function assistantContext(d: AssistantData, now = new Date()) {
  const visible = d.tasks.filter((x) => canSeeTask(d, d.me, x))
  const recent = visible.filter((x) => x.status !== 'done' || (x.completedAt && now.getTime() - new Date(x.completedAt).getTime() < 14 * 86400000))
  const myCompanies = d.companies.filter((c) => d.memberships.some((m) => m.userId === d.me && m.companyId === c.id))
  return {
    now: now.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    me: { id: d.me, name: d.users.find((u) => u.id === d.me)?.name },
    companies: myCompanies.map((c) => ({ id: c.id, name: c.name, short: c.short, myRole: d.memberships.find((m) => m.userId === d.me && m.companyId === c.id)?.role })),
    people: d.users
      .filter((u) => d.memberships.some((m) => m.userId === u.id && myCompanies.some((c) => c.id === m.companyId)))
      .map((u) => ({ id: u.id, name: u.name, companies: d.memberships.filter((m) => m.userId === u.id).map((m) => m.companyId) })),
    tasks: recent.slice(0, 300).map((x) => ({ id: x.id, title: x.title, status: x.status, priority: x.priority, dueAt: x.dueAt, assigneeId: x.assigneeId, companyId: x.companyId })),
    attendanceToday: d.attendance.filter((a) => a.userId === d.me && isToday(a.checkInAt)).map((a) => ({ companyId: a.companyId, checkInAt: a.checkInAt, late: a.late, checkOutAt: a.checkOutAt })),
  }
}
