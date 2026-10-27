# colorful-wasm

Experimental, unpublished WebAssembly build of `colorful ir`. The module
returns the exact bytes `colorful ir` writes to stdout — the
`colorful.syntax/v1` `DocumentAnalysis` as canonical JSON plus one newline —
using the same parser, annotator, projection and serializer as the CLI. It has
no imports and runs in browsers, Node and other WebAssembly hosts.

The design and its `#[no_mangle]` source-policy exception are recorded in
[ADR-0007](../../docs/design/0007-wasm-c-abi-exports.md). The exception is
registered and pending architecture review; registration is not approval.

## Build

```bash
rustup target add wasm32-unknown-unknown
cargo build --locked --release -p colorful-wasm --target wasm32-unknown-unknown
```

The module is written to
`target/wasm32-unknown-unknown/release/colorful_wasm.wasm`.

## Use

[`js/colorful-wasm.mjs`](js/colorful-wasm.mjs) is a dependency-free loader:

```js
import { instantiate } from './colorful-wasm.mjs';

const colorful = await instantiate(fetch('colorful_wasm.wasm'));
const ir = JSON.parse(colorful.ir('The cat sat.')); // same bytes as `colorful ir -`
colorful.ir(text, 'notes.txt'); // same bytes as `colorful ir notes.txt`
colorful.version(); // "colorful 0.4.0\n"
```

`irBytes` accepts a string or a `Uint8Array` of UTF-8 and returns a new
`Uint8Array`. Every failure is a `ColorfulWasmError` and returns no IR (for
instantiation failures from the engine, see below):

| `code` | Cause | Instance afterwards |
| --- | --- | --- |
| `E_ABI` | `instantiate` found a module whose ABI version is not 1 | not created |
| `E_ARGUMENT` | document not a string or `Uint8Array`, or unit id not a string | usable |
| `E_INVALID_UTF8`, `E_PROJECTION`, `E_SERIALIZATION` | typed status 1, 2 or 3 from `colorful_ir` | usable |
| `E_BOUNDS` | an exported pointer and length fall outside linear memory | usable |
| `E_TRAPPED` | an export trapped (Rust panic, `unreachable`, stack exhaustion) | every later call, including `memoryBytes()`, throws the same error; create a new instance |

The loader reads exported pointers and lengths as unsigned 32-bit values, so
buffers at or above 2 GiB of linear memory work.

`instantiate` rejects before any of these with the engine's own
`WebAssembly.CompileError` or `LinkError` for a malformed module, a
`TypeError` from `instantiateStreaming` when a `Response` is not served as
`application/wasm`, or `E_ABI`.

Results are copies: the loader copies each result out of linear memory before
returning it, so later calls never change bytes a caller holds. `release()`
frees the module's buffers and the instance stays usable. Hosts that call the
C ABI directly (not through this loader) must follow the pointer-lifetime rules
in [ADR-0007](../../docs/design/0007-wasm-c-abi-exports.md#calling-contract).

Strings are encoded with `TextEncoder`, which replaces lone UTF-16 surrogates
with U+FFFD; pass bytes when the exact input bytes matter.

Linear memory grows to the largest document analysed and never shrinks. A
long-lived host that analyses very large documents should recycle the
instance.

## Verify

```bash
cargo build --locked --release -p colorful-cli
cargo build --locked --release -p colorful-wasm --target wasm32-unknown-unknown
node --test crates/colorful-wasm/js/parity.test.mjs
```

Measurements (not a CI gate):

```bash
node crates/colorful-wasm/js/bench.mjs
PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core \
  node crates/colorful-wasm/js/browser-bench.mjs
```

`browser-bench.mjs` also checks in-page parity against the CLI. Set
`CHROMIUM_PATH` when the installed Chromium revision differs from the one
`playwright-core` expects. Engines without an installed browser are reported as
unavailable.
