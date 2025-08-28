import {
  getChallenge,
  getLocalStorageItem,
  redeemSolutions,
  setLocalStorageItem,
  solveChallenges
} from './api.ts';
import {
  DEFAULT_CAP_TOKEN_LOCAL_STORAGE_KEY,
  DEFAULT_WORKERS_COUNT,
  EXPIRES_BUFFER_IN_MS,
  MAX_WORKERS_COUNT,
  ONE_DAY_IN_MS
} from './constants.ts';
import type { CapHookProps, CapToken } from './types.ts';

const solving = new Map<string, Promise<CapToken | undefined>>();
const refreshTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

export type GetCapTokenContext = Pick<
  CapHookProps,
  | 'endpoint'
  | 'workersCount'
  | 'onProgress'
  | 'onSolve'
  | 'onError'
  | 'refreshAutomatically'
  | 'localStorageEnabled'
> & {
  tokenKey: string;
};

export type GetCapTokenProps = Omit<GetCapTokenContext, 'tokenKey'> & {
  tokenKey?: string;
};

async function solve(context: GetCapTokenContext): Promise<CapToken> {
  const {
    endpoint,
    workersCount = Math.min(
      navigator.hardwareConcurrency || DEFAULT_WORKERS_COUNT,
      MAX_WORKERS_COUNT
    ),
    onProgress
  } = context;

  const challenge = await getChallenge({ endpoint });
  const solutions = await solveChallenges(
    { onProgress, workersCount },
    challenge.challenges
  );
  return redeemSolutions({ onProgress, endpoint }, challenge.token, solutions);
}

function startRefresh(context: GetCapTokenContext, expires: number) {
  const { tokenKey, onError } = context;
  let timeout = refreshTimeouts.get(tokenKey);
  if (timeout) {
    clearTimeout(timeout);
    refreshTimeouts.delete(tokenKey);
  }

  const expiresIn = new Date(expires).getTime() - Date.now();

  if (expiresIn > 0 && expiresIn < ONE_DAY_IN_MS) {
    timeout = setTimeout(() => {
      refreshTimeouts.delete(tokenKey);
      void solveOneAtATime(context);
    }, expiresIn - EXPIRES_BUFFER_IN_MS);
    refreshTimeouts.set(tokenKey, timeout);
  } else {
    onError?.('Invalid expiration time');
  }
}

async function solveOneAtATime(context: GetCapTokenContext) {
  const { tokenKey } = context;

  let promise = solving.get(tokenKey);
  if (!promise) {
    promise = solve(context)
      .then((token) => {
        if (context.localStorageEnabled) {
          setLocalStorageItem(tokenKey, token);
        }
        context.onSolve?.(token);

        if (context.refreshAutomatically) {
          startRefresh(context, token.expires);
        }

        return token;
      })
      .catch((error) => {
        context.onError?.(
          error instanceof Error ? error.message : String(error)
        );
        return undefined;
      })
      .finally(() => {
        solving.delete(tokenKey);
      });
    solving.set(tokenKey, promise);
  }

  return promise;
}

export async function getCapToken(props: GetCapTokenProps) {
  const context = {
    ...props,
    tokenKey: props.tokenKey ?? DEFAULT_CAP_TOKEN_LOCAL_STORAGE_KEY
  };

  if (props.localStorageEnabled) {
    const token = getLocalStorageItem(context.tokenKey);
    if (token) {
      if (context.refreshAutomatically) {
        startRefresh(context, token.expires);
      }
      return token;
    }
  }

  return solveOneAtATime(context);
}

export function cancelRefresh(tokenKey: string) {
  const timeout = refreshTimeouts.get(tokenKey);
  if (timeout) {
    clearTimeout(timeout);
    refreshTimeouts.delete(tokenKey);
  }
}
