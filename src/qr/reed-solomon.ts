// Reed-Solomon over GF(256) with the QR primitive polynomial x^8+x^4+x^3+x^2+1 (0x11D).

const EXP: number[] = new Array(512);
const LOG: number[] = new Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/** Generator polynomial (x - a^0)...(x - a^(degree-1)), highest degree first, monic. */
export function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Remainder of data(x) * x^ecLength divided by the generator: the EC codewords. */
export function rsEncode(data: number[], ecLength: number): number[] {
  const gen = rsGenerator(ecLength);
  const rem: number[] = new Array(ecLength).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem.shift()!;
    rem.push(0);
    for (let i = 0; i < ecLength; i++) rem[i] ^= gfMul(gen[i + 1], factor);
  }
  return rem;
}
