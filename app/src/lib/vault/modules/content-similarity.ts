/** Git-style span accounting, implemented independently of Git's source code. */
export interface ContentSignature {
  size: number;
  spans: Array<[number, number]>;
}

// Conservative initial Carbon policy; scores are not probabilities.
export const RENAME_SIMILARITY = 0.85;
export const RENAME_MARGIN = 0.10;
export const MIN_INEXACT_BYTES = 80;

export function contentSignature(body: string): ContentSignature {
  const bytes = new TextEncoder().encode(body);
  const counts = new Map<number, number>();
  let first = 0, second = 0, length = 0;
  const finish = () => {
    const hash = ((first + Math.imul(second, 97)) >>> 0) % 107927;
    counts.set(hash, (counts.get(hash) ?? 0) + length);
    first = second = length = 0;
  };
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte === 13 && bytes[i + 1] === 10) continue;
    const previous = first;
    first = (((first << 7) ^ (second >>> 25)) + byte) >>> 0;
    second = ((second << 7) ^ (previous >>> 25)) >>> 0;
    length++;
    if (byte === 10 || length === 64) finish();
  }
  if (length) finish();
  return { size: bytes.length, spans: [...counts].sort((a, b) => a[0] - b[0]) };
}

export function contentSimilarity(a: ContentSignature, b: ContentSignature): number {
  const size = Math.max(a.size, b.size);
  if (!size) return 0;
  let common = 0, i = 0, j = 0;
  while (i < a.spans.length && j < b.spans.length) {
    const left = a.spans[i], right = b.spans[j];
    if (left[0] === right[0]) { common += Math.min(left[1], right[1]); i++; j++; }
    else if (left[0] < right[0]) i++;
    else j++;
  }
  return common / size;
}
