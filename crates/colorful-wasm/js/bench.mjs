// Size, startup, latency and memory for colorful_wasm.wasm in Node.
//
//   node crates/colorful-wasm/js/bench.mjs [--json]
//
// Inputs: the release .wasm, the release CLI (for a native comparison) and
// a ~200 KB document made by repeating crates/colorful-cli/fixtures/bench-corpus.txt.
// This is measurement tooling, not a CI gate: numbers depend on the machine.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

import { instantiate } from './colorful-wasm.mjs';
import { largeDocument } from './samples.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const wasmPath =
  process.env.COLORFUL_WASM || join(root, 'target/wasm32-unknown-unknown/release/colorful_wasm.wasm');
const bin = process.env.COLORFUL_BIN || join(root, 'target/release/colorful');


const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
async function timed(fn) {
  const t = performance.now();
  const value = await fn();
  return [performance.now() - t, value];
}

const bytes = readFileSync(wasmPath);
const doc = largeDocument();
const result = {
  node: process.version,
  wasmBytes: bytes.length,
  gzip9Bytes: gzipSync(bytes, { level: 9 }).length,
  brotli11Bytes: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
  documentBytes: Buffer.byteLength(doc),
};

// Measured first: V8 compiles lazily and caches modules per process, so only
// the first instantiation shows the cost of reaching a first result.
{
  const [ms] = await timed(async () => (await instantiate(bytes)).ir('The cat sat.'));
  result.coldBytesToFirstResultMs = ms;
}

const compile = [];
const inst = [];
for (let i = 0; i < 20; i += 1) {
  const [c, module] = await timed(() => WebAssembly.compile(bytes));
  const [n] = await timed(() => instantiate(module));
  compile.push(c);
  inst.push(n);
}
result.compileMsFirst = compile[0];
result.compileMsMedian = median(compile);
result.instantiateMsFirst = inst[0];
result.instantiateMsMedian = median(inst);

const fresh = await instantiate(bytes);
result.initialMemoryBytes = fresh.memoryBytes();
const [first, out] = await timed(() => fresh.ir(doc));
result.firstAnalysisMs = first;
result.peakMemoryBytes = fresh.memoryBytes(); // linear memory never shrinks
result.irOutputBytes = Buffer.byteLength(out);
const warm = [];
for (let i = 0; i < 10; i += 1) warm.push((await timed(() => fresh.ir(doc)))[0]);
result.warmAnalysisMsMedian = median(warm);
result.memoryAfter11RunsBytes = fresh.memoryBytes();
result.processMaxRssBytes = process.resourceUsage().maxRSS * 1024;

const native = [];
for (let i = 0; i < 5; i += 1) {
  const t = performance.now();
  const run = spawnSync(bin, ['ir', '-'], { input: doc, maxBuffer: 1 << 30 });
  native.push(performance.now() - t);
  if (run.status !== 0) throw new Error(run.stderr.toString());
}
result.cliSpawnAndAnalysisMsMedian = median(native);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  for (const [k, v] of Object.entries(result)) console.log(`${k.padEnd(30)} ${typeof v === 'number' ? +v.toFixed(2) : v}`);
}
