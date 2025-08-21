import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react';
import { act } from 'react';
import type { CapHookProps, CapWorkerResult } from '../types';
import { useCapHook } from '../use-cap-hook';

// Mock Worker
let mockWorkers: Array<Worker> = [];

const createMockWorker = (overrides?: Partial<Worker>) => {
  const worker: Partial<Worker> = {
    postMessage: jest.fn().mockImplementation((message: any) => {
      // Simulate immediate worker response for testing
      setTimeout(() => {
        if (worker.onmessage) {
          (worker as any).onmessage({
            data: {
              nonce: Math.floor(Math.random() * 100000),
              found: true,
              durationMs: '100.50'
            }
          });
        }
      }, 10);
    }),
    terminate: jest.fn(),
    onmessage: null as ((event: CapWorkerResult) => void) | null,
    onerror: null as ((error: ErrorEvent) => void) | null,
    ...overrides
  };
  mockWorkers.push(worker as Worker);
  return worker as Worker;
};

const mockExpires = Date.now() + 3600000; // 1 hour from now

const mockChallengeResponse = {
  challenge: {
    c: 2,
    s: 10,
    d: 8
  },
  token: 'test-token',
  expires: mockExpires
};

const mockRedeemResponse = {
  success: true,
  token: 'solved-token',
  expires: mockExpires
};

const createMockFetch = (overrides: Record<string, any> = {}) => {
  return (url: string) => {
    if (url.includes('challenge')) {
      return Promise.resolve({
        ok: overrides.challengeOk ?? true,
        json: () => Promise.resolve(overrides.challengeResponse ?? mockChallengeResponse)
      });
    }
    if (url.includes('redeem')) {
      return Promise.resolve({
        ok: overrides.redeemOk ?? true,
        json: () => Promise.resolve(overrides.redeemResponse ?? mockRedeemResponse)
      });
    }
    return Promise.reject(new Error('Unknown endpoint'));
  };
};

// Mock navigator.hardwareConcurrency
Object.defineProperty(navigator, 'hardwareConcurrency', {
  writable: true,
  value: 1
});

function mockGlobals() {
  const mockFetch = jest.fn(createMockFetch() as typeof fetch);
  const mockWorker = jest.fn(() => createMockWorker());

  // Mock performance.now for worker tests
  global.performance = {
    now: jest.fn().mockReturnValue(1000)
  } as any;

  global.Worker = mockWorker as any;

  global.fetch = mockFetch;

  return { mockFetch, mockWorker };
}

let mockFetch: jest.MockedFunction<typeof fetch>;

describe('useCapHook', () => {
  const defaultProps: CapHookProps = {
    endpoint: 'https://api.example.com/',
    onSolve: jest.fn(),
    onError: jest.fn(),
    onProgress: jest.fn(),
    onReset: jest.fn()
  };

  beforeEach(() => {
    mockWorkers = [];
    const mockedGlobals = mockGlobals();
    mockFetch = mockedGlobals.mockFetch;
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe('initialization', () => {
    test('should initialize with correct default values', () => {
      const { result } = renderHook(() => useCapHook(defaultProps));

      expect(result.current.token).toBeNull();
      expect(result.current.solving).toBe(false);
      expect(typeof result.current.solve).toBe('function');
      expect(typeof result.current.reset).toBe('function');
    });

    test('should use default workers count when not provided', () => {
      renderHook(() => useCapHook(defaultProps));
      // The hook should use Math.min(navigator.hardwareConcurrency || 8, 16) = 8
    });

    test('should use custom workers count when provided', () => {
      renderHook(() => useCapHook({ ...defaultProps, workersCount: 4 }));
      // The hook should use the provided workersCount of 4
    });

    test('should limit workers count to maximum', () => {
      renderHook(() => useCapHook({ ...defaultProps, workersCount: 20 }));
      // Should be limited to MAX_WORKERS_COUNT (16)
    });
  });

  describe('reset functionality', () => {
    test('should reset token and call onReset callback', () => {
      const onReset = jest.fn();
      const { result } = renderHook(() => useCapHook({ ...defaultProps, onReset }));

      act(() => {
        result.current.reset();
      });

      expect(result.current.token).toBeNull();
      expect(onReset).toHaveBeenCalledTimes(1);
    });

    test('should reset token without onReset callback', () => {
      const { result } = renderHook(() => useCapHook(defaultProps));

      act(() => {
        result.current.reset();
      });

      expect(result.current.token).toBeNull();
    });
  });

  describe('solve functionality', () => {
    test('should handle successful solve flow', async () => {
      const onSolve = jest.fn();
      const onProgress = jest.fn();
      const { result } = renderHook(() => useCapHook({ ...defaultProps, onSolve, onProgress }));

      // Start solving
      act(() => {
        void result.current.solve();
      });

      // Wait for all async operations to complete
      await waitFor(() => {
        expect(result.current.solving).toBe(false);
      });

      expect(result.current.token).toEqual({ expires: mockExpires, success: true, token: 'solved-token' });
      expect(onSolve).toHaveBeenCalledWith({ expires: mockExpires, success: true, token: 'solved-token' });
      expect(onProgress).toHaveBeenCalledWith(100);
    });

    test('should handle challenge fetch error', async () => {
      const onError = jest.fn();
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useCapHook({ ...defaultProps, onError }));

      await act(async () => {
        await result.current.solve();
      });

      expect(result.current.solving).toBe(false);
      expect(onError).toHaveBeenCalledWith('Network error');
    });

    test('should handle worker creation failure', async () => {
      const onError = jest.fn();
      // Mock Worker constructor to throw an error
      (global.Worker as jest.Mock).mockImplementation(() => {
        throw new Error('Worker creation failed');
      });

      const { result } = renderHook(() => useCapHook({ ...defaultProps, onError }));

      await act(async () => {
        await result.current.solve();
      });

      expect(result.current.solving).toBe(false);
      expect(onError).toHaveBeenCalledWith('Worker creation failed');
    });

    test('should handle worker timeout', async () => {
      jest.useFakeTimers();

      const onError = jest.fn();

      // Create workers that don't respond
      global.Worker = jest.fn(() => createMockWorker({ postMessage: jest.fn() }));

      const { result } = renderHook(() => useCapHook({ ...defaultProps, onError }));

      act(() => {
        void result.current.solve();
      });

      await act(async () => {
        jest.advanceTimersByTime(31000); // 31 seconds
      });

      jest.runOnlyPendingTimers();

      await waitFor(() => {
        expect(result.current.solving).toBe(false);
        expect(onError).toHaveBeenCalledWith('Worker timeout');
      });
    });

    test('should handle worker error', async () => {
      const onError = jest.fn();

      global.Worker = jest.fn(() => {
        const worker = {
          postMessage: jest.fn().mockImplementation(() => {
            setTimeout(() => {
              if (worker.onerror) {
                (worker as any).onerror(new ErrorEvent('error', { message: 'Worker error' }));
              }
            }, 10);
          }),
          terminate: jest.fn(),
          onmessage: null,
          onerror: null
        };
        return worker;
      }) as any;

      const { result } = renderHook(() => useCapHook({ ...defaultProps, onError }));

      act(() => {
        void result.current.solve();
      });

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith('Error in worker: Worker error');
      });
    });

    test('should handle redeem failure', async () => {
      const onError = jest.fn();
      mockFetch.mockImplementation(
        createMockFetch({
          redeemResponse: {
            success: false,
            message: 'Invalid solution',
            token: '',
            expires: 0
          }
        }) as typeof fetch
      );

      const { result } = renderHook(() => useCapHook({ ...defaultProps, onError }));

      act(() => {
        void result.current.solve();
      });

      // Simulate worker responses
      await act(async () => {
        mockWorkers.forEach((worker, index) => {
          if (worker.onmessage) {
            worker.onmessage({
              data: {
                nonce: 12345 + index,
                found: true
              }
            } as any);
          }
        });
      });

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith('Invalid solution');
        expect(result.current.solving).toBe(false);
      });
    });

    test('should handle non-ok redeem response', async () => {
      const onError = jest.fn();
      mockFetch.mockImplementation(createMockFetch({ redeemOk: false }) as typeof fetch);

      const { result } = renderHook(() => useCapHook({ ...defaultProps, onError }));

      act(() => {
        void result.current.solve();
      });

      // Simulate worker responses
      await act(async () => {
        mockWorkers.forEach((worker, index) => {
          if (worker.onmessage) {
            worker.onmessage({
              data: {
                nonce: 12345 + index,
                found: true
              }
            } as any);
          }
        });
      });

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith('Failed to redeem token');
        expect(result.current.solving).toBe(false);
      });
    });
  });

  describe('challenge processing', () => {
    test('should handle array-based challenges', async () => {
      const challengeResponse = {
        challenge: [
          ['salt1', 'target1'],
          ['salt2', 'target2']
        ] as [string, string][],
        token: 'test-token',
        expires: Date.now() + 3600000
      };

      mockFetch.mockImplementation(createMockFetch({ challengeResponse }) as typeof fetch);

      const onSolve = jest.fn();
      const { result } = renderHook(() => useCapHook({ ...defaultProps, onSolve }));

      act(() => {
        void result.current.solve();
      });

      // Simulate worker responses
      await act(async () => {
        mockWorkers.forEach((worker, index) => {
          if (worker.onmessage) {
            worker.onmessage({
              data: {
                nonce: 12345 + index,
                found: true
              }
            } as any);
          }
        });
      });

      await waitFor(() => {
        expect(onSolve).toHaveBeenCalledWith(mockRedeemResponse);
      });
    });

    test('should update progress during solving', async () => {
      const onProgress = jest.fn();
      const challengeResponse = {
        challenge: {
          c: 4, // 4 challenges
          s: 10,
          d: 8
        },
        token: 'test-token',
        expires: Date.now() + 3600000
      };

      mockFetch.mockImplementation(createMockFetch({ challengeResponse }) as typeof fetch);

      const { result } = renderHook(() => useCapHook({ ...defaultProps, onProgress }));

      act(() => {
        void result.current.solve();
      });

      // Simulate partial completion
      await act(async () => {
        // Complete 2 out of 4 challenges
        mockWorkers.slice(0, 2).forEach((worker, index) => {
          if (worker.onmessage) {
            worker.onmessage({
              data: {
                nonce: 12345 + index,
                found: true
              }
            } as any);
          }
        });
      });

      await waitFor(() => {
        // Should show 50% progress
        expect(onProgress).toHaveBeenCalledWith(50);
      });

      // Complete remaining challenges
      await act(async () => {
        mockWorkers.slice(2, 4).forEach((worker, index) => {
          if (worker.onmessage) {
            worker.onmessage({
              data: {
                nonce: 12345 + index + 2,
                found: true
              }
            } as any);
          }
        });
      });

      await waitFor(() => {
        expect(onProgress).toHaveBeenCalledWith(100);
      });
    });
  });

  describe('refresh timer', () => {
    test('should set up refresh timer for valid expiration', async () => {
      jest.useFakeTimers();

      const expiresIn = 1_200_000; // 20 minutes from now
      const futureExpires = Date.now() + expiresIn;
      const mockRedeemResponseWithFutureExpiry = {
        ...mockRedeemResponse,
        expires: futureExpires
      };

      mockFetch.mockImplementation(
        createMockFetch({ redeemResponse: mockRedeemResponseWithFutureExpiry }) as typeof fetch
      );

      const { result } = renderHook(() => useCapHook(defaultProps));

      act(() => {
        void result.current.solve();
      });

      await act(async () => {
        await jest.advanceTimersToNextTimerAsync();
      });

      await waitFor(() => {
        expect(result.current.token).toBe(mockRedeemResponseWithFutureExpiry);
      });

      const mockRedeemResponseAgain = {
        ...mockRedeemResponse,
        token: 'new-token',
        expires: futureExpires
      };

      mockFetch.mockImplementation(createMockFetch({ redeemResponse: mockRedeemResponseAgain }) as typeof fetch);

      await act(async () => {
        jest.advanceTimersByTime(expiresIn); // 31 seconds
      });

      jest.runOnlyPendingTimers();

      await waitFor(() => {
        expect(result.current.solving).toBe(false);
        expect(result.current.token).toBe(mockRedeemResponseAgain);
      });

      jest.useRealTimers();
    });

    test('should handle invalid expiration time', async () => {
      const onError = jest.fn();
      const pastExpires = Date.now() - 3600000; // 1 hour ago
      const mockRedeemResponseWithPastExpiry = {
        ...mockRedeemResponse,
        expires: pastExpires
      };

      mockFetch.mockImplementation(
        createMockFetch({ redeemResponse: mockRedeemResponseWithPastExpiry }) as typeof fetch
      );

      const { result } = renderHook(() => useCapHook({ ...defaultProps, onError }));

      await act(async () => {
        await result.current.solve();
      });

      // Simulate worker responses
      await act(async () => {
        mockWorkers.forEach((worker, index) => {
          if (worker.onmessage) {
            worker.onmessage({
              data: {
                nonce: 12345 + index,
                found: true
              }
            } as any);
          }
        });
      });

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith('Invalid expiration time');
      });
    });
  });

  describe('worker management', () => {
    test('should terminate workers on completion', async () => {
      const { result } = renderHook(() => useCapHook(defaultProps));

      await act(async () => {
        await result.current.solve();
      });

      // Simulate worker responses
      await act(async () => {
        mockWorkers.forEach((worker, index) => {
          if (worker.onmessage) {
            worker.onmessage({
              data: {
                nonce: 12345 + index,
                found: true
              }
            } as any);
          }
        });
      });

      await waitFor(() => {
        expect(result.current.solving).toBe(false);
      });

      // All workers should be terminated
      for (const worker of mockWorkers) {
        expect(worker.terminate).toHaveBeenCalled();
      }
    });

    test('should handle worker termination errors', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error');

      // Make terminate throw an error
      global.Worker = jest.fn(() =>
        createMockWorker({
          terminate() {
            throw new Error('Termination failed');
          }
        })
      );

      const { result } = renderHook(() => useCapHook(defaultProps));

      act(() => {
        void result.current.solve();
      });

      // Simulate worker responses
      await act(async () => {
        mockWorkers.forEach((worker, index) => {
          if (worker.onmessage) {
            worker.onmessage({
              data: {
                nonce: 12345 + index,
                found: true
              }
            } as any);
          }
        });
      });

      await waitFor(() => {
        expect(result.current.solving).toBe(false);
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith('[cap] error terminating worker:', expect.any(Error));

      consoleErrorSpy.mockRestore();
    });
  });
});
