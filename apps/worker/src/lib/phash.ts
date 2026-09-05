/**
 * Perceptual hash (DCT / pHash) over a 32x32 greyscale frame.
 *
 * Why perceptual rather than cryptographic: sha256 only catches a byte-identical
 * re-upload. Any re-encode, resize or requantisation changes every byte while
 * leaving the image perceptually identical. The blocked-hash check at ingest has
 * to survive that, so it runs against this.
 *
 * Method: DCT-II of the 32x32 luma plane, keep the low-frequency 8x8 corner,
 * drop the DC term (it only encodes overall brightness), threshold the
 * remaining 63 coefficients at their median. The result is a 64-bit hash where
 * Hamming distance approximates perceptual distance.
 */

const SIZE = 32;
const KEEP = 8;

/** Precomputed DCT-II basis. Built once; the inner loop runs per frame. */
const COS = (() => {
  const table = new Float64Array(SIZE * SIZE);
  for (let u = 0; u < SIZE; u++) {
    for (let x = 0; x < SIZE; x++) {
      table[u * SIZE + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * SIZE));
    }
  }
  return table;
})();

function dct2d(input: Float64Array): Float64Array {
  // Separable transform: rows, then columns. O(n^3) at n=32 is trivial here and
  // avoids pulling in an FFT dependency.
  const rows = new Float64Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let u = 0; u < SIZE; u++) {
      let sum = 0;
      for (let x = 0; x < SIZE; x++) sum += input[y * SIZE + x]! * COS[u * SIZE + x]!;
      rows[y * SIZE + u] = sum * (u === 0 ? Math.SQRT1_2 : 1);
    }
  }
  const out = new Float64Array(SIZE * SIZE);
  for (let u = 0; u < SIZE; u++) {
    for (let v = 0; v < SIZE; v++) {
      let sum = 0;
      for (let y = 0; y < SIZE; y++) sum += rows[y * SIZE + u]! * COS[v * SIZE + y]!;
      out[v * SIZE + u] = sum * (v === 0 ? Math.SQRT1_2 : 1);
    }
  }
  return out;
}

/** `frame` must be exactly 32*32 bytes of 8-bit greyscale. */
export function phashFromGrayFrame(frame: Buffer): string {
  if (frame.length < SIZE * SIZE) {
    throw new Error(`phash: expected ${SIZE * SIZE} bytes, got ${frame.length}`);
  }
  const input = new Float64Array(SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) input[i] = frame[i]!;

  const dct = dct2d(input);

  // Low-frequency corner, DC term excluded.
  const coefficients: number[] = [];
  for (let v = 0; v < KEEP; v++) {
    for (let u = 0; u < KEEP; u++) {
      if (u === 0 && v === 0) continue;
      coefficients.push(dct[v * SIZE + u]!);
    }
  }

  const sorted = [...coefficients].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;

  // 63 coefficients + a constant leading bit, so the hash is a stable 64 bits
  // and always renders as 16 hex characters.
  let bits = "1";
  for (const c of coefficients) bits += c > median ? "1" : "0";

  let hex = "";
  for (let i = 0; i < 64; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Number.MAX_SAFE_INTEGER;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (x) {
      distance += x & 1;
      x >>= 1;
    }
  }
  return distance;
}

/**
 * Distance at or below this counts as a match. 10/64 is deliberately loose: at
 * ingest a false positive costs one manual review, a false negative costs
 * considerably more.
 */
export const PHASH_MATCH_THRESHOLD = 10;
