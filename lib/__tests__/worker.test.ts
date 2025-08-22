import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type MockedFunction,
  vi
} from 'vitest';
import type { CapWorkerMessage } from '../types.ts';
import '@vitest/web-worker';
import { solve_pow } from '@cap.js/wasm/browser/cap_wasm.js';

// Mock self (Web Worker global)
// const mockPostMessage = vi.fn();

// Mock the dynamic import
vi.mock('@cap.js/wasm/browser/cap_wasm.js', () => ({
  __esModule: true,
  default: vi.fn(() => Promise.resolve()),
  solve_pow: vi.fn()
}));

type MockSelf = {
  onmessage: ((message: any) => Promise<void>) | null;
  onerror: ((error: any) => void) | null;
  postMessage: MockedFunction<(message: any) => void>;
};

function createMockSelf(): MockSelf {
  return {
    onmessage: null,
    onerror: null,
    postMessage: vi.fn()
  };
}

describe('worker', () => {
  let mockSelf: MockSelf;

  beforeAll(async () => {
    // Reset module registry and import fresh
    vi.resetModules();
    mockSelf = createMockSelf();
    global.self = mockSelf as any;

    // Import the worker module after setting up mocks
    await import('../worker');
  });

  beforeEach(() => {
    // Suppress console warnings and errors during tests
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // biome-ignore lint/suspicious/noFocusedTests: just for now
  describe('WASM loading and message handling', () => {
    it('should handle successful proof-of-work solving', async () => {
      vi.mocked(solve_pow).mockImplementation(() => BigInt(12345));

      global.performance = {
        now: vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1050)
      } as any;

      const message: CapWorkerMessage = {
        salt: 'test-salt',
        target: 'test-target'
      };

      await mockSelf.onmessage?.({ data: message });

      expect(mockSelf.postMessage).toHaveBeenCalledWith({
        nonce: 12345,
        found: true,
        durationMs: '50.00'
      });
    });

    it('should handle different performance timing scenarios', async () => {
      vi.mocked(solve_pow).mockImplementation(() => BigInt(54321));

      global.performance = {
        now: vi.fn().mockReturnValueOnce(2000.123).mockReturnValueOnce(2123.456)
      } as any;

      const message: CapWorkerMessage = {
        salt: 'timing-salt',
        target: 'timing-target'
      };

      await mockSelf.onmessage?.({ data: message });

      expect(mockSelf.postMessage).toHaveBeenCalledWith({
        nonce: 54321,
        found: true,
        durationMs: '123.33' // 2123.456 - 2000.123 = 123.333, rounded to 123.33
      });
    });

    it('should handle large BigInt nonce values', async () => {
      const largeBigInt = BigInt('12345678901234567890');
      vi.mocked(solve_pow).mockImplementation(() => largeBigInt);

      global.performance = {
        now: vi.fn().mockReturnValue(1000)
      } as any;

      const message: CapWorkerMessage = {
        salt: 'large-nonce-salt',
        target: 'large-nonce-target'
      };

      await mockSelf.onmessage?.({ data: message });

      expect(mockSelf.postMessage).toHaveBeenCalledWith({
        nonce: Number(largeBigInt), // This will lose precision but matches the implementation
        found: true,
        durationMs: '0.00'
      });
    });

    it('should handle different salt and target combinations', async () => {
      global.performance = {
        now: vi.fn().mockReturnValue(1000)
      } as any;

      const testCases = [
        { salt: '', target: '', expectedNonce: 11111 },
        { salt: 'short', target: '0x123', expectedNonce: 22222 },
        {
          salt: 'very-long-salt-string-with-special-chars-!@#$',
          target: '0xabcdef123456789',
          expectedNonce: 33333
        }
      ];

      for (const testCase of testCases) {
        vi.mocked(solve_pow).mockImplementation(() =>
          BigInt(testCase.expectedNonce)
        );

        await mockSelf.onmessage?.({
          data: { salt: testCase.salt, target: testCase.target }
        });

        expect(mockSelf.postMessage).toHaveBeenCalledWith({
          found: true,
          nonce: testCase.expectedNonce,
          durationMs: '0.00'
        });
      }
    });
  });

  // biome-ignore lint/suspicious/noFocusedTests: just for now
  describe('error handling', () => {
    it('should handle solve_pow function errors with Error objects', async () => {
      const solveError = new Error('Solve POW failed');
      vi.mocked(solve_pow).mockImplementation(() => {
        throw solveError;
      });

      const message: CapWorkerMessage = {
        salt: 'error-salt',
        target: 'error-target'
      };

      await mockSelf.onmessage?.({ data: message });

      expect(mockSelf.postMessage).toHaveBeenCalledWith({
        found: false,
        error: 'Solve POW failed'
      });
    });

    it('should handle non-Error exceptions', async () => {
      vi.mocked(solve_pow).mockImplementation(() => {
        throw 'String error message';
      });

      const message: CapWorkerMessage = {
        salt: 'string-error-salt',
        target: 'string-error-target'
      };

      await mockSelf.onmessage?.({ data: message });

      expect(mockSelf.postMessage).toHaveBeenCalledWith({
        found: false,
        error: 'String error message'
      });
    });

    it('should handle errors without message property', async () => {
      const errorWithoutMessage = { name: 'CustomError', stack: 'stack trace' };
      vi.mocked(solve_pow).mockImplementation(() => {
        throw errorWithoutMessage;
      });

      const message: CapWorkerMessage = {
        salt: 'no-message-error-salt',
        target: 'no-message-error-target'
      };

      await mockSelf.onmessage?.({ data: message });

      expect(mockSelf.postMessage).toHaveBeenCalledWith({
        found: false,
        error: '[object Object]' // String conversion of object
      });
    });

    it('should handle global worker errors via onerror', () => {
      const globalError = 'Global worker error';
      mockSelf.onerror?.(globalError);

      expect(mockSelf.postMessage).toHaveBeenCalledWith({
        found: false,
        error: globalError
      });
    });

    it('should handle complex error objects', async () => {
      const complexError = {
        code: 'WASM_ERROR',
        details: 'Complex error scenario',
        nested: { info: 'additional context' }
      };
      vi.mocked(solve_pow).mockImplementation(() => {
        throw complexError;
      });

      const message: CapWorkerMessage = {
        salt: 'complex-error-salt',
        target: 'complex-error-target'
      };

      await mockSelf.onmessage?.({ data: message });

      expect(mockSelf.postMessage).toHaveBeenCalledWith({
        found: false,
        error: '[object Object]'
      });
    });
  });

  describe('message structure validation', () => {
    it('should handle message with correct structure', async () => {
      vi.mocked(solve_pow).mockImplementation(() => BigInt(12345));

      global.performance = {
        now: vi.fn().mockReturnValue(1000)
      } as any;

      const message = {
        data: {
          salt: 'valid-salt',
          target: 'valid-target'
        }
      };

      await mockSelf.onmessage?.(message);

      expect(mockSelf.postMessage).toHaveBeenCalledWith({
        nonce: 12345,
        found: true,
        durationMs: '0.00'
      });
    });

    it('should handle destructured message parameters', async () => {
      vi.mocked(solve_pow).mockImplementation(() => BigInt(67890));

      global.performance = {
        now: vi.fn().mockReturnValue(1000)
      } as any;

      // Test the exact destructuring pattern used in the worker
      const testMessage = {
        data: { salt: 'destructure-salt', target: 'destructure-target' }
      };

      await mockSelf.onmessage?.(testMessage);

      expect(mockSelf.postMessage).toHaveBeenCalledWith({
        nonce: 67890,
        found: true,
        durationMs: '0.00'
      });
    });
  });

  describe('type conformance', () => {
    it('should produce CapWorkerResult-compliant success responses', async () => {
      vi.mocked(solve_pow).mockImplementation(() => BigInt(123));

      global.performance = {
        now: vi.fn().mockReturnValue(1000)
      } as any;

      await mockSelf.onmessage?.({
        data: { salt: 'type-test', target: 'type-target' }
      });

      expect(mockSelf.postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          nonce: expect.any(Number),
          found: true,
          durationMs: expect.any(String)
        })
      );
    });

    it('should produce CapWorkerResult-compliant error responses', async () => {
      vi.mocked(solve_pow).mockImplementation(() => {
        throw new Error('Test error');
      });

      await mockSelf.onmessage?.({
        data: { salt: 'error-type-test', target: 'error-type-target' }
      });

      expect(mockSelf.postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          found: false,
          error: expect.any(String)
        })
      );
    });
  });
});
