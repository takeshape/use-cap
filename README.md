# use-cap

A React hook that makes it easy to use the [Cap.js](https://capjs.js.org) proof-of-work
abuse prevention library in React projects.

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

2. Go to the Cap dashboard and get your key ID

3. Create an environment file:

```shell
cp .env.example .env
```

4. Set the Cap endpoint in the .env file

5. Run the development app:

```shell
npm run dev
```
