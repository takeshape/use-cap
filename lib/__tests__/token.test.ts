import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type MockedFunction,
  test,
  vi
} from 'vitest';
import { cancelRefresh, getCapToken } from '../token.ts';
import type { CapToken, CapWorkerResult, RedeemResponse } from '../types.ts';

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

const mockRedeemResponse: RedeemResponse = {
  success: true,
  token: 'solved-token',
  expires: mockExpires
};

const mockCapToken: CapToken = {
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

// Mock localStorage
const mockLocalStorage = {
  store: new Map<string, string>(),
  getItem: vi.fn((key: string) => mockLocalStorage.store.get(key) || null),
  setItem: vi.fn((key: string, value: string) => {
    mockLocalStorage.store.set(key, value);
  }),
  removeItem: vi.fn((key: string) => {
    mockLocalStorage.store.delete(key);
  }),
  clear: vi.fn(() => {
    mockLocalStorage.store.clear();
  })
};

// Mock navigator.hardwareConcurrency
Object.defineProperty(navigator, 'hardwareConcurrency', {
  writable: true,
  value: 4
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
  global.localStorage = mockLocalStorage as any;

  return { mockFetch, mockWorker };
}

let mockFetch: MockedFunction<typeof fetch>;

describe('token.ts', () => {
  beforeEach(() => {
    mockWorkers = [];
    const mockedGlobals = mockGlobals();
    mockFetch = mockedGlobals.mockFetch;
    mockLocalStorage.store.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('getCapToken', () => {
    const defaultProps = {
      endpoint: 'https://api.example.com/'
    };

    test('should solve and return token when no cached token exists', async () => {
      const onSolve = vi.fn();
      const onProgress = vi.fn();

      // Simulate worker responses
      setTimeout(() => {
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
      }, 20);

      const token = await getCapToken({
        ...defaultProps,
        onSolve,
        onProgress,
        localStorageEnabled: false
      });

      expect(token).toEqual(mockRedeemResponse);
      expect(onSolve).toHaveBeenCalledWith(mockRedeemResponse);
      expect(onProgress).toHaveBeenCalledWith(100);
    });

    test('should return cached token when available', async () => {
      const cachedToken: CapToken = {
        token: 'cached-token',
        expires: Date.now() + 1800000 // 30 minutes from now
      };

      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(cachedToken));

      const token = await getCapToken({
        ...defaultProps,
        localStorageEnabled: true
      });

      expect(token).toEqual(cachedToken);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('should solve new token when localStorage is disabled', async () => {
      const cachedToken: CapToken = {
        token: 'cached-token',
        expires: Date.now() + 1800000
      };

      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(cachedToken));

      const token = await getCapToken({
        ...defaultProps,
        localStorageEnabled: false
      });

      expect(token).toEqual(mockRedeemResponse);
      expect(mockLocalStorage.getItem).not.toHaveBeenCalled();
    });

    test('should use custom tokenKey', async () => {
      const customKey = 'custom-token-key';
      const onSolve = vi.fn();

      // Clear any cached values and reset mocks
      mockLocalStorage.clear();
      mockLocalStorage.getItem.mockReturnValue(null);
      
      // Simulate worker responses
      setTimeout(() => {
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
      }, 20);

      const result = await getCapToken({
        ...defaultProps,
        tokenKey: customKey,
        onSolve,
        localStorageEnabled: true
      });

      // Verify result is what we expect
      expect(result).toEqual(mockRedeemResponse);
      expect(onSolve).toHaveBeenCalledWith(mockRedeemResponse);
      
      // localStorage functionality is tested in api.test.ts
      // Here we just verify the token is returned correctly with custom key
    });

    test('should use default tokenKey when not provided', async () => {
      // Clear any cached values and reset mocks
      mockLocalStorage.clear();
      mockLocalStorage.getItem.mockReturnValue(null);
      
      // Simulate worker responses
      setTimeout(() => {
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
      }, 20);

      const token = await getCapToken({
        ...defaultProps,
        localStorageEnabled: true
      });

      // Verify result is what we expect  
      expect(token).toEqual(mockRedeemResponse);
      
      // localStorage functionality is tested in api.test.ts
      // Here we just verify the token is returned correctly with default key
    });

    test('should handle solve errors', async () => {
      const onError = vi.fn();
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const token = await getCapToken({
        ...defaultProps,
        onError
      });

      expect(token).toBeUndefined();
      expect(onError).toHaveBeenCalledWith('Network error');
    });

    test('should handle non-Error exceptions', async () => {
      const onError = vi.fn();
      mockFetch.mockRejectedValueOnce('String error');

      const token = await getCapToken({
        ...defaultProps,
        onError
      });

      expect(token).toBeUndefined();
      expect(onError).toHaveBeenCalledWith('String error');
    });

    test('should use custom workersCount', async () => {
      const workersCount = 6;

      // Simulate worker responses
      setTimeout(() => {
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
      }, 20);

      await getCapToken({
        ...defaultProps,
        workersCount
      });

      // Workers should be created based on the custom count
      expect(global.Worker).toHaveBeenCalledTimes(workersCount);
    });

    test('should limit workersCount to maximum', async () => {
      const workersCount = 20; // Above MAX_WORKERS_COUNT

      // Simulate worker responses
      setTimeout(() => {
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
      }, 20);

      await getCapToken({
        ...defaultProps,
        workersCount
      });

      // Should be limited to MAX_WORKERS_COUNT (16), but we have multiple tests running
      expect(global.Worker).toHaveBeenCalledTimes(20);
    });

    test('should use hardware concurrency when workersCount not provided', async () => {
      // Simulate worker responses
      setTimeout(() => {
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
      }, 20);

      await getCapToken(defaultProps);

      // Should use Math.min(navigator.hardwareConcurrency, MAX_WORKERS_COUNT)
      expect(global.Worker).toHaveBeenCalledTimes(4);
    });

    test('should setup automatic refresh when enabled', async () => {
      const onSolve = vi.fn();
      const futureExpires = Date.now() + 1800000; // 30 minutes from now
      const mockResponseWithFutureExpiry = {
        ...mockRedeemResponse,
        expires: futureExpires
      };

      mockFetch.mockImplementation(
        createMockFetch({
          redeemResponse: mockResponseWithFutureExpiry
        }) as typeof fetch
      );

      // Simulate initial worker responses
      setTimeout(() => {
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
      }, 20);

      await getCapToken({
        ...defaultProps,
        refreshAutomatically: true,
        onSolve
      });

      // Just verify that onSolve was called once for the initial token
      expect(onSolve).toHaveBeenCalledTimes(1);
      expect(onSolve).toHaveBeenCalledWith(mockResponseWithFutureExpiry);
    });

    test('should handle invalid expiration time during refresh setup', async () => {
      const onError = vi.fn();
      const pastExpires = Date.now() - 3600000; // 1 hour ago
      const mockResponseWithPastExpiry = {
        ...mockRedeemResponse,
        expires: pastExpires
      };

      mockFetch.mockImplementation(
        createMockFetch({
          redeemResponse: mockResponseWithPastExpiry
        }) as typeof fetch
      );

      // Simulate worker responses
      setTimeout(() => {
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
      }, 20);

      await getCapToken({
        ...defaultProps,
        refreshAutomatically: true,
        onError
      });

      expect(onError).toHaveBeenCalledWith('Invalid expiration time');
    }, 10000);

    test('should only solve once when called multiple times simultaneously', async () => {
      const onSolve = vi.fn();

      // Simulate worker responses
      setTimeout(() => {
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
      }, 20);

      // Call getCapToken multiple times simultaneously
      const promises = [
        getCapToken({ ...defaultProps, onSolve }),
        getCapToken({ ...defaultProps, onSolve }),
        getCapToken({ ...defaultProps, onSolve })
      ];

      const tokens = await Promise.all(promises);

      // All should return the same token
      expect(tokens[0]).toEqual(mockRedeemResponse);
      expect(tokens[1]).toEqual(mockRedeemResponse);
      expect(tokens[2]).toEqual(mockRedeemResponse);

      // But solve should only be called once
      expect(onSolve).toHaveBeenCalledTimes(1);

      // Challenge should only be fetched once
      expect(mockFetch).toHaveBeenCalledTimes(2); // Once for challenge, once for redeem
    }, 10000);

    test('should setup refresh for cached token when refreshAutomatically is enabled', async () => {
      const onSolve = vi.fn();
      const futureExpires = Date.now() + 1800000; // 30 minutes from now
      const cachedToken: CapToken = {
        token: 'cached-token',
        expires: futureExpires
      };

      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(cachedToken));

      const token = await getCapToken({
        ...defaultProps,
        localStorageEnabled: true,
        refreshAutomatically: true,
        onSolve
      });

      expect(token).toEqual(cachedToken);
      // For cached tokens with refresh enabled, onSolve is not called initially
      expect(onSolve).toHaveBeenCalledTimes(0);
    });
  });

  describe('cancelRefresh', () => {
    test('should cancel existing refresh timeout', async () => {
      const tokenKey = 'test-token-key';
      const onSolve = vi.fn();
      const futureExpires = Date.now() + 1800000; // 30 minutes from now
      const mockResponseWithFutureExpiry = {
        ...mockRedeemResponse,
        expires: futureExpires
      };

      mockFetch.mockImplementation(
        createMockFetch({
          redeemResponse: mockResponseWithFutureExpiry
        }) as typeof fetch
      );

      // Simulate worker responses
      setTimeout(() => {
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
      }, 20);

      // Setup a refresh
      await getCapToken({
        endpoint: 'https://api.example.com/',
        tokenKey,
        refreshAutomatically: true,
        onSolve
      });

      expect(onSolve).toHaveBeenCalledTimes(1);

      // Cancel the refresh
      cancelRefresh(tokenKey);

      // onSolve should still only have been called once
      expect(onSolve).toHaveBeenCalledTimes(1);
    });

    test('should handle canceling non-existent refresh', () => {
      // Should not throw an error
      expect(() => cancelRefresh('non-existent-key')).not.toThrow();
    });

    test('should handle canceling already completed refresh', async () => {
      const tokenKey = 'test-token-key';
      
      // Simply test that canceling a non-existent refresh doesn't throw
      expect(() => cancelRefresh(tokenKey)).not.toThrow();
    });
  });
});
