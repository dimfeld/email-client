# Email Check

Email Check is a local SvelteKit application that downloads Gmail messages through `gog`, stores them in SQLite, and uses Jev to classify and raise useful messages.

## Requirements

- Bun
- `gog` with each Gmail account authenticated
- a TypeSafe API key
- one Google Pub/Sub topic and pull subscription for each Gmail account
- Google Application Default Credentials, or `GOOGLE_APPLICATION_CREDENTIALS`, with Pub/Sub subscriber access

Email content is sent to the TypeSafe API for classification.

## Setup

1. Install dependencies.

   ```sh
   bun install
   ```

2. Copy `.env.example` to `.env`. Set `TYPESAFE_API_KEY`, or keep the existing `JEV_API_KEY`. Set `GMAIL_HOOK_TOKEN` to a local secret if you want webhook protection.

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

6. Import existing email. You select the import scope with a Gmail query. The command downloads all matches for that query.

   ```sh
   bun run sync -- --account you@example.com --query "newer_than:30d"
   ```

7. Build and run the web server with all configured watchers.

   ```sh
   bun run app
   ```

Open `http://127.0.0.1:3000`.

## Development

Run the web server and watcher in separate terminals:

```sh
bun run dev
```

```sh
APP_URL=http://127.0.0.1:5173 bun run watch
```

## Verification

```sh
bun run check
bun run test
bun run build
```

The implementation design is in [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md). Future ideas are in [docs/FUTURE_WORK.md](docs/FUTURE_WORK.md).
