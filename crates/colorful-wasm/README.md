# colorful-wasm

Experimental, unpublished WebAssembly build of `colorful ir`. The module
returns the exact bytes `colorful ir` writes to stdout — the
`colorful.syntax/v1` `DocumentAnalysis` as canonical JSON plus one newline —
using the same parser, annotator, projection and serializer as the CLI. It has
no imports and runs in browsers, Node and other WebAssembly hosts.

The design and its `#[no_mangle]` source-policy exception are recorded in
[ADR-0007](../../docs/design/0007-wasm-c-abi-exports.md).

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

`irBytes` accepts a string or UTF-8 bytes and returns bytes. A failure throws
`ColorfulWasmError` with `code` `E_INVALID_UTF8`, `E_PROJECTION` or
`E_SERIALIZATION` and returns no output. After a trap the instance throws
`E_TRAPPED` on every later call; create a new one.

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
