// Byte parity: colorful_wasm.wasm against the native `colorful ir` CLI.
//
//   cargo build --locked --release -p colorful-cli
//   cargo build --locked --release -p colorful-wasm --target wasm32-unknown-unknown
//   node --test crates/colorful-wasm/js/parity.test.mjs
//
// COLORFUL_BIN and COLORFUL_WASM override the default artifact paths.
// Every input is synthetic or a Git-tracked repository file.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ColorfulWasmError, instantiate } from './colorful-wasm.mjs';
import { SYNTHETIC, largeDocument } from './samples.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const bin = process.env.COLORFUL_BIN || join(root, 'target/release/colorful');
const wasmPath =
  process.env.COLORFUL_WASM || join(root, 'target/wasm32-unknown-unknown/release/colorful_wasm.wasm');
const colorful = await instantiate(readFileSync(wasmPath));

function cli(args, input) {
  const run = spawnSync(bin, args, { input, maxBuffer: 1 << 30 });
  if (run.error) throw run.error;
  return run;
}

/** `colorful ir -` (the form Reader runs) must equal the module, byte for byte. */
function assertStdinParity(bytes) {
  const native = cli(['ir', '-'], bytes);
  assert.equal(native.status, 0, native.stderr.toString());
  const wasm = colorful.irBytes(bytes);
  assert.equal(Buffer.compare(native.stdout, Buffer.from(wasm)), 0);
}


test('synthetic texts are byte-identical to `colorful ir -`', () => {
  for (const [name, text] of Object.entries(SYNTHETIC)) {
    assertStdinParity(Buffer.from(text, 'utf8'), name);
  }
});

const tracked = execFileSync('git', ['ls-files', '-z', '*.md', '*.txt'], { cwd: root })
  .toString()
  .split('\0')
  .filter(Boolean);

test(`all ${tracked.length} tracked .md/.txt files are byte-identical`, () => {
  assert.ok(tracked.length > 0);
  for (const path of tracked) {
    assertStdinParity(readFileSync(join(root, path)));
  }
});

test('a ~200 KB document is byte-identical', () => {
  const doc = Buffer.from(largeDocument(), 'utf8');
  assert.ok(doc.length >= 200_000);
  assertStdinParity(doc);
});

test('`colorful ir FILE` unit ids are reproduced', () => {
  const path = 'crates/colorful-cli/fixtures/language-showcase.txt';
  const native = execFileSync(bin, ['ir', path], { cwd: root });
  const wasm = colorful.irBytes(readFileSync(join(root, path)), path);
  assert.equal(Buffer.compare(native, Buffer.from(wasm)), 0);
});

test('invalid UTF-8 fails the same way, with no output', () => {
  const bytes = readFileSync(join(root, 'crates/colorful-cli/fixtures/invalid-utf8.bin'));
  const native = cli(['ir', '-'], bytes);
  assert.notEqual(native.status, 0);
  assert.equal(native.stdout.length, 0);
  assert.throws(
    () => colorful.irBytes(bytes),
    (err) => err instanceof ColorfulWasmError && err.code === 'E_INVALID_UTF8' &&
      `${err.message}`.startsWith(native.stderr.toString().trim()),
  );
});

test('version matches `colorful --version`', () => {
  assert.equal(colorful.version(), execFileSync(bin, ['--version']).toString());
});
