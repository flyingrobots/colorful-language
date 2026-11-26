// Shared inputs for the parity test and benchmarks: synthetic texts and a
// ~200 KB document built from a Git-tracked fixture. No external prose.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export const SYNTHETIC = {
  empty: '',
  whitespace: ' \n\t\n  ',
  sentence: 'The quick brown fox jumps over the lazy dog.',
  crlf: 'First line.\r\nSecond line, with a comma.\r\n\r\nNew paragraph.',
  quotes: '"Straight," she said. “Curly,” he replied — ‘nested’ too.',
  numbers: 'In 1999, 3.14 and 1,000,000 and 42% and #7 and 2nd place.',
  unicode: 'Café naïve coöperate Über æsthetic résumé.',
  combining: 'Café and naïve use combining marks.',
  emoji: 'Ship it \u{1F680} now \u{1F469}‍\u{1F4BB} or later \u{1F1FA}\u{1F1F8}.',
  cjk: '漢字とかな English mixed 中文.',
  rtl: 'مرحبا and שלום mixed with English.',
  markdown: '# Heading\n\n- item *one*\n- item `two`\n\n```\ncode block\n```\n\n[link](https://example.com) text.',
  contractions: "Don't, can't, won't, it's, they're, y'all, rock 'n' roll.",
  proper: 'Alice met Bob in Paris on Monday; NASA and the U.S.A. agreed.',
  longWord: 'x'.repeat(5000) + ' end.',
  controls: 'Bell\u0007 and NUL\u0000 and form\u000c feed.',
  nbsp: 'non breaking thin​zero width.',
  noFinalPunct: 'a b c d e f g',
};

/** bench-corpus.txt repeated and cut to `target` UTF-8 bytes (ASCII corpus). */
export function largeDocument(target = 200_000) {
  const corpus = readFileSync(join(root, 'crates/colorful-cli/fixtures/bench-corpus.txt'), 'utf8');
  return corpus.repeat(Math.ceil(target / Buffer.byteLength(corpus))).slice(0, target);
}
