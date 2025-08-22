import { renderHook, waitFor } from '@testing-library/react';
import { act } from 'react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type Mock,
  type MockedFunction,
  test,
  vi
} from 'vitest';
import type { CapHookProps, CapWorkerResult } from '../types.ts';
import { useCap } from '../use-cap.ts';

// Mock Worker
let mockWorkers: Array<Worker> = [];

const createMockWorker = (overrides?: Partial<Worker>) => {
  const worker: Partial<Worker> = {
    postMessage: vi.fn().mockImplementation(() => {
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
    terminate: vi.fn(),
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
        json: () =>
          Promise.resolve(overrides.challengeResponse ?? mockChallengeResponse)
      });
    }
    if (url.includes('redeem')) {
      return Promise.resolve({
        ok: overrides.redeemOk ?? true,
        json: () =>
          Promise.resolve(overrides.redeemResponse ?? mockRedeemResponse)
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
  const mockFetch = vi.fn(createMockFetch() as typeof fetch);
  const mockWorker = vi.fn(() => createMockWorker());

  // Mock performance.now for worker tests
  global.performance = {
    now: vi.fn().mockReturnValue(1000)
  } as any;

  global.Worker = mockWorker as any;

  global.fetch = mockFetch;

  return { mockFetch, mockWorker };
}

let mockFetch: MockedFunction<typeof fetch>;

describe('useCapHook', () => {
  const defaultProps: CapHookProps = {
    endpoint: 'https://api.example.com/',
    onSolve: vi.fn(),
    onError: vi.fn(),
    onProgress: vi.fn(),
    onReset: vi.fn(),
    localStorageEnabled: false
  };

  beforeEach(() => {
    mockWorkers = [];
    const mockedGlobals = mockGlobals();
    mockFetch = mockedGlobals.mockFetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('initialization', () => {
    test('should initialize with correct default values', () => {
      const { result } = renderHook(() => useCap(defaultProps));

      expect(result.current.token).toBeNull();
      expect(result.current.solving).toBe(false);
      expect(typeof result.current.solve).toBe('function');
      expect(typeof result.current.reset).toBe('function');
    });

    test('should use default workers count when not provided', () => {
      renderHook(() => useCap(defaultProps));
      // The hook should use Math.min(navigator.hardwareConcurrency || 8, 16) = 8
    });

    test('should use custom workers count when provided', () => {
      renderHook(() => useCap({ ...defaultProps, workersCount: 4 }));
      // The hook should use the provided workersCount of 4
    });

    test('should limit workers count to maximum', () => {
      renderHook(() => useCap({ ...defaultProps, workersCount: 20 }));
      // Should be limited to MAX_WORKERS_COUNT (16)
    });
  });

  describe('reset functionality', () => {
    test('should reset token and call onReset callback', async () => {
      const onReset = vi.fn();
      const { result } = renderHook(() => useCap({ ...defaultProps, onReset }));

      result.current.reset();

      expect(result.current.token).toBeNull();
      expect(onReset).toHaveBeenCalledTimes(1);
    });

    test('should reset token without onReset callback', () => {
      const { result } = renderHook(() => useCap(defaultProps));

      result.current.reset();

      expect(result.current.token).toBeNull();
    });
  });

  describe('solve functionality', () => {
    test('should handle successful solve flow', async () => {
      const onSolve = vi.fn();
      const onProgress = vi.fn();
      const { result } = renderHook(() =>
        useCap({ ...defaultProps, onSolve, onProgress })
      );

      // Start solving
      void result.current.solve();

      // Wait for all async operations to complete
      await waitFor(() => {
        expect(result.current.solving).toBe(false);
        expect(result.current.token).toEqual({
          expires: mockExpires,
          success: true,
          token: 'solved-token'
        });
        expect(onSolve).toHaveBeenCalledWith({
          expires: mockExpires,
          success: true,
          token: 'solved-token'
        });
        expect(onProgress).toHaveBeenCalledWith(100);
      });
    });

    test('should handle challenge fetch error', async () => {
      const onError = vi.fn();
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useCap({ ...defaultProps, onError }));

      await result.current.solve();

      expect(result.current.solving).toBe(false);
      expect(onError).toHaveBeenCalledWith('Network error');
    });

    test('should handle worker creation failure', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const onError = vi.fn();
      // Mock Worker constructor to throw an error
      (global.Worker as Mock).mockImplementation(() => {
        throw new Error('Worker creation failed');
      });

      const { result } = renderHook(() => useCap({ ...defaultProps, onError }));

      await result.current.solve();

      expect(result.current.solving).toBe(false);
      expect(onError).toHaveBeenCalledWith('Worker creation failed');
    });

    test('should handle worker timeout', async () => {
      vi.useFakeTimers({
        shouldAdvanceTime: true
      });

      const onError = vi.fn();

      // Create workers that don't respond
      global.Worker = vi.fn(() => createMockWorker({ postMessage: vi.fn() }));

      const { result } = renderHook(() =>
        useCap({ ...defaultProps, refreshAutomatically: false, onError })
      );

      void result.current.solve();

      await act(async () => {
        vi.advanceTimersByTime(31000); // 31 seconds
      });

      vi.runOnlyPendingTimers();

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith('Worker timeout');
        expect(result.current.solving).toBe(false);
      });

      vi.useRealTimers();
    });

    test('should handle worker error', async () => {
      const onError = vi.fn();

      global.Worker = vi.fn(() => {
        const worker = {
          postMessage: vi.fn().mockImplementation(() => {
            setTimeout(() => {
              if (worker.onerror) {
                (worker as any).onerror(
                  new ErrorEvent('error', { message: 'Worker error' })
                );
              }
            }, 10);
          }),
          terminate: vi.fn(),
          onmessage: null,
          onerror: null
        };
        return worker;
      }) as any;

      const { result } = renderHook(() => useCap({ ...defaultProps, onError }));

      act(() => {
        void result.current.solve();
      });

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith('Error in worker: Worker error');
      });
    });

    test('should handle redeem failure', async () => {
      const onError = vi.fn();
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

      const { result } = renderHook(() => useCap({ ...defaultProps, onError }));

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
      const onError = vi.fn();
      mockFetch.mockImplementation(
        createMockFetch({ redeemOk: false }) as typeof fetch
      );

      const { result } = renderHook(() => useCap({ ...defaultProps, onError }));

      await act(async () => {
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

      mockFetch.mockImplementation(
        createMockFetch({ challengeResponse }) as typeof fetch
      );

      const onSolve = vi.fn();
      const { result } = renderHook(() => useCap({ ...defaultProps, onSolve }));

      void result.current.solve();

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
      const onProgress = vi.fn();
      const challengeResponse = {
        challenge: {
          c: 4, // 4 challenges
          s: 10,
          d: 8
        },
        token: 'test-token',
        expires: Date.now() + 3600000
      };

      mockFetch.mockImplementation(
        createMockFetch({ challengeResponse }) as typeof fetch
      );

      const { result } = renderHook(() =>
        useCap({ ...defaultProps, onProgress })
      );

      void result.current.solve();

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

      // // Complete remaining challenges
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
      const expiresIn = 1_200_000; // 20 minutes from now
      const futureExpires = Date.now() + expiresIn;
      const mockRedeemResponseWithFutureExpiry = {
        ...mockRedeemResponse,
        expires: futureExpires
      };

      mockFetch.mockImplementation(
        createMockFetch({
          redeemResponse: mockRedeemResponseWithFutureExpiry
        }) as typeof fetch
      );

      const { result } = renderHook(() => useCap(defaultProps));

      // We only need fake timers so we can jump ahead, so this works well
      vi.useFakeTimers({
        shouldAdvanceTime: true
      });

      void result.current.solve();

      await waitFor(() => {
        expect(result.current.token).toBe(mockRedeemResponseWithFutureExpiry);
      });

      const mockRedeemResponseAgain = {
        ...mockRedeemResponse,
        token: 'new-token',
        expires: futureExpires
      };

      mockFetch.mockImplementation(
        createMockFetch({
          redeemResponse: mockRedeemResponseAgain
        }) as typeof fetch
      );

      vi.advanceTimersByTime(expiresIn); // 31 seconds

      await waitFor(() => {
        expect(result.current.solving).toBe(false);
        expect(result.current.token).toBe(mockRedeemResponseAgain);
      });

      vi.useRealTimers();
    });

    test('should handle invalid expiration time', async () => {
      const onError = vi.fn();
      const pastExpires = Date.now() - 3_600_000; // 1 hour ago
      const mockRedeemResponseWithPastExpiry = {
        ...mockRedeemResponse,
        expires: pastExpires
      };

      mockFetch.mockImplementation(
        createMockFetch({
          redeemResponse: mockRedeemResponseWithPastExpiry
        }) as typeof fetch
      );

      const { result } = renderHook(() => useCap({ ...defaultProps, onError }));

      await result.current.solve();

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

      expect(onError).toHaveBeenCalledWith('Invalid expiration time');
    });
  });

  describe('worker management', () => {
    test('should terminate workers on completion', async () => {
      const { result } = renderHook(() => useCap(defaultProps));

      await result.current.solve();

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
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      // Make terminate throw an error
      global.Worker = vi.fn(() =>
        createMockWorker({
          terminate() {
            throw new Error('Termination failed');
          }
        })
      );

      const { result } = renderHook(() => useCap(defaultProps));

      void result.current.solve();

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

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[cap] error terminating worker:',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });
});
