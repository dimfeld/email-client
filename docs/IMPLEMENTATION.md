# Email Check MVP implementation

## Contract

The application must:

- run locally with Bun and SvelteKit;
- keep Gmail messages in a local SQLite database;
- support more than one authenticated `gog` account;
- consume Gmail notifications with one in-app Pub/Sub listener for each unique subscription;
- route a shared subscription notification to its configured Gmail account;
- classify each stored message with Jev;
- use a fixed category level or ask Jev to classify message importance for Auto categories;
- show useful messages first and group all messages by category;
- include setup commands for accounts, an initial Gmail import, watch registration, and watch consumption;
- have automated tests for the database, Pub/Sub routing, ingestion, and classification boundary.

The application does not create Google Pub/Sub topics or subscriptions. The owner will create them. The application also does not send, delete, archive, or relabel Gmail messages.

## Research findings

### Gmail and `gog`

The SvelteKit server consumes each configured Google Pub/Sub subscription directly. Gmail notifications contain an account email address and a history ID. The server uses the email address to select the correct configured account. If accounts share a subscription, the server still starts only one listener for it.

Each account has its own stored Gmail history cursor. After a notification, the server uses `gog gmail history` to find new message IDs and `gog gmail get` to download each message. The cursor advances only after storage and classification succeed. This keeps retries idempotent. The initial import uses `gog gmail messages search --json --include-body --all` with a Gmail query supplied by the owner. The server also runs `gog gmail watch renew` once every 24 hours for each enabled account with a configured topic. Renewal keeps an existing history cursor unchanged so it cannot skip unprocessed messages.

Sources:

- [Gmail watch](https://gogcli.sh/watch.html)
- [`gogcli` watch implementation document](https://github.com/openclaw/gogcli/blob/main/docs/watch.md)

### Jev

The TypeSafe JavaScript SDK package is `@typesafe-ai/sdk`. A `TypeSafeClient` call to `systemOne` can evaluate multiple independent typed questions against one message state. A Choice result contains the chosen label, its probability distribution, and confidence.

The application first asks Jev to choose a saved category ID. Each choice includes the category name and description. The original category IDs remain the defaults.

A category can have an Important, Useful, Other, or Auto level. For Auto, a second Jev request chooses Important, Useful, or Other for the message. Fixed levels do not require a second request. The mailbox uses the current category level, or the stored message result for Auto. No confidence threshold controls this decision.

The SDK reads `TYPESAFE_API_KEY`. The app will also accept the existing `JEV_API_KEY` name and pass it to the SDK.

Sources:

- [TypeSafe introduction](https://docs.typesafe.ai/introduction)
- [TypeSafe JavaScript SDK](https://docs.typesafe.ai/sdk/javascript)
- [Choice primitive](https://docs.typesafe.ai/primitives/choice)
- [Jev models](https://docs.typesafe.ai/models)

## Design

### Process

The SvelteKit server serves the UI and owns the Pub/Sub listeners. It reads enabled accounts from SQLite and groups them by subscription. The `bun run app` command builds and starts this single process. The `bun run dev` command uses the same subscriber path during development.

### Browser updates

Database writes in the server publish an in-process change signal after the write or transaction completes. `/api/events` sends that signal to each connected browser through server-sent events. Each new connection sends an initial signal to cover updates missed while disconnected. The event contains no mail data.

The root layout invalidates the `app:state` dependency used by mailbox and settings loaders. Refreshes run in sequence, with one pending refresh for changes received during an active fetch. Settings forms retain draft fields during background loads. External command processes require a manual page refresh.

### Data model

`accounts`

- email address, used as the stable account key;
- `gog` client name;
- Pub/Sub topic and subscription names;
- the last successfully processed Gmail history ID;
- the last successful Gmail backfill time for this account;
- enabled state;
- creation and update timestamps.

`categories`

- stable ID, name, description, and level (Important, Useful, Other, or Auto);
- shared across accounts;
- existing IDs are seeded once when the table is created.

`emails`

- account and Gmail message ID, with a unique constraint for idempotency;
- thread ID, headers, date, snippet, text body, body truncation state, and labels;
- category, importance result, model, confidence, probabilities, and classification error;
- first-seen and update timestamps;
- deleted timestamp for Gmail deletion notifications.

Indexes will match the UI query: category and message date. Foreign keys will preserve account ownership.

### Ingestion and failure behavior

The subscriber validates each Pub/Sub payload and matches its email address to an account configured for that subscription. Invalid payloads and notifications for unconfigured accounts are acknowledged as terminal messages. Account work is serialized so two notifications cannot race the same history cursor.

If download, storage, or classification fails, the subscriber does not advance the account history cursor and it rejects the Pub/Sub message for retry. A retry updates the same row because the account and Gmail message ID are unique. If classification fails, the downloaded message remains in SQLite with an error and no final classification.

The server also runs a periodic Gmail search backfill for each enabled account. The first run searches the previous hour. Later runs search from five minutes before that account's last successful backfill time. The backfill stores messages through the same idempotent ingestion path and advances only the account's backfill time after the search and ingestion complete. Rate-limit failures are logged, do not stop other accounts, and leave that account's cursor unchanged for the next run.

### UI

The first view is a compact inbox workspace. It contains:

- an account selector with an `All accounts` option;
- category navigation on the left, a message list in the middle, and message details on the right;
- All important and Useful now filters;
- a settings page for category names, descriptions, and levels;
- sender, subject, account, date, snippet, importance, and classification confidence for each message;
- clear empty and setup states.

No account editor, message actions, search, pagination, or authentication is part of this MVP.

### Security

- API keys stay in `.env` and never reach browser code.
- SQLite files stay under `data/` and are ignored by source control.
- Pub/Sub access uses Google Application Default Credentials or `GOOGLE_APPLICATION_CREDENTIALS`.
- Email content is sent to TypeSafe for classification. This is an explicit product requirement and is documented in setup notes.

## Implementation tasks

- [x] Scaffold Bun and SvelteKit with the Node adapter and TypeScript.
- [x] Add SQLite schema initialization and repository functions.
- [x] Add Jev classification with a replaceable client boundary.
- [x] Add direct Pub/Sub subscribers and idempotent ingestion.
- [x] Add account discovery, account configuration, initial import, and watch setup commands.
- [x] Renew configured Gmail watches once per day while the server runs.
- [x] Periodically backfill Gmail messages for each enabled account.
- [x] Add the category UI with useful messages raised first and account filtering.
- [x] Add setup documentation and environment examples.
- [x] Add automated tests and run type checks, tests, and the production build.

## Proof

The task is complete when:

- the type checker and production build succeed;
- automated tests prove account-scoped idempotent storage, shared-subscription routing, ingestion, and Jev result mapping;
- a local HTTP request renders the application without an error;
- the setup document gives exact commands that the owner can finish after creating the Pub/Sub resources.
