# Email Check

Email Check is a local SvelteKit application that downloads Gmail messages through `gog`, stores them in SQLite, and uses Jev to classify and raise useful messages.

## Requirements

- Bun
- `gog` with each Gmail account authenticated
- a TypeSafe API key
- a Google Pub/Sub topic and pull subscription; accounts can share them
- Google Application Default Credentials, or `GOOGLE_APPLICATION_CREDENTIALS`, with Pub/Sub subscriber access

Email content is sent to the TypeSafe API for classification.

## Setup

1. Install dependencies.

   ```sh
   bun install
   ```

2. Copy `.env.example` to `.env`. Set `TYPESAFE_API_KEY`, or keep the existing `JEV_API_KEY`.

3. Discover all accounts that are already authenticated in `gog`.

   ```sh
   bun run accounts:discover
   ```

4. After you create a topic and pull subscription, configure each account.

   ```sh
   bun run account:configure -- \
     --account you@example.com \
     --topic projects/PROJECT/topics/TOPIC \
     --subscription projects/PROJECT/subscriptions/SUBSCRIPTION
   ```

5. Register the Gmail watch for each account.

   ```sh
   bun run watch:start -- --account you@example.com
   ```

   To renew all configured watches manually:

   ```sh
   bun run watch:renew
   ```

6. Import existing email. You select the import scope with a Gmail query. The command downloads all matches for that query.

   ```sh
   bun run sync -- --account you@example.com --query "newer_than:30d"
   ```

7. Build and run the web server. The server starts one Pub/Sub listener for each unique configured subscription and renews each configured Gmail watch once every 24 hours while it runs.

   ```sh
   bun run app
   ```

Open `http://127.0.0.1:3000`.

## Install as an app

Open `http://127.0.0.1:3000` in a browser that supports PWA installation. Use the browser's install action to add Email Check to the desktop or home screen.

The service worker caches the application files and each inbox page after you visit it. It does not cache `/api/` requests. A cached inbox page remains available when the server or network is temporarily unavailable. New email and classification still require the local server, `gog`, and network access.

PWA installation requires HTTPS, `localhost`, or `127.0.0.1`. A phone that connects through a plain HTTP LAN address will not meet the browser installation requirement.

## Development

Run the development server. It also runs the Pub/Sub subscribers.

```sh
bun run dev
```

## Verification

```sh
bun run check
bun run test
bun run build
```

The implementation design is in [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md). Future ideas are in [docs/FUTURE_WORK.md](docs/FUTURE_WORK.md).
