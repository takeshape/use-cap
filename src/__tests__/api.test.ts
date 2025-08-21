import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getLocalStorageItem,
  removeLocalStorageItem,
  setLocalStorageItem
} from '../api';
import { EXPIRES_BUFFER_IN_MS } from '../constants';
import type { CapToken } from '../types';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    })
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
});

// Mock console.warn to prevent noise in tests
const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

describe('localStorage functions', () => {
  const testKey = 'test-key';

  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  afterAll(() => {
    consoleSpy.mockRestore();
  });

  describe('setLocalStorageItem', () => {
    it('should store token in localStorage as JSON string', () => {
      const token: CapToken = {
        token: 'test-token-123',
        expires: Date.now() + 60000 // 1 minute from now
      };

      setLocalStorageItem(testKey, token);

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        testKey,
        JSON.stringify(token)
      );
    });

    it('should handle token with different properties', () => {
      const token: CapToken = {
        token: 'another-token',
        expires: 1234567890
      };

      setLocalStorageItem('another-key', token);

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'another-key',
        JSON.stringify(token)
      );
    });
  });

  describe('getLocalStorageItem', () => {
    it('should return null when item does not exist', () => {
      const result = getLocalStorageItem(testKey);

      expect(result).toBeNull();
      expect(localStorageMock.getItem).toHaveBeenCalledWith(testKey);
    });

    it('should return null when item is null', () => {
      localStorageMock.getItem.mockReturnValueOnce(null);

      const result = getLocalStorageItem(testKey);

      expect(result).toBeNull();
    });

    it('should return valid token with fromLocalStorage flag when token is not expired', () => {
      const futureExpiry = Date.now() + EXPIRES_BUFFER_IN_MS + 60000; // Well beyond buffer
      const token: CapToken = {
        token: 'valid-token',
        expires: futureExpiry
      };

      localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(token));

      const result = getLocalStorageItem(testKey);

      expect(result).toEqual({
        ...token,
        fromLocalStorage: true
      });
    });

    it('should return null when token is expired (within buffer)', () => {
      const expiredTime = Date.now() + EXPIRES_BUFFER_IN_MS - 1000; // Within buffer
      const token: CapToken = {
        token: 'expired-token',
        expires: expiredTime
      };

      localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(token));

      const result = getLocalStorageItem(testKey);

      expect(result).toBeNull();
    });

    it('should return null when token is already expired', () => {
      const expiredTime = Date.now() - 60000; // 1 minute ago
      const token: CapToken = {
        token: 'expired-token',
        expires: expiredTime
      };

      localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(token));

      const result = getLocalStorageItem(testKey);

      expect(result).toBeNull();
    });

    it('should return null when stored item is not valid JSON', () => {
      localStorageMock.getItem.mockReturnValueOnce('invalid-json{');

      const result = getLocalStorageItem(testKey);

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(
        '[cap] Failed to parse token from localStorage'
      );
    });

    it('should return null when parsed item is not an object', () => {
      localStorageMock.getItem.mockReturnValueOnce('"string-value"');

      const result = getLocalStorageItem(testKey);

      expect(result).toBeNull();
    });

    it('should return null when parsed item is null', () => {
      localStorageMock.getItem.mockReturnValueOnce('null');

      const result = getLocalStorageItem(testKey);

      expect(result).toBeNull();
    });

    it('should return null when token property is not a string', () => {
      const invalidToken = {
        token: 123, // Should be string
        expires: Date.now() + 60000
      };

      localStorageMock.getItem.mockReturnValueOnce(
        JSON.stringify(invalidToken)
      );

      const result = getLocalStorageItem(testKey);

      expect(result).toBeNull();
    });

    it('should return null when expires property is not a number', () => {
      const invalidToken = {
        token: 'valid-token',
        expires: 'not-a-number' // Should be number
      };

      localStorageMock.getItem.mockReturnValueOnce(
        JSON.stringify(invalidToken)
      );

      const result = getLocalStorageItem(testKey);

      expect(result).toBeNull();
    });

    it('should return null when token is missing required properties', () => {
      const incompleteToken = {
        token: 'valid-token'
        // Missing expires
      };

      localStorageMock.getItem.mockReturnValueOnce(
        JSON.stringify(incompleteToken)
      );

      const result = getLocalStorageItem(testKey);

      expect(result).toBeNull();
    });

    it('should handle edge case where token expires exactly at buffer time', () => {
      const exactBufferTime = Date.now() + EXPIRES_BUFFER_IN_MS;
      const token: CapToken = {
        token: 'edge-case-token',
        expires: exactBufferTime
      };

      localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(token));

      const result = getLocalStorageItem(testKey);

      expect(result).toBeNull();
    });
  });

  describe('removeLocalStorageItem', () => {
    it('should remove item from localStorage', () => {
      removeLocalStorageItem(testKey);

      expect(localStorageMock.removeItem).toHaveBeenCalledWith(testKey);
    });

    it('should handle different keys', () => {
      const key1 = 'key-1';
      const key2 = 'key-2';

      removeLocalStorageItem(key1);
      removeLocalStorageItem(key2);

      expect(localStorageMock.removeItem).toHaveBeenCalledWith(key1);
      expect(localStorageMock.removeItem).toHaveBeenCalledWith(key2);
      expect(localStorageMock.removeItem).toHaveBeenCalledTimes(2);
    });
  });

  describe('integration scenarios', () => {
    it('should handle full workflow: set, get, remove', () => {
      const token: CapToken = {
        token: 'workflow-token',
        expires: Date.now() + 120000 // 2 minutes from now
      };

      // Set the token
      setLocalStorageItem(testKey, token);

      // Get the token
      const retrieved = getLocalStorageItem(testKey);
      expect(retrieved).toEqual({
        ...token,
        fromLocalStorage: true
      });

      // Remove the token
      removeLocalStorageItem(testKey);

      // Verify it's gone
      const afterRemoval = getLocalStorageItem(testKey);
      expect(afterRemoval).toBeNull();
    });

    it('should handle overwriting existing token', () => {
      const token1: CapToken = {
        token: 'first-token',
        expires: Date.now() + 60000
      };
      const token2: CapToken = {
        token: 'second-token',
        expires: Date.now() + 120000
      };

      setLocalStorageItem(testKey, token1);
      setLocalStorageItem(testKey, token2);

      const result = getLocalStorageItem(testKey);
      expect(result?.token).toBe('second-token');
    });
  });
});
