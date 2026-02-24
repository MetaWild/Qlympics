export function nextRandom(seed: number): [number, number] {
  const next = (seed * 1664525 + 1013904223) >>> 0;
  return [next / 4294967296, next];
}
