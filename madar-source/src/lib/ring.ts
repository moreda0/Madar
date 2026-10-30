// رنة مدار: Madar's own funny notification sounds (files in public/sounds):
//  assigned = a screaming rubber chicken (new task) · reminder = a duck quacking · overdue = a sad trombone
// The chicken, duck and trombone were synthesized for Madar, so they sound like nothing else on the phone.
import type { NotificationKind } from './types'

const KEY = 'madar-ring'
export type RingStyle = 'assigned' | 'reminder' | 'overdue' | 'soft'

const FILE: Record<RingStyle, string> = { assigned: 'new-task', reminder: 'reminder', overdue: 'overdue', soft: 'reminder' }

export const ringOn = () => { try { return localStorage.getItem(KEY) !== 'off' } catch { return true } }
export const setRingOn = (on: boolean) => { try { localStorage.setItem(KEY, on ? 'on' : 'off') } catch { /* private mode */ } }

let ctx: AudioContext | null = null
function audio() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

// browsers only allow sound after the first tap, so wake the audio on it
if (typeof window !== 'undefined') {
  const unlock = () => { audio(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock) }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
}

// decoded once, then every ring starts instantly
const buffers = new Map<string, Promise<AudioBuffer | null>>()
function load(c: AudioContext, name: string) {
  if (!buffers.has(name))
    buffers.set(name, fetch(`./sounds/${name}.mp3`).then((r) => r.arrayBuffer()).then((b) => c.decodeAudioData(b)).catch(() => { buffers.delete(name); return null }))
  return buffers.get(name)!
}

export async function playRing(style: RingStyle = 'assigned', force = false) {
  if (!force && !ringOn()) return
  const c = audio()
  if (!c) return
  const buf = await load(c, FILE[style])
  if (!buf) return
  const src = c.createBufferSource()
  src.buffer = buf
  src.connect(c.destination)
  src.start()
}

export const ringFor = (kind: NotificationKind): RingStyle =>
  kind === 'assigned' ? 'assigned' : kind === 'reminder' ? 'reminder' : kind === 'overdue' ? 'overdue' : 'soft'
