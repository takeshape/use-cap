import wasmModule, { solve_pow } from '@cap.js/wasm/browser/cap_wasm.js';
import type { CapWorkerMessage } from './types.ts';

let wasmLoaded: boolean;
let solvePowFunction: (s: string, t: string) => bigint;

self.onmessage = async ({
  data: { salt, target }
}: {
  data: CapWorkerMessage;
}) => {
  if (
    typeof WebAssembly === 'object' &&
    typeof WebAssembly?.instantiate === 'function'
  ) {
    if (!wasmLoaded) {
      wasmLoaded = true;
      try {
        // this is an async init function for the WASM module
        await wasmModule();
        // this is the actual function that solves the proof-of-work
        solvePowFunction = solve_pow;
      } catch (error) {
        console.error(
          '[cap worker] using fallback solver due to error:',
          error
        );
      }
    }
  } else {
    console.warn(
      '[cap worker] WebAssembly is not supported, using fallback solver'
    );
  }

  if (!solvePowFunction) {
    fallbackSolver({
      data: { salt, target }
    });
    return;
  }

  try {
    const startTime = performance.now();
    const nonce = solvePowFunction(salt, target);
    const endTime = performance.now();

    self.postMessage({
      nonce: Number(nonce),
      found: true,
      durationMs: (endTime - startTime).toFixed(2)
    });
  } catch (error) {
    console.error('[cap worker]', error);
    self.postMessage({
      found: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

self.onerror = (error) => {
  self.postMessage({
    found: false,
    error
  });
};

async function fallbackSolver({
  data: { salt, target }
}: {
  data: CapWorkerMessage;
}) {
  let nonce = 0;
  const batchSize = 50000;
  const encoder = new TextEncoder();

  const targetBytes = new Uint8Array(target.length / 2);
  for (let k = 0; k < targetBytes.length; k++) {
    targetBytes[k] = parseInt(target.substring(k * 2, k * 2 + 2), 16);
  }
  const targetBytesLength = targetBytes.length;

  while (true) {
    try {
      for (let i = 0; i < batchSize; i++) {
        const inputString = salt + nonce;
        const inputBytes = encoder.encode(inputString);

        const hashBuffer = await crypto.subtle.digest('SHA-256', inputBytes);

        const hashBytes = new Uint8Array(hashBuffer, 0, targetBytesLength);

        let matches = true;
        for (let k = 0; k < targetBytesLength; k++) {
          if (hashBytes[k] !== targetBytes[k]) {
            matches = false;
            break;
          }
        }

        if (matches) {
          self.postMessage({ nonce, found: true });
          return;
        }

        nonce++;
      }
    } catch (error) {
      console.error('[cap worker]', error);
      self.postMessage({
        found: false,
        error: error instanceof Error ? error.message : String(error)
      });
      return;
    }
  }
}
