import { EXPIRES_BUFFER_IN_MS } from './constants.ts';
import type {
  CapHookProps,
  CapToken,
  CapTokenLocalStorage,
  CapWorkerMessage,
  CapWorkerResult,
  Challenge,
  ChallengeResponse,
  RedeemResponse
} from './types.ts';

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
  context: Pick<CapHookProps, 'onProgress' | 'onError'> &
    Required<Pick<CapHookProps, 'workersCount'>>,
  challenges: Challenge[]
) {
  const { onProgress, onError, workersCount } = context;

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
      }, 30000);

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
        onError?.(`Error in worker: ${err.message || err}`);
        reject(err);
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
  return new Worker(new URL('./worker', import.meta.url));
}

export function setLocalStorageItem(localStorageKey: string, token: CapToken) {
  localStorage.setItem(localStorageKey, JSON.stringify(token));
}

export function getLocalStorageItem(
  localStorageKey: string
): CapTokenLocalStorage | null {
  try {
    const item = localStorage.getItem(localStorageKey);

    if (!item) {
      return null;
    }

    const obj = JSON.parse(item);

    if (typeof obj !== 'object' || obj === null) {
      return null;
    }

    const capToken = obj as CapToken;
    if (
      typeof capToken.token === 'string' &&
      typeof capToken.expires === 'number' &&
      capToken.expires - EXPIRES_BUFFER_IN_MS > Date.now()
    ) {
      return {
        ...capToken,
        fromLocalStorage: true
      };
    }

    return null;
  } catch {
    console.warn('[cap] Failed to parse token from localStorage');
    return null;
  }
}

export function removeLocalStorageItem(localStorageKey: string) {
  localStorage.removeItem(localStorageKey);
}
