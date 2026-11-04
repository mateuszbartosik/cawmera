import '@fontsource-variable/inter'
import './overlay.css'

interface CountdownBridge {
  onTick(listener: (remaining: number) => void): void
  cancel(): void
}

declare global {
  interface Window {
    countdown?: CountdownBridge
  }
}

const RING = 2 * Math.PI * 60
const params = new URLSearchParams(location.search)
const total = Math.max(1, Number(params.get('seconds')) || 3)
// The ring takes the shot's light colour.
const color = params.get('color') ?? ''
if (/^#[0-9a-f]{6}$/i.test(color)) document.documentElement.style.setProperty('--glow', color)

const number = document.querySelector<HTMLElement>('.number')!
const progress = document.querySelector<SVGCircleElement>('.progress')!
const cancel = document.querySelector<HTMLButtonElement>('.cancel')!

progress.style.strokeDasharray = String(RING)

function show(remaining: number) {
  number.textContent = String(remaining)
  number.classList.remove('pop')
  void number.offsetWidth // restart the animation
  number.classList.add('pop')
  // The ring empties smoothly over the coming second.
  progress.style.strokeDashoffset = String(RING * (1 - Math.max(0, remaining - 1) / total))
}

show(total)
window.countdown?.onTick(show)

cancel.addEventListener('click', () => window.countdown?.cancel())
