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
const describe = (value) =>
  value === null ? 'null' : typeof value === 'object' ? (value.constructor && value.constructor.name) || 'object' : typeof value;
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

  function guard() {
    if (poisoned) throw poisoned;
  }

  // Every call into the module goes through here. Anything thrown from inside
  // an export (a WebAssembly.RuntimeError trap, or a RangeError for wasm stack
  // exhaustion) leaves module state undefined: refuse every later call.
  // Host-side failures (bounds, decoding) are thrown outside this wrapper and
  // never poison the instance.
  function enter(name, ...args) {
    guard();
    try {
      return x[name](...args);
    } catch (err) {
      poisoned = new ColorfulWasmError('E_TRAPPED', `module trapped in ${name}: ${err && err.message}`);
      throw poisoned;
    }
  }

  // Exports return i32, so an address at or above 2 GiB arrives negative.
  // Read pointers and lengths as unsigned and check them against linear memory
  // before making a view.
  function view(name, ptr, len) {
    const start = ptr >>> 0;
    const size = len >>> 0;
    const limit = x.memory.buffer.byteLength;
    if (start + size > limit) {
      throw new ColorfulWasmError('E_BOUNDS', `${name} region ${start}+${size} exceeds linear memory of ${limit} bytes`);
    }
    return new Uint8Array(x.memory.buffer, start, size);
  }

  function output() {
    const ptr = enter('colorful_output_ptr');
    const len = enter('colorful_output_len');
    return view('output', ptr, len).slice();
  }

  /**
   * The exact stdout bytes of `colorful ir` (canonical JSON + "\n") for
   * `document` (a string, or UTF-8 bytes) analyzed as `unitId`.
   */
  function irBytes(document, unitId = STDIN_UNIT_ID) {
    if (typeof unitId !== 'string') {
      throw new ColorfulWasmError('E_ARGUMENT', `unitId must be a string, not ${describe(unitId)}`);
    }
    if (typeof document !== 'string' && !(document instanceof Uint8Array)) {
      throw new ColorfulWasmError('E_ARGUMENT', `document must be a string or Uint8Array, not ${describe(document)}`);
    }
    const unit = encoder.encode(unitId);
    const doc = typeof document === 'string' ? encoder.encode(document) : document;
    const total = unit.length + doc.length;
    const input = view('input', enter('colorful_input', total), total);
    input.set(unit, 0);
    input.set(doc, unit.length);
    const status = enter('colorful_ir', unit.length) >>> 0;
    const bytes = output();
    if (status !== 0) {
      throw new ColorfulWasmError(STATUS[status] || `E_STATUS_${status}`, decoder.decode(bytes));
    }
    return bytes;
  }

  return {
    abi,
    irBytes,
    /** `colorful ir` stdout as a string. */
    ir: (document, unitId = STDIN_UNIT_ID) => decoder.decode(irBytes(document, unitId)),
    /** `colorful --version` stdout, e.g. "colorful 0.4.0\n". */
    version: () => (enter('colorful_version'), decoder.decode(output())),
    /** Free the module's input and output buffers (memory pages stay reserved). */
    release: () => {
      enter('colorful_release');
    },
    /** Current linear-memory size in bytes; refuses after a trap like every call. */
    memoryBytes: () => (guard(), x.memory.buffer.byteLength),
  };
}
