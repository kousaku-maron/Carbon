import { expect, it } from 'vitest';
import { contentSignature, contentSimilarity } from './content-similarity';
const similarity = (a: string, b: string) => contentSimilarity(contentSignature(a), contentSignature(b));
it('uses common span bytes divided by the larger size', () => {
  expect(similarity('abc\ndef\n', 'abc\nxyz\n')).toBe(0.5);
  expect(similarity('abc\n', 'abc\ndef\n')).toBe(0.5);
});
it('counts repeated spans without reusing bytes', () => {
  expect(similarity('abc\nabc\n', 'abc\nxyz\n')).toBe(0.5);
});
it('preserves accounting when whole lines change position', () => {
  expect(similarity('abc\ndef\n', 'def\nabc\n')).toBe(1);
});
it('splits UTF-8 bytes at newline or 64 bytes, including the trailing span', () => {
  const signature = contentSignature('あ'.repeat(30));
  expect(signature.size).toBe(90);
  expect(signature.spans.map((span) => span[1]).sort()).toEqual([26, 64]);
});
it('normalizes CRLF spans but uses original byte sizes like Git', () => {
  expect(similarity('abc\r\n', 'abc\n')).toBe(4 / 5);
  expect(similarity('', '')).toBe(0);
});
