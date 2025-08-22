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
import type { CapHookProps, CapToken } from './types.ts';

export function useCap(props: CapHookProps) {
  const {
    endpoint,
    workersCount = Math.min(
      navigator.hardwareConcurrency || DEFAULT_WORKERS_COUNT,
      MAX_WORKERS_COUNT
    ),
    localStorageEnabled = true,
    localStorageKey = DEFAULT_CAP_TOKEN_LOCAL_STORAGE_KEY,
    refreshAutomatically = true,
    onSolve,
    onError,
    onProgress,
    onReset
  } = props;
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [solving, setSolving] = useState(false);
  const [token, setToken] = useState<CapToken | null>(() =>
    localStorageEnabled ? getLocalStorageItem(localStorageKey) : null
  );

  const setTokenWithLocalStorage = useCallback(
    (newToken: CapToken | null) => {
      setToken(newToken);
      if (localStorageEnabled) {
        if (newToken) {
          setLocalStorageItem(localStorageKey, newToken);
        } else {
          removeLocalStorageItem(localStorageKey);
        }
      }
    },
    [localStorageEnabled, localStorageKey]
  );

  const handleProgress = useCallback(
    (progress: number) => {
      setProgress(progress);
      onProgress?.(progress);
    },
    [onProgress]
  );

  const reset = useCallback(() => {
    setTokenWithLocalStorage(null);
    setProgress(0);
    setError(null);
    onReset?.();
  }, [onReset, setTokenWithLocalStorage]);

  const solve = useCallback(async () => {
    setSolving(true);
    setProgress(0);

    try {
      const challenge = await getChallenge({ endpoint });
      const solutions = await solveChallenges(
        { onProgress: handleProgress, workersCount },
        challenge.challenges
      );
      const redeemed = await redeemSolutions(
        { onProgress: handleProgress, endpoint },
        challenge.token,
        solutions
      );
      setTokenWithLocalStorage(redeemed);
      onSolve?.(redeemed);
      return redeemed;
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      onError?.(error instanceof Error ? error.message : String(error));
    } finally {
      setSolving(false);
    }
  }, [
    endpoint,
    handleProgress,
    onSolve,
    onError,
    workersCount,
    setTokenWithLocalStorage
  ]);

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
    if (refreshAutomatically && !error) {
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
    }
  }, [token, startRefresh, refreshAutomatically, error]);

  return {
    token,
    error,
    solving,
    solve,
    reset,
    progress
  };
}

export type CapProps = ReturnType<typeof useCap>;
