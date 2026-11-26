# ADR-0007: Export the IR analysis to WebAssembly through a plain C ABI

- Status: Proposed (experimental spike). The source-policy exception below is
  registered in `exceptions.tsv` and pending architecture review; registration
  is not approval.
- Date: 2026-10-27

## Context

Issue [#175](https://github.com/flyingrobots/colorful-language/issues/175)
asks for a WebAssembly build of the production analysis stack, with byte
parity against the native CLI, typed failures, and measured size, startup,
latency and memory. A downstream consumer, Reader, currently runs
`colorful ir -` as a subprocess and admits the `colorful.syntax/v1` JSON it
prints. A module that returns those exact bytes would let the same consumer
run in a browser or in Node without a native binary.

The analysis crates (`colorful-core`, `colorful-parse`, `colorful-lexicon`,
`colorful-ir`, `colorful-projection`) already compile to
`wasm32-unknown-unknown` with no feature changes: their dependencies (`logos`,
`phf`, `serde`, `serde_json`, `sha2`) are pure Rust, and the default
`ProseParser` path used by `colorful ir` does not need the optional
`pulldown-cmark` feature. No first-party dependency had to be gated.

## Decision

Add an unpublished `colorful-wasm` crate (`cdylib` + `rlib`) whose safe core,
`ir_output`, composes exactly what `colorful ir` composes and appends the
CLI's trailing newline. Expose it through a plain C ABI rather than
`wasm-bindgen`:

| Export | Meaning |
| --- | --- |
| `colorful_abi_version() -> u32` | Calling-convention version (1). |
| `colorful_input(len) -> *mut u8` | Resize the module-owned input buffer and return its address. |
| `colorful_ir(unit_len) -> u32` | Analyze `input[unit_len..]` as unit id `input[..unit_len]`; 0 = IR in the output buffer, 1/2/3 = UTF-8, projection or serialization failure with its message there. |
| `colorful_version() -> u32` | Put the `colorful --version` bytes in the output buffer. |
| `colorful_output_ptr() / colorful_output_len()` | Locate the last result. |
| `colorful_release()` | Free both buffers. |

The module has no imports. A dependency-free ES module,
`crates/colorful-wasm/js/colorful-wasm.mjs`, moves bytes in and out and turns
non-zero statuses into typed `ColorfulWasmError`s; after a trap it refuses
further calls instead of trusting a module in an unknown state.

### Calling contract

The module is single-threaded and not reentrant: a host makes one call at a
time.

- **Units.** Every length, including `unit_len`, is a count of bytes. Pointers
  are unsigned 32-bit linear-memory addresses; JavaScript receives them as
  signed `i32` results and must read them with `>>> 0`, because addresses at
  or above 2 GiB arrive negative.
- **Call sequence.** `colorful_input(len)` → write exactly `len` bytes
  (`unit_id ‖ document`, both UTF-8) at the returned address →
  `colorful_ir(unit_len)` → read `colorful_output_len()` bytes at
  `colorful_output_ptr()`.
- **Split.** The first `unit_len` bytes are the unit id. A `unit_len` larger
  than the input is clamped to the input length, so the whole input becomes
  the unit id and the document is empty. Invalid UTF-8 in either part returns
  status 1.
- **Input lifetime.** `colorful_input` discards the previous input and
  returns a new address (zeroed, possibly different). That address stays valid
  until the next `colorful_input` or `colorful_release`. `colorful_ir` reads
  the input and does not change it.
- **Output lifetime.** `colorful_ir` and `colorful_version` replace the
  output; `colorful_release` empties it. The output address is valid only until
  the next of those calls. `colorful_input` does not touch the output.
- **Memory growth.** Any call may grow linear memory. Addresses stay valid,
  but a JavaScript `ArrayBuffer` view taken before the call may be detached:
  take views after the call that returned the address, and copy the bytes out
  before the next call. The bundled loader does both; every `Uint8Array` it
  returns is a copy the caller owns.
- **Release and reuse.** `colorful_release` frees both buffers to the
  allocator. The instance remains usable. Linear memory never shrinks: pages
  grown for a large document stay reserved until the instance is dropped.
- **Failures.** Status 0 means the output holds the complete `colorful ir`
  stdout bytes. Statuses 1, 2 and 3 (invalid UTF-8, projection,
  serialization) mean the output holds a UTF-8 message and no IR; the instance
  stays usable. A trap leaves module state undefined; hosts must discard the
  instance. These differ from initialization failures, which happen before any
  status exists: the engine rejects compilation or instantiation
  (`CompileError`, `LinkError`), or `colorful_abi_version()` returns a version
  the host does not support (the loader raises `E_ABI`).

Why not `wasm-bindgen`: the interface is one string in and one string out, so
generated glue adds a crate dependency, a CLI tool whose version must match the
crate exactly, and a generated JavaScript file that must be rebuilt per
release, without making the boundary safer. Its macros also emit `#[no_mangle]`
and `unsafe` code that `#![forbid(unsafe_code)]` rejects, so it would need the
same source-policy exception. The C ABI works unchanged in browsers, Node and
non-JavaScript hosts (wasmtime, wasmer).

## Source-policy exception

- **Root and capability:** `crates/colorful-wasm/src/lib.rs`. The crate root
  declares `#![deny(unsafe_code)]`; only the private `exports` module allows
  it, and the only unsafe capability used there is the `#[no_mangle]`
  attribute that gives each export a stable symbol. There are no `unsafe`
  blocks, raw-pointer dereferences or `unsafe fn`s: the host writes into a
  `Vec<u8>` the module owns, between calls, and Rust reads it through safe
  borrows.
- **Why safe Rust cannot do it:** exporting an unmangled symbol from a Rust
  `cdylib` requires `#[no_mangle]` or `#[export_name]`, both of which the
  `unsafe_code` lint rejects under `forbid`.
- **Containment and tests:** the exports are thin wrappers over `ir_output`;
  native unit tests cover the safe core and the export status mapping, and
  `crates/colorful-wasm/js/parity.test.mjs` proves byte parity of the built
  module against the native CLI on synthetic texts, every tracked `.md`/`.txt`
  file, a ~200 KB document, file unit ids, invalid UTF-8 and `--version`.
- **Owner:** the `colorful-wasm` maintainer (repository owner).
- **Removal:** if Rust offers a safe way to export a symbol, or the WASM build
  is withdrawn, delete the exception and restore `#![forbid(unsafe_code)]`.

## Consequences

- The CLI is unchanged. Parity is enforced by a test, not by sharing the
  CLI's private `analyze_ir`, so a change to the CLI's analysis composition
  must be mirrored in `ir_output`; the parity test fails until it is.
- Memory: linear memory never shrinks. Analysing a 200 KB document peaks at
  about 66 MB of linear memory, largely because `canonical_json` builds a
  `serde_json::Value` tree of an IR that is roughly 33 times the input size.
  A long-lived host should recycle the instance after very large documents.
- Not decided here: a playground, an npm package, publication of the crate,
  or CI wiring of the parity test. Each is a separate reviewed step.
