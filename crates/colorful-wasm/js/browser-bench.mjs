// Parity and measurements for colorful_wasm.wasm inside real browser engines.
//
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core \
//   [CHROMIUM_PATH=/path/to/chrome] node crates/colorful-wasm/js/browser-bench.mjs
//
// The page is served from an in-memory route (https://colorful.test/) so the
// module loads through fetch + WebAssembly.instantiateStreaming exactly as a
// static site would. For each engine Playwright can launch it checks that the
// browser's `colorful ir` bytes equal the native CLI's for the synthetic set,
// the CLI fixtures and a ~200 KB document, then measures startup, latency and
// memory. Engines whose browser binary is not installed are reported, not
// failed. Measurement tooling, not a CI gate.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SYNTHETIC, largeDocument } from './samples.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const wasmPath =
  process.env.COLORFUL_WASM || join(root, 'target/wasm32-unknown-unknown/release/colorful_wasm.wasm');
const bin = process.env.COLORFUL_BIN || join(root, 'target/release/colorful');
const core = process.env.PLAYWRIGHT_CORE;
if (!core) throw new Error('set PLAYWRIGHT_CORE to a playwright-core package directory');
const playwright = createRequire(import.meta.url)(core);

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const nativeIr = (text) => {
  const run = spawnSync(bin, ['ir', '-'], { input: Buffer.from(text, 'utf8'), maxBuffer: 1 << 30 });
  if (run.status !== 0) throw new Error(run.stderr.toString());
  return sha(run.stdout);
};

const fixtures = join(root, 'crates/colorful-cli/fixtures');
const cases = { ...SYNTHETIC };
for (const name of readdirSync(fixtures).filter((n) => n.endsWith('.txt'))) {
  cases[`fixture:${name}`] = readFileSync(join(fixtures, name), 'utf8');
}
cases.large200k = largeDocument();
const expected = Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, nativeIr(v)]));

const files = {
  '/': ['text/html', '<!doctype html><meta charset="utf-8"><title>colorful wasm bench</title>'],
  '/colorful-wasm.mjs': ['text/javascript', readFileSync(join(here, 'colorful-wasm.mjs'))],
  '/colorful_wasm.wasm': ['application/wasm', readFileSync(wasmPath)],
};

async function inPage(cases) {
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const hex = async (s) =>
    [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))]
      .map((b) => b.toString(16).padStart(2, '0')).join('');
  const { instantiate } = await import('/colorful-wasm.mjs');
  let t = performance.now();
  const colorful = await instantiate(fetch('/colorful_wasm.wasm', { cache: 'no-store' }));
  const loadMs = performance.now() - t;
  colorful.ir('The cat sat.');
  const coldFirstResultMs = performance.now() - t;
  const startups = [];
  for (let i = 0; i < 10; i += 1) {
    t = performance.now();
    await instantiate(fetch('/colorful_wasm.wasm', { cache: 'no-store' }));
    startups.push(performance.now() - t);
  }
  const hashes = {};
  for (const [name, text] of Object.entries(cases)) {
    if (name !== 'large200k') hashes[name] = await hex(colorful.ir(text));
  }
  const big = await instantiate(fetch('/colorful_wasm.wasm', { cache: 'no-store' }));
  const initialMemoryBytes = big.memoryBytes();
  const heap0 = performance.memory ? performance.memory.usedJSHeapSize : null;
  t = performance.now();
  const out = big.ir(cases.large200k);
  const firstAnalysisMs = performance.now() - t;
  const peakMemoryBytes = big.memoryBytes();
  const heapAfter = performance.memory ? performance.memory.usedJSHeapSize : null;
  hashes.large200k = await hex(out);
  const warm = [];
  for (let i = 0; i < 10; i += 1) {
    t = performance.now();
    big.ir(cases.large200k);
    warm.push(performance.now() - t);
  }
  return {
    userAgent: navigator.userAgent,
    firstLoadMs: loadMs,
    coldFirstResultMs,
    fetchInstantiateMsMedian: median(startups),
    initialMemoryBytes,
    firstAnalysisMs,
    warmAnalysisMsMedian: median(warm),
    peakMemoryBytes,
    memoryAfter11RunsBytes: big.memoryBytes(),
    // Chromium only (needs --enable-precise-memory-info); the JS string result.
    jsHeapDeltaBytes: heap0 === null ? null : heapAfter - heap0,
    hashes,
  };
}

const engines = [
  ['chromium', { executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--enable-precise-memory-info'] }],
  ['webkit', {}],
  ['firefox', {}],
];
const report = {};
for (const [name, options] of engines) {
  let browser;
  try {
    browser = await playwright[name].launch({ headless: true, ...options });
  } catch (err) {
    report[name] = { unavailable: String(err.message).split('\n')[0] };
    continue;
  }
  try {
    const page = await browser.newPage();
    await page.route('https://colorful.test/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      const file = files[path];
      return file
        ? route.fulfill({ status: 200, contentType: file[0], body: file[1] })
        : route.fulfill({ status: 404, body: '' });
    });
    await page.goto('https://colorful.test/');
    const measured = await page.evaluate(inPage, cases);
    const mismatched = Object.keys(expected).filter((k) => measured.hashes[k] !== expected[k]);
    delete measured.hashes;
    report[name] = { version: browser.version(), parityCases: Object.keys(expected).length, mismatched, ...measured };
  } finally {
    await browser.close();
  }
}
console.log(JSON.stringify(report, null, 2));
if (Object.values(report).some((r) => r.mismatched && r.mismatched.length)) process.exitCode = 1;
