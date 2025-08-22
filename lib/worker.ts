import type { CapWorkerMessage } from './types.ts';

let wasmLoaded: boolean;
let solvePowFunction: (s: string, t: string) => bigint;

self.onmessage = async ({
  data: { salt, target }
}: {
  data: CapWorkerMessage;
}) => {
  if (!wasmLoaded) {
    wasmLoaded = true;
    await import('@cap.js/wasm/browser/cap_wasm.js')
      .then((wasmModule) => {
        // biome-ignore lint/suspicious/noExplicitAny: Do not care to retype the external module
        return wasmModule.default().then((instance: any) => {
          solvePowFunction = (instance?.exports ? instance.exports : wasmModule)
            .solve_pow;
        });
      })
      .catch((e) => {
        console.error('[cap worker] using fallback solver due to error:', e);
      });
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
