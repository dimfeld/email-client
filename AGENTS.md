# Agent notes

See `README.md` for setup and `docs/` for design notes.

## Checks

`bun run check`, `bun test`, `bun run format`, `bun run lint`.

Do not run `vite build`, `bun run build`, or `bun run app` in this directory. The production server runs from `build/`, and a build replaces its files.

## Conventions

- Use the tokens in `src/app.css` for colors and sizes, and `src/lib/components/Icon.svelte` for icons.
- Server writes call `publishStateChange(scope)` (`src/lib/state-scopes.ts`). The client refreshes only data for that scope.
- Svelte async mode problems in this app:
  - Read `$derived` values into locals before a per-email loop. Reads inside the loop froze the inbox.
  - Do not read `$effect.pending()` at the `<main>` level. It froze navigation.
  - An `$effect` can run before an async query resolves. To act on a loaded message, use an attachment on the rendered element.

## Browser testing

Never use the production database or server. Pick a free port first (`ss -ltnp`).

```sh
SCRATCH=/path/to/scratch
sqlite3 data/email-check.sqlite ".backup $SCRATCH/test.sqlite"
# Remove Google access, so the subscribers and outbox worker cannot touch real Gmail.
sqlite3 "$SCRATCH/test.sqlite" "
  UPDATE accounts SET google_refresh_token = NULL, subscription = NULL, topic = NULL;
  UPDATE email_drafts SET status = 'draft' WHERE status IN ('queued', 'sending');"
DATABASE_PATH="$SCRATCH/test.sqlite" GOOGLE_APPLICATION_CREDENTIALS=/nonexistent \
  bunx --bun vite dev --port 5199 --strictPort
```

- Do not load `.env`. Restart the dev server after edits to many files, because stale hot-reload state causes false errors.
- For a production build, copy the source to the scratch directory (symlink `node_modules`), build there, and run `bun scripts/start.ts` with `PORT`, `ORIGIN`, and the variables above.
- Gmail actions fail on the copy ("not connected to Google OAuth"). To test the success path, make `runGmailMessageAction` return early in the scratch copy only.
- Stop the server when you finish (`fuser -k 5199/tcp`).
