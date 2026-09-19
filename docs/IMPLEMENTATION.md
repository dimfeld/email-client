# Email Check MVP implementation

## Contract

The application must:

- run locally with Bun and SvelteKit;
- keep Gmail messages in a local SQLite database;
- support more than one authenticated `gog` account;
- consume Gmail notifications with one in-app Pub/Sub listener for each unique subscription;
- route a shared subscription notification to its configured Gmail account;
- classify each stored message with Jev;
- mark each message as useful or not useful from the Jev result;
- show useful messages first and group all messages by category;
- include setup commands for accounts, an initial Gmail import, watch registration, and watch consumption;
- have automated tests for the database, Pub/Sub routing, ingestion, and classification boundary.

The application does not create Google Pub/Sub topics or subscriptions. The owner will create them. The application also does not send, delete, archive, or relabel Gmail messages.

## Research findings

### Gmail and `gog`

The SvelteKit server consumes each configured Google Pub/Sub subscription directly. Gmail notifications contain an account email address and a history ID. The server uses the email address to select the correct configured account. If accounts share a subscription, the server still starts only one listener for it.

Each account has its own stored Gmail history cursor. After a notification, the server uses `gog gmail history` to find new message IDs and `gog gmail get` to download each message. The cursor advances only after storage and classification succeed. This keeps retries idempotent. The initial import uses `gog gmail messages search --json --include-body --all` with a Gmail query supplied by the owner.

Sources:

- [Gmail watch](https://gogcli.sh/watch.html)
- [`gogcli` watch implementation document](https://github.com/openclaw/gogcli/blob/main/docs/watch.md)

### Jev

The TypeSafe JavaScript SDK package is `@typesafe-ai/sdk`. A `TypeSafeClient` call to `systemOne` can evaluate multiple independent typed questions against one message state. A Choice result contains the chosen label, its probability distribution, and confidence.

The application will ask two independent Choice questions in one request:

1. `category`: `action`, `personal`, `work`, `transaction`, `newsletter`, `notification`, `marketing`, or `other`.
2. `usefulness`: `useful` or `not_useful`.

This design does not invent a confidence threshold. The explicit usefulness choice controls whether the UI raises the message. The database still stores the probability and confidence values so later versions can tune behavior from observed data.

The SDK reads `TYPESAFE_API_KEY`. The app will also accept the existing `JEV_API_KEY` name and pass it to the SDK.

Sources:

- [TypeSafe introduction](https://docs.typesafe.ai/introduction)
- [TypeSafe JavaScript SDK](https://docs.typesafe.ai/sdk/javascript)
- [Choice primitive](https://docs.typesafe.ai/primitives/choice)
- [Jev models](https://docs.typesafe.ai/models)

## Design

### Process

The SvelteKit server serves the UI and owns the Pub/Sub listeners. It reads enabled accounts from SQLite and groups them by subscription. The `bun run app` command builds and starts this single process. The `bun run dev` command uses the same subscriber path during development.

### Data model

`accounts`

- email address, used as the stable account key;
- `gog` client name;
- Pub/Sub topic and subscription names;
- the last successfully processed Gmail history ID;
- enabled state;
- creation and update timestamps.

`emails`

- account and Gmail message ID, with a unique constraint for idempotency;
- thread ID, headers, date, snippet, text body, body truncation state, and labels;
- category, usefulness result, model, confidence, probabilities, and classification error;
- first-seen and update timestamps;
- deleted timestamp for Gmail deletion notifications.

Indexes will match the UI query: useful state, category, and message date. Foreign keys will preserve account ownership.

### Ingestion and failure behavior

The subscriber validates each Pub/Sub payload and matches its email address to an account configured for that subscription. Invalid payloads and notifications for unconfigured accounts are acknowledged as terminal messages. Account work is serialized so two notifications cannot race the same history cursor.

If download, storage, or classification fails, the subscriber does not advance the account history cursor and it rejects the Pub/Sub message for retry. A retry updates the same row because the account and Gmail message ID are unique. If classification fails, the downloaded message remains in SQLite with an error and no final classification.

### UI

The first view is a compact inbox workspace. It contains:

- an account selector with an `All accounts` option;
- a useful section at the top;
- category sections below it;
- sender, subject, account, date, snippet, usefulness, and classification confidence for each message;
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
- [x] Add the category UI with useful messages raised first and account filtering.
- [x] Add setup documentation and environment examples.
- [x] Add automated tests and run type checks, tests, and the production build.

## Proof

The task is complete when:

- the type checker and production build succeed;
- automated tests prove account-scoped idempotent storage, shared-subscription routing, ingestion, and Jev result mapping;
- a local HTTP request renders the application without an error;
- the setup document gives exact commands that the owner can finish after creating the Pub/Sub resources.
