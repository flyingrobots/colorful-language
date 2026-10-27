// Host loader for colorful_wasm.wasm (C-ABI version 1). No dependencies; runs
// unchanged in browsers and Node. It only moves bytes: analysis, validation and
// canonical JSON all happen inside the module, exactly as in `colorful ir`.

export const ABI_VERSION = 1;
export const STDIN_UNIT_ID = 'stdin';

const STATUS = { 1: 'E_INVALID_UTF8', 2: 'E_PROJECTION', 3: 'E_SERIALIZATION' };

/** A typed failure: no partial output accompanies it. */
export class ColorfulWasmError extends Error {
  constructor(code, message) {
    super(`colorful: ${message} (${code})`);
    this.name = 'ColorfulWasmError';
    this.code = code;
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * Instantiate the module. `source` is a WebAssembly.Module, the .wasm bytes
 * (ArrayBuffer or typed array), or a fetch Response / Promise of one.
 */
export async function instantiate(source) {
  const resolved = await source;
  let instance;
  if (resolved instanceof WebAssembly.Module) {
    instance = await WebAssembly.instantiate(resolved, {});
  } else if (typeof Response !== 'undefined' && resolved instanceof Response) {
    instance = (await WebAssembly.instantiateStreaming(resolved, {})).instance;
  } else {
    instance = (await WebAssembly.instantiate(resolved, {})).instance;
  }
  return wrap(instance);
}

function wrap(instance) {
  const x = instance.exports;
  const abi = x.colorful_abi_version();
  if (abi !== ABI_VERSION) {
    throw new ColorfulWasmError('E_ABI', `module ABI ${abi} is not the supported ${ABI_VERSION}`);
  }
  let poisoned = null;

  function call(fn) {
    if (poisoned) throw poisoned;
    try {
      return fn();
    } catch (err) {
      if (err instanceof ColorfulWasmError) throw err;
      // A trap (Rust panic) leaves module state undefined: refuse further use.
      poisoned = new ColorfulWasmError('E_TRAPPED', `module trapped: ${err && err.message}`);
      throw poisoned;
    }
  }

  function output() {
    const ptr = x.colorful_output_ptr();
    const len = x.colorful_output_len();
    return new Uint8Array(x.memory.buffer, ptr, len).slice();
  }

  /**
   * The exact stdout bytes of `colorful ir` (canonical JSON + "\n") for
   * `document` (a string, or UTF-8 bytes) analyzed as `unitId`.
   */
  function irBytes(document, unitId = STDIN_UNIT_ID) {
    const unit = encoder.encode(unitId);
    const doc = typeof document === 'string' ? encoder.encode(document) : document;
    return call(() => {
      const ptr = x.colorful_input(unit.length + doc.length);
      const view = new Uint8Array(x.memory.buffer, ptr, unit.length + doc.length);
      view.set(unit, 0);
      view.set(doc, unit.length);
      const status = x.colorful_ir(unit.length);
      const bytes = output();
      if (status !== 0) {
        throw new ColorfulWasmError(STATUS[status] || `E_STATUS_${status}`, decoder.decode(bytes));
      }
      return bytes;
    });
  }

  return {
    abi,
    irBytes,
    /** `colorful ir` stdout as a string. */
    ir: (document, unitId) => decoder.decode(irBytes(document, unitId)),
    /** `colorful --version` stdout, e.g. "colorful 0.4.0\n". */
    version: () => call(() => (x.colorful_version(), decoder.decode(output()))),
    /** Free the module's input and output buffers (memory pages stay reserved). */
    release: () => call(() => x.colorful_release()),
    /** Current linear-memory size in bytes. */
    memoryBytes: () => x.memory.buffer.byteLength,
  };
}
