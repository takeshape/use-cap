# use-cap

A React hook that makes it easy to use the [Cap.js](https://capjs.js.org) proof-of-work
abuse prevention library in React projects.

## Rationale

This hook adapts and implements the Cap.js
[widget](https://github.com/tiagorangel1/cap/blob/main/widget/src/src/cap.js)
and [worker](https://github.com/tiagorangel1/cap/blob/main/widget/src/src/worker.js)
code and interfaces to make them easier to use in a React application where
more control over the UI and implementation are desired. The adapted code
replaces the need for workarounds that reference the global Cap.js instance
that the widget creates.

## Installation and use

```shell
npm i use-cap
```

Below is usage similar to [invisible mode](https://capjs.js.org/guide/invisible.html).

```js
import { useEffect } from 'react';
import { useCap } from 'use-cap';

function MyComponent() {
  const { solve, reset, solving, progress, error, token } = useCap({
    endpoint: "https://my-cap-server.com/api/",
  });

  useEffect(() => {
    if (!token && !error) {
      void solve();
    }
  }, [solve, token, error]);

  return (
    <form onSubmit>
      <h1>use-cap</h1>
      <div>Solving: {solving ? 'true' : 'false'}</div>
      <div>Progress: {progress ?? '???'}</div>
      <div>Token: {token?.token ?? '???'}</div>
      <div>Expires: {token?.expires ?? '???'}</div>

      <button type="button" onClick={() => reset()}>
        Reset
      </button>
    </div>
  );
}
```

## Development

1. Run a [Cap.js standalone server](https://capjs.js.org/guide/standalone.html):

```shell
docker run -d \
  -p 3000:3000 \
  -v cap-data:/usr/src/app/.data \
  -e ADMIN_KEY=your_secret_key_must_be_30_chars \
  --name cap-standalone \
  tiago2/cap:latest
```

2. Go to the Cap dashboard and get your Site Key

3. Create an environment file:

```shell
cp .env.example .env
```

4. Set the Cap endpoint in the `.env` file

5. Run the development app:

```shell
npm run dev
```

## Related & Prior Art

- [Cap](https://github.com/tiagorangel1/cap)
- [Cap React Widget](https://codeberg.org/pitininja/cap-react-widget)
