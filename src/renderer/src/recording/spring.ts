/** `omega` is per ms. */
export interface Spring { omega: number; damping: number }

const SETTLED_SHARE = 0.02

/** ω × the time after which a step from rest stays within SETTLED_SHARE of its move: 5.834 critically damped, about 3.76 at 0.8. */
function unitSettleTime(damping: number): number {
  const unit: Spring = { omega: 1, damping }
  const errorAt = (x: number) => Math.abs(1 - springStep(0, 0, 1, unit, x)[0])
  const halfSwing = Math.PI / Math.sqrt(1 - damping ** 2)
  const nextPeakAfter = (x: number) => (damping === 1 ? 0 : Math.exp(-damping * halfSwing * (Math.floor(x / halfSwing) + 1)))
  const settledFrom = (x: number) => errorAt(x) <= SETTLED_SHARE && nextPeakAfter(x) <= SETTLED_SHARE
  let unsettled = 0
  let settled = 1
  while (!settledFrom(settled)) [unsettled, settled] = [settled, settled * 2]
  for (let i = 0; i < 60; i++) {
    const middle = (unsettled + settled) / 2
    if (settledFrom(middle)) settled = middle
    else unsettled = middle
  }
  return settled
}

export function springFor(settleMs: number, damping: number): Spring {
  if (!(damping > 0 && damping <= 1)) throw new RangeError(`Spring damping must be above 0 and at most 1, not ${damping}`)
  return { omega: unitSettleTime(damping) / settleMs, damping }
}

/** Velocity is per ms. Exact, so one long step lands where many short ones do. */
export function springStep(value: number, velocity: number, goal: number, spring: Spring, dtMs: number): [number, number] {
  const { omega, damping } = spring
  const offset = value - goal
  if (damping === 1) {
    const decay = Math.exp(-omega * dtMs)
    const drift = velocity + omega * offset
    return [goal + (offset + drift * dtMs) * decay, (velocity - omega * drift * dtMs) * decay]
  }
  const decayRate = damping * omega
  const ringRate = omega * Math.sqrt(1 - damping ** 2)
  const decay = Math.exp(-decayRate * dtMs)
  const cos = Math.cos(ringRate * dtMs)
  const sin = Math.sin(ringRate * dtMs)
  const sineShare = (velocity + decayRate * offset) / ringRate
  return [
    goal + decay * (offset * cos + sineShare * sin),
    decay * ((sineShare * ringRate - decayRate * offset) * cos - (offset * ringRate + decayRate * sineShare) * sin)
  ]
}
