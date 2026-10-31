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
export const SOUND_V = 3
const buffers = new Map<string, Promise<AudioBuffer | null>>()
function load(c: AudioContext, name: string) {
  if (!buffers.has(name))
    buffers.set(name, fetch(`./sounds/${name}.mp3?v=${SOUND_V}`, { cache: 'reload' }).then((r) => r.arrayBuffer()).then((b) => c.decodeAudioData(b)).catch(() => { buffers.delete(name); return null }))
  return buffers.get(name)!
}

let lastRing = 0
export async function playRing(style: RingStyle = 'assigned', force = false) {
  if (!force && !ringOn()) return
  // the push and the synced notification can both ask for the same ring: play it once
  if (!force && Date.now() - lastRing < 4000) return
  lastRing = Date.now()
  const c = audio()
  if (!c) return
  const buf = await load(c, FILE[style])
  if (!buf) return
  // drive the sound hard into a soft clipper: as loud as the speakers allow, a bit gritty (it's meant to be funny)
  const drive = c.createGain()
  drive.gain.value = DRIVE
  const clip = c.createWaveShaper()
  clip.curve = clipCurve()
  clip.oversample = '4x'
  drive.connect(clip).connect(c.destination)
  // play it more than once so it can't be missed: chicken x2, duck x3, trombone x2
  const times = style === 'reminder' || style === 'soft' ? 3 : 2
  for (let i = 0; i < times; i++) {
    const src = c.createBufferSource()
    src.buffer = buf
    src.connect(drive)
    src.start(c.currentTime + i * (buf.duration + 0.12))
  }
}

const DRIVE = 2.6
let curve: Float32Array<ArrayBuffer> | null = null
function clipCurve() {
  if (!curve) {
    curve = new Float32Array(2048)
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1
      curve[i] = Math.tanh(x * 1.5) / Math.tanh(1.5)
    }
  }
  return curve
}

export const ringFor = (kind: NotificationKind): RingStyle =>
  kind === 'assigned' ? 'assigned' : kind === 'reminder' ? 'reminder' : kind === 'overdue' ? 'overdue' : 'soft'

// a push that lands while Madar is open (even in a background tab) rings with Madar's own sound too
if (typeof navigator !== 'undefined' && navigator.serviceWorker)
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'ring') playRing(ringFor(e.data.kind))
  })
