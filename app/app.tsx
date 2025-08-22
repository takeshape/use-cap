import { useCallback, useEffect, useRef } from 'react';
// Alternatively, you can import from 'use-cap' instead and use the actual lib
// that will be published, but it is less convenient during development due to
// lack of hmr. Useful for testing whether wasm / worker bundling works as expected.
// import { useCap } from 'use-cap';
import { useCap } from '../lib/use-cap.ts';
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
