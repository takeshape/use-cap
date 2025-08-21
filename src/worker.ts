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
        return wasmModule.default().then((instance: any) => {
          solvePowFunction = (instance?.exports ? instance.exports : wasmModule)
            .solve_pow;
        });
      })
      .catch((e) => {
        console.error('[cap worker] using fallback solver due to error:', e);
      });
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
