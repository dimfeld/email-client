# Email Check MVP implementation

## Contract

The application must:

- run locally with Bun and SvelteKit;
- keep Gmail messages in a local SQLite database;
- support more than one authenticated `gog` account;
- accept new-message payloads from one `gog gmail watch pull` process for each configured account;
- classify each stored message with Jev;
- mark each message as useful or not useful from the Jev result;
- show useful messages first and group all messages by category;
- include setup commands for accounts, an initial Gmail import, watch registration, and watch consumption;
- have automated tests for the database, webhook ingestion, and classification boundary.

The application does not create Google Pub/Sub topics or subscriptions. The owner will create them. The application also does not send, delete, archive, or relabel Gmail messages.

## Research findings

### Gmail and `gog`

`gog gmail watch pull` is the correct local mode. It consumes a Google Pub/Sub pull subscription and sends a webhook to a local URL. Each process selects a Gmail account with `--account` and a Pub/Sub subscription with `--subscription`.

The webhook payload contains the account, Gmail history ID, deleted message IDs, and messages. Each message can contain the Gmail message and thread IDs, address headers, subject, date, snippet, body, truncation state, and labels. The receiver must be idempotent because Pub/Sub can deliver the same notification again. `gog` does not advance its history cursor when the webhook fails, so the endpoint must return a non-success response when storage or classification fails.

The watcher will use `--include-body`. `gog` applies its documented body-size protection before it sends the webhook. The initial import will use `gog gmail messages search --json --include-body --all` with a Gmail query supplied by the owner.

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

### Processes

The MVP has two long-running local processes:

- the SvelteKit server serves the UI and receives `/api/hooks/gmail` webhook requests;
- the watch manager reads enabled accounts from SQLite and starts one `gog gmail watch pull` child process for each account that has a subscription.

The `bun run app` command starts both processes after a production build. Development can use `bun run dev` and `bun run watch` in separate terminals.

### Data model

`accounts`

- email address, used as the stable account key;
- `gog` client name;
- Pub/Sub topic and subscription names;
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

The webhook validates its optional bearer token, validates the JSON shape, upserts accounts and messages in a transaction, and records deletions. It classifies each new or changed message after storage.

If classification fails, the downloaded message remains in SQLite with an error and no final classification. The endpoint returns a failure so `gog` and Pub/Sub can retry. A retry updates the same row because the account and Gmail message ID are unique.

### UI

The first view is a compact inbox workspace. It contains:

- an account selector with an `All accounts` option;
- a useful section at the top;
- category sections below it;
- sender, subject, account, date, snippet, usefulness, and classification confidence for each message;
- clear empty and setup states.

No account editor, message actions, search, pagination, or authentication is part of this MVP.

### Security

- API keys and webhook tokens stay in `.env` and never reach browser code.
- SQLite files stay under `data/` and are ignored by source control.
- The webhook binds to the local application and can require a bearer token.
- Email content is sent to TypeSafe for classification. This is an explicit product requirement and is documented in setup notes.

## Implementation tasks

- [x] Scaffold Bun and SvelteKit with the Node adapter and TypeScript.
- [x] Add SQLite schema initialization and repository functions.
- [x] Add Jev classification with a replaceable client boundary.
- [x] Add the Gmail webhook and idempotent ingestion.
- [x] Add account discovery, account configuration, initial import, watch setup, and watch manager commands.
- [x] Add the category UI with useful messages raised first and account filtering.
- [x] Add setup documentation and environment examples.
- [x] Add automated tests and run type checks, tests, and the production build.

## Proof

The task is complete when:

- the type checker and production build succeed;
- automated tests prove account-scoped idempotent storage, webhook validation and ingestion, and Jev result mapping;
- a local HTTP request renders the application without an error;
- the setup document gives exact commands that the owner can finish after creating the Pub/Sub resources.
