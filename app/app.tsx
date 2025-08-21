import { useCallback, useEffect, useRef } from 'react';
import { useCap } from '../src/index.ts';
import './app.css';

const App = () => {
  const resetRef = useRef<(() => void) | null>(null);

  const handleError = useCallback((message: string) => {
    resetRef.current?.();
    console.warn('Protection token was cleared.', message);
  }, []);

  const { solve, reset, solving, error, token } = useCap({
    endpoint: import.meta.env.VITE_CAP_ENDPOINT,
    onError: handleError
  });

  resetRef.current = reset;

  useEffect(() => {
    if (!token && !error) {
      void solve();
    }
  }, [solve, token, error]);

  return (
    <div className="cap-container">
      <h1>use-cap</h1>
      <div>Solving: {solving ? 'true' : 'false'}</div>
      <div>Token: {token?.token ?? '???'}</div>
      <div>Expires: {token?.expires ?? '???'}</div>

      <button type="button" onClick={() => reset()}>
        Reset
      </button>
    </div>
  );
};

export default App;
