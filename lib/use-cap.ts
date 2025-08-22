import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getChallenge,
  getLocalStorageItem,
  redeemSolutions,
  removeLocalStorageItem,
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
import type { CapHookProps, CapTokenLocalStorage } from './types.ts';

export function useCap(props: CapHookProps) {
  const {
    endpoint,
    workersCount = Math.min(
      navigator.hardwareConcurrency || DEFAULT_WORKERS_COUNT,
      MAX_WORKERS_COUNT
    ),
    localStorageEnabled = true,
    localStorageKey = DEFAULT_CAP_TOKEN_LOCAL_STORAGE_KEY,
    onSolve,
    onError,
    onProgress,
    onReset
  } = props;
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [solving, setSolving] = useState(false);
  const [token, setToken] = useState<CapTokenLocalStorage | null>(() =>
    localStorageEnabled ? getLocalStorageItem(localStorageKey) : null
  );

  const reset = useCallback(() => {
    setToken(null);
    onReset?.();
  }, [onReset]);

  const solve = useCallback(async () => {
    setSolving(true);

    try {
      const challenge = await getChallenge({ endpoint });
      const solutions = await solveChallenges(
        { onProgress, onError, workersCount },
        challenge.challenges
      );
      const redeemed = await redeemSolutions(
        { onProgress, endpoint },
        challenge.token,
        solutions
      );
      setToken(redeemed);
      onSolve?.(redeemed);
      return redeemed;
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      onError?.(error instanceof Error ? error.message : String(error));
    } finally {
      setSolving(false);
    }
  }, [endpoint, onProgress, onSolve, onError, workersCount]);

  const startRefresh = useCallback(
    (expires: number) => {
      if (refreshTimer.current) {
        return;
      }

      const expiresIn = new Date(expires).getTime() - Date.now();

      if (expiresIn > 0 && expiresIn < ONE_DAY_IN_MS) {
        refreshTimer.current = setTimeout(() => {
          refreshTimer.current = null;
          if (!solving) {
            void solve();
          }
        }, expiresIn - EXPIRES_BUFFER_IN_MS);
      } else {
        onError?.('Invalid expiration time');
      }

      return () => {
        if (refreshTimer.current) {
          clearTimeout(refreshTimer.current);
          refreshTimer.current = null;
        }
      };
    },
    [onError, solve, solving]
  );

  useEffect(() => {
    if (localStorageEnabled) {
      if (token) {
        if (!token.fromLocalStorage) {
          setLocalStorageItem(localStorageKey, token);
        }
      } else {
        removeLocalStorageItem(localStorageKey);
      }
    }
  }, [token, localStorageKey, localStorageEnabled]);

  useEffect(() => {
    if (token && !refreshTimer.current) {
      const cleanup = startRefresh(token.expires);
      return () => {
        cleanup?.();
      };
    }

    if (!token && refreshTimer.current) {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
  }, [token, startRefresh]);

  return {
    token,
    error,
    solving,
    solve,
    reset
  };
}

export type CapProps = ReturnType<typeof useCap>;
