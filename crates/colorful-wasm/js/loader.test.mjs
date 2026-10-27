// Loader contract tests against small hand-assembled WebAssembly modules that
// implement the C-ABI v1 exports. They need no build:
//
//   node --test crates/colorful-wasm/js/loader.test.mjs
//
// The fixtures echo `unit_id ‖ document` back as the output, so a test can
// place either buffer anywhere in (or outside) linear memory, or make
// `colorful_ir` trap, without depending on the real allocator.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ColorfulWasmError, instantiate } from './colorful-wasm.mjs';

const PAGE = 65536;
const I32 = 0x7f;
const OP = {
  end: 0x0b, unreachable: 0x00, i32Const: 0x41, localGet: 0x20, globalGet: 0x23, globalSet: 0x24,
  i32Add: 0x6a, i32Sub: 0x6b, i32Load8U: 0x2d,
};

function uleb(n) {
  const out = [];
  do {
    let byte = n & 0x7f;
    n = Math.floor(n / 128);
    if (n !== 0) byte |= 0x80;
    out.push(byte);
  } while (n !== 0);
  return out;
}

function sleb(n) {
  const out = [];
  for (;;) {
    const byte = n & 0x7f;
    n >>= 7;
    if ((n === 0 && (byte & 0x40) === 0) || (n === -1 && (byte & 0x40) !== 0)) {
      out.push(byte);
      return out;
    }
    out.push(byte | 0x80);
  }
}

const vec = (items) => [...uleb(items.length), ...items.flat()];
const name = (s) => vec([...Buffer.from(s, 'utf8')]);
const section = (id, body) => [id, ...uleb(body.length), ...body];
// An i32 address as the signed immediate an export would really return.
const i32 = (addr) => [OP.i32Const, ...sleb(addr | 0)];

/**
 * A fixture module: `pages` of memory; `colorful_input` returns `inputPtr` and
 * records the length; `colorful_output_ptr` returns `outputPtr` (default: the
 * input address) and `colorful_output_len` the recorded length. With
 * `statusFromDocument`, `colorful_ir` returns the first document byte minus
 * ASCII '0', so a document "2…" yields status 2.
 */
function fixture({ pages = 1, inputPtr = 0, outputPtr = inputPtr, irTraps = false, statusFromDocument = false } = {}) {
  const firstDocumentByte = [OP.localGet, 0, ...i32(inputPtr), OP.i32Add, OP.i32Load8U, 0, 0, OP.i32Const, 0x30, OP.i32Sub];
  const types = [
    [0x60, ...vec([]), ...vec([I32])], // 0: () -> i32
    [0x60, ...vec([I32]), ...vec([I32])], // 1: (i32) -> i32
    [0x60, ...vec([]), ...vec([])], // 2: () -> ()
  ];
  const fns = [
    ['colorful_abi_version', 0, [OP.i32Const, 1]],
    ['colorful_input', 1, [OP.localGet, 0, OP.globalSet, 0, ...i32(inputPtr)]],
    ['colorful_ir', 1, irTraps ? [OP.unreachable] : statusFromDocument ? firstDocumentByte : [OP.i32Const, 0]],
    ['colorful_version', 0, [OP.i32Const, 0]],
    ['colorful_output_ptr', 0, i32(outputPtr)],
    ['colorful_output_len', 0, [OP.globalGet, 0]],
    ['colorful_release', 2, []],
  ];
  const bytes = [
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec(types)),
    ...section(3, vec(fns.map(([, type]) => uleb(type)))),
    ...section(5, vec([[0x00, ...uleb(pages)]])),
    ...section(6, vec([[I32, 0x01, OP.i32Const, 0, OP.end]])),
    ...section(7, vec([
      [...name('memory'), 0x02, 0],
      ...fns.map(([n], i) => [...name(n), 0x00, ...uleb(i)]),
    ])),
    ...section(10, vec(fns.map(([, , body]) => {
      const code = [...vec([]), ...body, OP.end];
      return [...uleb(code.length), ...code];
    }))),
  ];
  return new Uint8Array(bytes);
}

const TWO_GIB = 2 ** 31;

test('fixtures implement ABI v1 and echo at a low address', async () => {
  const colorful = await instantiate(fixture());
  assert.equal(colorful.ir('doc'), 'stdindoc');
});

test('input and output at or above 2 GiB are read as unsigned addresses', async () => {
  // 2 GiB + 64 KiB of memory; both buffers sit at exactly 2^31, which the
  // i32 exports return as -2147483648.
  const colorful = await instantiate(fixture({ pages: TWO_GIB / PAGE + 1, inputPtr: TWO_GIB }));
  assert.equal(colorful.memoryBytes(), TWO_GIB + PAGE);
  assert.equal(colorful.ir('high', 'u'), 'uhigh');
  assert.equal(colorful.ir('again', 'u'), 'uagain', 'the instance stays usable');
});

test('an input region outside linear memory is E_BOUNDS and does not poison', async () => {
  const colorful = await instantiate(fixture({ inputPtr: PAGE - 2 }));
  assert.throws(() => colorful.ir('too long'), (err) => err instanceof ColorfulWasmError && err.code === 'E_BOUNDS');
  // A negative-as-signed address past a small memory is also a bounds failure.
  const high = await instantiate(fixture({ inputPtr: TWO_GIB + 16 }));
  assert.throws(() => high.ir('x'), (err) => err instanceof ColorfulWasmError && err.code === 'E_BOUNDS');
  assert.equal(high.memoryBytes(), PAGE, 'a bounds failure leaves the instance usable');
});

test('an output region outside linear memory is E_BOUNDS and does not poison', async () => {
  const colorful = await instantiate(fixture({ inputPtr: 0, outputPtr: 0xfffffff0 }));
  assert.throws(() => colorful.ir('doc'), (err) => err instanceof ColorfulWasmError && err.code === 'E_BOUNDS');
  assert.throws(() => colorful.version(), (err) => err.code === 'E_BOUNDS');
  assert.equal(colorful.memoryBytes(), PAGE);
  colorful.release();
});

test('a trap poisons the instance: every later call refuses with E_TRAPPED', async () => {
  const colorful = await instantiate(fixture({ irTraps: true }));
  assert.throws(() => colorful.ir('doc'), (err) => err instanceof ColorfulWasmError && err.code === 'E_TRAPPED');
  for (const [label, call] of [
    ['ir', () => colorful.ir('doc')],
    ['irBytes', () => colorful.irBytes(new Uint8Array([0x61]))],
    ['version', () => colorful.version()],
    ['release', () => colorful.release()],
    ['memoryBytes', () => colorful.memoryBytes()],
  ]) {
    assert.throws(call, (err) => err instanceof ColorfulWasmError && err.code === 'E_TRAPPED', label);
  }
});

test('arguments that are not strings or bytes are E_ARGUMENT and do not poison', async () => {
  const colorful = await instantiate(fixture());
  const isArgument = (err) => err instanceof ColorfulWasmError && err.code === 'E_ARGUMENT';
  for (const document of [null, undefined, 42, {}, ['a'], new ArrayBuffer(1)]) {
    assert.throws(() => colorful.irBytes(document), isArgument, String(document));
    assert.throws(() => colorful.ir(document), isArgument, String(document));
  }
  for (const unitId of [null, 7, new Uint8Array(1)]) {
    assert.throws(() => colorful.ir('doc', unitId), isArgument, String(unitId));
  }
  assert.equal(colorful.ir('doc'), 'stdindoc', 'the instance stays usable');
  assert.equal(colorful.ir(new Uint8Array([0x61]), 'u'), 'ua');
});

test('typed statuses 1-3 leave the instance usable', async () => {
  const colorful = await instantiate(fixture({ statusFromDocument: true }));
  for (const [status, code] of [['1', 'E_INVALID_UTF8'], ['2', 'E_PROJECTION'], ['3', 'E_SERIALIZATION'], ['9', 'E_STATUS_9']]) {
    assert.throws(() => colorful.ir(`${status}bad`, 'u'), (err) => err instanceof ColorfulWasmError && err.code === code
      && err.message.includes(`u${status}bad`));
    assert.equal(colorful.ir('0ok', 'u'), 'u0ok', `usable after ${code}`);
  }
});
