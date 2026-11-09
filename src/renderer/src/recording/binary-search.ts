/** The first index where `holds` is true, for a test that turns true once and stays true; `length` when it never does. */
export function firstIndexWhere(length: number, holds: (index: number) => boolean): number {
  let low = 0
  let high = length
  while (low < high) {
    const middle = (low + high) >> 1
    if (holds(middle)) high = middle
    else low = middle + 1
  }
  return low
}
