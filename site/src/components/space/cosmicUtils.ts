export function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function hashSeed(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h << 5) - h + id.charCodeAt(i);
  return Math.abs(h) || 1;
}

export function fillPositions(
  rand: () => number,
  count: number,
  spread: [number, number, number],
) {
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = (rand() - 0.5) * spread[0];
    arr[i * 3 + 1] = (rand() - 0.5) * spread[1];
    arr[i * 3 + 2] = (rand() - 0.5) * spread[2];
  }
  return arr;
}

/** データヘリックス — 螺旋状の粒子配置 */
export function fillHelixStream(rand: () => number, count: number) {
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 6 + rand() * 0.4;
    const r = 2.2 + rand() * 2.8;
    arr[i * 3] = Math.cos(t) * r;
    arr[i * 3 + 1] = (i / count - 0.5) * 10;
    arr[i * 3 + 2] = Math.sin(t) * r;
  }
  return arr;
}

/** ワープトンネル用 — 円筒状に分布 */
export function fillWarpStream(rand: () => number, count: number) {
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const r = 0.4 + rand() * 5.5;
    arr[i * 3] = Math.cos(a) * r;
    arr[i * 3 + 1] = (rand() - 0.5) * 3.5;
    arr[i * 3 + 2] = -10 + rand() * 14;
  }
  return arr;
}
