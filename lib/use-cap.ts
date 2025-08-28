import { useCallback, useEffect, useState } from 'react';
import { getLocalStorageItem, removeLocalStorageItem } from './api.ts';
import { DEFAULT_CAP_TOKEN_LOCAL_STORAGE_KEY } from './constants.ts';
import { cancelRefresh, getCapToken } from './token.ts';
import type { CapHookProps, CapToken, UseCap } from './types.ts';

export function useCap(props: CapHookProps): UseCap {
  const {
    endpoint,
    workersCount,
    localStorageEnabled = true,
    tokenKey = DEFAULT_CAP_TOKEN_LOCAL_STORAGE_KEY,
    refreshAutomatically = true,
    onSolve,
    onError,
    onProgress,
    onReset
  } = props;
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [solving, setSolving] = useState(false);
  const [token, setToken] = useState<CapToken | null>(() =>
    localStorageEnabled ? getLocalStorageItem(tokenKey) : null
  );

  const handleProgress = useCallback(
    (progress: number) => {
      setProgress(progress);
      onProgress?.(progress);
    },
    [onProgress]
  );

  const reset = useCallback(() => {
    setToken(null);
    if (localStorageEnabled) {
      removeLocalStorageItem(tokenKey);
    }
    cancelRefresh(tokenKey);
    setProgress(0);
    setError(null);
    onReset?.();
  }, [localStorageEnabled, tokenKey, onReset]);

  const solve = useCallback(async () => {
    setSolving(true);
    setProgress(0);
    setError(null);

    try {
      const result = await getCapToken({
        endpoint,
        workersCount,
        localStorageEnabled,
        tokenKey,
        refreshAutomatically,
        onProgress: handleProgress,
        onSolve: (newToken) => {
          setToken(newToken);
          onSolve?.(newToken);
        },
        onError: (errorMessage) => {
          setError(errorMessage);
          onError?.(errorMessage);
        }
      });

      if (result) {
        setToken(result);
        return result;
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      setError(errorMessage);
      onError?.(errorMessage);
    } finally {
      setSolving(false);
    }
  }, [
    endpoint,
    workersCount,
    localStorageEnabled,
    tokenKey,
    refreshAutomatically,
    handleProgress,
    onSolve,
    onError
  ]);

  useEffect(() => {
    if (localStorageEnabled) {
      const storedToken = getLocalStorageItem(tokenKey);
      if (storedToken) {
        setToken(storedToken);
      }
    }
  }, [localStorageEnabled, tokenKey]);

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
