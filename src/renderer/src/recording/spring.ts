/** A damped spring pulling a value towards a goal. `omega` is its natural frequency, per ms. */
export interface Spring { omega: number; damping: number }

const SETTLED_SHARE = 0.02
/** ω × settle time for a critical spring: (1 + x)·e^(−x) = 0.02 at x = 5.834. */
const CRITICAL_OMEGA_TIMES_SETTLE = 5.834

/** A step from rest stays within 2% of its move from `settleMs` on. */
export function springFor(settleMs: number, damping: number): Spring {
  if (!(damping > 0 && damping <= 1)) throw new RangeError(`Spring damping must be above 0 and at most 1, not ${damping}`)
  if (damping === 1) return { omega: CRITICAL_OMEGA_TIMES_SETTLE / settleMs, damping }
  return { omega: Math.log(1 / (SETTLED_SHARE * Math.sqrt(1 - damping ** 2))) / (damping * settleMs), damping }
}

/** The value and its velocity (per ms) after `dtMs`, solved exactly: one long step lands where many short ones do. */
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
