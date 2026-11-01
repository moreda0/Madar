import { useEffect, useState } from 'react'

/** Madar's 3D mascot: drops in clapping, with confetti whenever a notification rings. Tap to dismiss. */
export const showMascot = () => window.dispatchEvent(new Event('madar-mascot'))

const CONFETTI = ['#22d3ee', '#a78bfa', '#fbbf24', '#34d399', '#f472b6']

export function Mascot() {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const on = () => setShown(Date.now())
    window.addEventListener('madar-mascot', on)
    return () => window.removeEventListener('madar-mascot', on)
  }, [])
  useEffect(() => {
    if (!shown) return
    const t = setTimeout(() => setShown(0), 6000)
    return () => clearTimeout(t)
  }, [shown])
  if (!shown) return null
  return (
    <div className="mascot-layer" key={shown} onPointerDown={() => setShown(0)} role="presentation">
      {Array.from({ length: 28 }, (_, i) => (
        <i key={i} className="confetti" style={{ left: `${(i * 37) % 100}%`, background: CONFETTI[i % CONFETTI.length], animationDelay: `${0.6 + (i % 7) * 0.12}s`, ['--drift' as string]: `${((i * 53) % 120) - 60}px` }} />
      ))}
      <div className="mascot">
        <div className="fig">
          {/* cut from her 3D figure: the arms swing in on their shoulders so he really claps, the head bobbles */}
          <img src="./mascot/body.webp" alt="" draggable={false} />
          <img className="rarm" src="./mascot/rarm.webp" alt="" draggable={false} />
          <img className="larm" src="./mascot/larm.webp" alt="" draggable={false} />
          <img className="head" src="./mascot/head.webp" alt="" draggable={false} />
        </div>
      </div>
    </div>
  )
}
