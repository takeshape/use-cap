export type Challenge = [string, string];

export type ChallengeResponse = {
  challenge:
    | {
        c: number;
        s: number;
        d: number;
      }
    | Challenge[];
  token: string;
  expires: number;
};

export type RedeemResponse = {
  success: boolean;
  message?: string;
  token: string;
  expires: number;
};

export type CapToken = Pick<RedeemResponse, 'token' | 'expires'>;

export type CapHookProps = {
  endpoint: string;
  workersCount?: number;
  localStorageEnabled?: boolean;
  localStorageKey?: string;
  onSolve?: (token: CapToken) => void;
  onError?: (message: string) => void;
  onProgress?: (progress: number) => void;
  onReset?: () => void;
  challengeHeaders?: Record<string, string>;
  redeemHeaders?: Record<string, string>;
  refreshAutomatically?: boolean;
};

export type CapWorkerMessage = {
  salt: string;
  target: string;
};

export type CapWorkerResult = {
  data: {
    nonce: number;
    found: boolean;
    durationMs?: string;
    error?: string;
  };
};
