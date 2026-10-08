/** mulberry32 —— 确定性注入式 PRNG，状态为一个 uint32。 */

export function nextRandom(state: number): { value: number; state: number } {
  let t = (state + 0x6d2b79f5) | 0;
  let r = Math.imul(t ^ (t >>> 15), 1 | t);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  return { value: ((r ^ (r >>> 14)) >>> 0) / 4294967296, state: t >>> 0 };
}

/** 返回 [1, sides] 的整数。 */
export function rollDie(state: number, sides = 6): { value: number; state: number } {
  const { value, state: s } = nextRandom(state);
  return { value: Math.floor(value * sides) + 1, state: s };
}
