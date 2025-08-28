import { EXPIRES_BUFFER_IN_MS, WORKER_TIMEOUT_IN_MS } from './constants.ts';
import type {
  CapHookProps,
  CapToken,
  CapWorkerMessage,
  CapWorkerResult,
  Challenge,
  ChallengeResponse,
  RedeemResponse
} from './types.ts';
// Not ideal, due to this bug: https://github.com/vitejs/vite/issues/15618
// https://github.com/vitejs/vite/discussions/15547
import CapWorker from './worker.ts?worker&inline';

export async function getChallenge(
  context: Pick<CapHookProps, 'endpoint' | 'challengeHeaders'>
) {
  const { endpoint, challengeHeaders } = context;
  const { challenge, token, expires } = (await (
    await fetch(`${endpoint}challenge`, {
      method: 'POST',
      headers: challengeHeaders
    })
  ).json()) as ChallengeResponse;

  let challenges: Challenge[];

  if (!Array.isArray(challenge)) {
    challenges = Array.from({ length: challenge.c }, (_v, k) => {
      const i = k + 1;
      return [
        prng(`${token}${i}`, challenge.s),
        prng(`${token}${i}d`, challenge.d)
      ];
    });
  } else {
    challenges = challenge;
  }

  return { token, expires, challenges };
}

export async function solveChallenges(
  context: Pick<CapHookProps, 'onProgress'> &
    Required<Pick<CapHookProps, 'workersCount'>>,
  challenges: Challenge[]
) {
  const { onProgress, workersCount } = context;

  const total = challenges.length;
  let completed = 0;

  const workers = Array(workersCount)
    .fill(null)
    .map(() => {
      try {
        return createWorker();
      } catch (error) {
        console.error('[cap] Failed to create worker:', error);
        throw new Error('Worker creation failed');
      }
    });

  const solveSingleChallenge = (
    [salt, target]: Challenge,
    workerId: number
  ): Promise<number> =>
    new Promise((resolve, reject) => {
      const worker = workers[workerId];
      if (!worker) {
        reject(new Error('Worker not available'));
        return;
      }

      const timeout = setTimeout(() => {
        try {
          worker.terminate();
          workers[workerId] = createWorker();
        } catch (error) {
          console.error('[cap] error terminating/recreating worker:', error);
        }
        reject(new Error('Worker timeout'));
      }, WORKER_TIMEOUT_IN_MS);

      worker.onmessage = ({ data }: CapWorkerResult) => {
        if (!data.found) {
          return;
        }

        clearTimeout(timeout);
        completed++;
        onProgress?.(Math.round((completed / total) * 100));
        resolve(data.nonce);
      };

      worker.onerror = (err) => {
        console.error('[cap worker] error:', err);
        clearTimeout(timeout);
        reject(
          new Error(
            `Error in worker: ${typeof err === 'object' ? (err?.message ?? 'unknown') : String(err)}`
          )
        );
      };

      const message: CapWorkerMessage = {
        salt,
        target
      };

      worker.postMessage(message);
    });

  const results: number[] = [];

  try {
    for (let i = 0; i < challenges.length; i += workersCount) {
      const chunk = challenges.slice(
        i,
        Math.min(i + workersCount, challenges.length)
      );
      const chunkResults = await Promise.all(
        chunk.map((c, idx) => solveSingleChallenge(c, idx))
      );
      results.push(...chunkResults);
    }
  } finally {
    for (const w of workers) {
      if (w) {
        try {
          w.terminate();
        } catch (error) {
          console.error('[cap] error terminating worker:', error);
        }
      }
    }
  }

  return results;
}

export async function redeemSolutions(
  context: Pick<CapHookProps, 'onProgress' | 'endpoint' | 'redeemHeaders'>,
  token: string,
  solutions: number[]
) {
  const { onProgress, endpoint, redeemHeaders } = context;

  const response = await fetch(`${endpoint}redeem`, {
    method: 'POST',
    body: JSON.stringify({ token, solutions }),
    headers: {
      'content-type': 'application/json',
      ...redeemHeaders
    }
  });

  onProgress?.(100);

  if (!response.ok) {
    throw new Error('Failed to redeem token');
  }

  const resp = (await response.json()) as RedeemResponse;

  if (!resp.success) {
    throw new Error(resp.message ?? 'Invalid solution');
  }

  return resp;
}

function prng(seed: string, length: number) {
  function fnv1a(str: string) {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash +=
        (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return hash >>> 0;
  }

  let state = fnv1a(seed);
  let result = '';

  function next() {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  }

  while (result.length < length) {
    const rnd = next();
    result += rnd.toString(16).padStart(8, '0');
  }

  return result.substring(0, length);
}

function createWorker() {
  // This needs to all be inline for bundlers to properly detect the worker file
  return new CapWorker();
}

export function isTokenExpired(token: CapToken) {
  return token.expires <= Date.now() + EXPIRES_BUFFER_IN_MS;
}

export function setLocalStorageItem(localStorageKey: string, token: CapToken) {
  localStorage.setItem(localStorageKey, JSON.stringify(token));
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

function isCapToken(x: unknown): x is CapToken {
  return (
    isObject(x) && typeof x.token === 'string' && typeof x.expires === 'number'
  );
}

export function getLocalStorageItem(localStorageKey: string): CapToken | null {
  try {
    const item = localStorage.getItem(localStorageKey);
    if (item) {
      const capToken = JSON.parse(item);
      if (isCapToken(capToken) && !isTokenExpired(capToken)) {
        return capToken;
      }
    }
  } catch {
    console.warn('[cap] Failed to parse token from localStorage');
  }
  return null;
}

export function removeLocalStorageItem(localStorageKey: string) {
  localStorage.removeItem(localStorageKey);
}
