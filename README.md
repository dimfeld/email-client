# Email Check

Email Check is a local SvelteKit application that downloads Gmail messages, Google Contacts, and Google Calendar data through the Google APIs. It stores the data in SQLite and uses Jev to classify and raise useful messages.

## Requirements

- Bun
- a Google Cloud OAuth client for Gmail, Google Calendar, and Google Contacts
- a TypeSafe API key
- an OpenAI API key if you want action item and reminder extraction
- a Google Pub/Sub topic and pull subscription; accounts can share them
- Google Application Default Credentials, or `GOOGLE_APPLICATION_CREDENTIALS`, with Pub/Sub subscriber access

Email content is sent to the TypeSafe API for classification. Messages that Jev flags for extraction are also sent to OpenAI when `OPENAI_API_KEY` is set.

## Setup

1. Install dependencies.

   ```sh
   bun install
   ```

2. In Google Cloud, enable the Gmail API, Google Calendar API, and People API. Configure the OAuth consent screen. Create an OAuth client and download its JSON file. The app uses this loopback callback:

   ```text
   http://127.0.0.1:3000/auth/google/callback
   ```

3. Copy `.env.example` to `.env`. Set `GOOGLE_OAUTH_CLIENT_FILE` to the downloaded JSON path, and set the API keys that you use. The client ID and secret variables remain available when you do not use a client file. Keep `GOOGLE_OAUTH_REDIRECT_URI` equal to the registered URI. Set `GOOGLE_PROJECT_ID` to select the Pub/Sub project explicitly; if it is empty, the Pub/Sub client uses its normal project discovery.

4. Install and sign in to the Google Cloud CLI with an identity that can create Pub/Sub resources and change their IAM policies. Create the topic and pull subscription. The command enables the Pub/Sub API, creates either resource if it is missing, and grants Gmail and the app access. Use the identity that the app uses for Application Default Credentials or `GOOGLE_APPLICATION_CREDENTIALS`.

   ```sh
   bun run pubsub:setup -- \
     --project YOUR_PROJECT_ID \
     --app-identity user:you@example.com
   ```

   Set `--app-identity` to `user:you@example.com` or `serviceAccount:name@YOUR_PROJECT_ID.iam.gserviceaccount.com`. The default topic and subscription names are both `gmail-agent`. You can set different names with `--topic` and `--subscription`. Set `GOOGLE_PROJECT_ID` in `.env` to the project ID above.

5. Start the development server with `bun run dev`. Open **Settings** and select **Connect Google account** for each account. Google returns you to Settings after you grant access. Reconnect existing accounts if they need the new Google Contacts and Other contacts access.

6. Configure each connected account with the full topic and subscription names.

   ```sh
   bun run account:configure -- \
     --account you@example.com \
     --topic projects/PROJECT/topics/TOPIC \
     --subscription projects/PROJECT/subscriptions/SUBSCRIPTION
   ```

7. Register the Gmail watch for each account.

   ```sh
   bun run watch:start -- --account you@example.com
   ```

   To use a refresh token from an OAuth JSON file instead, pass its path with `--oauth-file`. The file must include `refresh_token`; it can also include `client_id` and `client_secret` (or those values can come from the app's OAuth environment settings).

   ```sh
   bun run watch:start -- --account you@example.com --oauth-file ./oauth.json
   ```

   To renew all configured watches manually:

   ```sh
   bun run watch:renew
   ```

8. Optional: import existing email from **Settings → Historical email import**. Choose an account and, if needed, enter a Gmail query or date range. Leave these fields empty to import all mail from before the task starts. The import runs in the background and resumes after a server restart.

9. Stop the development server and build and start the app. The server loads its Pub/Sub listeners at startup, with one listener for each unique configured subscription. It renews each configured Gmail watch once every 24 hours and runs Gmail and Google data synchronization every five minutes while it runs. The first Gmail backfill checks the previous hour. Later backfills use each account's saved backfill time with a five-minute overlap.

   ```sh
   bun run app
   ```

Open `http://127.0.0.1:3000`.

Use **Settings → Google data sync** to connect or refresh one account immediately. **Contacts** shows the local address book and **Calendar** shows the downloaded events. The first sync downloads all Contacts pages, calendars, and event pages. It stores each page in SQLite staging, replaces an account's local snapshot only after all remote downloads succeed, and resumes from the last stored page after a rate limit. Later syncs use Google sync tokens to download only changed and deleted records. The app performs this incremental sync at startup and every five minutes. An expired token causes a safe full refresh, and a failed download keeps the prior data and token for retry.

## Live updates

The browser connects to `/api/events` for server-sent events. Mail, classification, account, and category writes in the web server notify connected browsers to fetch current data. The browser also refreshes after reconnecting, returning online, or regaining focus. Background refreshes preserve the selected message and unsaved category fields.

Commands run in separate processes do not send these notifications. Refresh the page after running an external sync or configuration command. Syncs started from Settings refresh open pages automatically.

## Category settings

Open **Settings** from the mailbox to add, edit, or remove categories. Each category has a name, a description, and a level: **Important**, **Useful**, **Other**, or **Auto**. Jev receives the saved name and description for each category when it classifies a message. Settings apply to all accounts and persist in SQLite.

Fixed levels apply to all messages in a category. For **Auto**, Jev makes a second decision for each message: Important, Useful, or Other. **Action needed** starts as Important; other default categories use Auto.

Jev also checks each new message for possible action items and reminders. When either result is positive and `OPENAI_API_KEY` is set, the app uses GPT-6 Luna with medium reasoning and Structured Outputs to extract the relevant items. Classification still succeeds if the OpenAI key is absent or extraction fails. Messages classified without an OpenAI key remain pending and are extracted during the next sync or backfill after the key is available.

**All important** shows messages with an effective level of Important. **Useful now** shows Important and Useful messages. Both views respect the selected account. Existing useful/not-useful results migrate to Useful/Other.

Renaming a category keeps existing messages in that category. Fixed level changes apply to existing messages immediately. Name and description changes apply to future classifications; they do not reclassify stored mail. Switching to Auto uses an existing message-level result where available. Messages without a result need another sync to classify their importance.

Removing a category moves its messages to **Needs classification**. They can be classified again on the next import of those messages. If no categories remain, add a category before classifying mail.

## Install as an app

Open `http://127.0.0.1:3000` in a browser that supports PWA installation. Use the browser's install action to add Email Check to the desktop or home screen.

The service worker caches the application files and each inbox page after you visit it. It does not cache `/api/` requests. A cached inbox page remains available when the server or network is temporarily unavailable. New email and classification still require the local server and network access.

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

## Search stored mail

Use the search field in the inbox. Results use BM25 relevance order and include archived mail. Deleted mail is excluded. Search uses the selected account and only messages downloaded to this app.

- `budget approval` requires both words.
- `"to be confirmed"` matches the full phrase, including common words.
- `from:alice@example.com` matches an address; `from:example.com` also matches its subdomains.
- `to:example.com` filters recipients.
- `after:2026-01-01 before:2027-01-01` selects a UTC date range. The start is included; the end is excluded.

The index is created for existing mail when the app opens the database. Message changes update the index in the same database transaction.

## Chat with email

Select **Chat with email** in the inbox. Ask a question, then ask follow-up questions in the same panel. The selected account sets the search scope. Changing accounts starts a new conversation. **Stop** cancels a request; **New chat** clears the conversation.

Set `OPENAI_API_KEY` to enable chat. It uses the existing GPT-6 Luna model by default; set `EMAIL_CHAT_MODEL` to use another Responses model that supports tools and structured output. When `TYPESAFE_API_KEY` is set, the model can ask Jev to check candidate relevance. Chat sends the question, conversation, and retrieved email content to these providers. Conversations remain in browser memory while the panel is open.

Chat can only search and read downloaded mail. Answers include links to messages read during the request. It cannot change messages or send calendar replies. Check the linked messages when you need to confirm a detail.

## Calendar invitation replies

Open an invitation in **Calendar**, choose **Accept**, **Tentative**, or **Decline**, then review the event and account and select **Send response**. Google sends the response notification to the guests. The app shows the confirmed response and keeps it current during Calendar sync.

Existing accounts must reconnect through Settings and grant the new Calendar event write permission. Replies are available for invitations on the connected account's own calendar. The server checks the current attendee and event version before sending. A changed event or failed request leaves the prior local response intact.

## Historical email import

In **Settings → Historical email import**, choose an account, an optional Gmail query, and an optional date range. Empty query and date fields import mail from before the task starts. The end date is excluded. New mail continues through the normal sync process.

The import runs on the server and saves each message and page position. Closing the browser does not stop it. **Pause import** stops after any request in progress. **Resume import** continues from saved progress, including after a server restart. Settings shows downloaded and missing-message counts and any error.

The initial request delay uses the existing Google sync delay of 0.25 seconds. You can increase it. Rate limits and temporary provider failures add an exponential wait, starting at Google's required minimum of one second, and honor `Retry-After` when supplied. There is no total message limit. An expired page token restarts the query and skips messages already processed by the task.

Select **Classify imported messages with Jev** to classify mail during the import. This uses your TypeSafe API account. Otherwise, mail is downloaded and indexed without model calls. Archived mail stays outside the inbox and appears in search. A connection or classification error keeps the task and its progress for review and resume.

## Compose and send email

Select **Compose** in the inbox, select a contact email address, or use **Reply**, **Reply all**, or **Forward** in the reader. The popup stays open when you use other parts of the app. You can minimize or expand it.

The Tiptap editor supports rich text, links, lists, quotes, code, inline images, and file attachments. Type Markdown shortcuts such as `## ` for a heading or use **Insert Markdown** to convert a block of Markdown. Contact suggestions come from the selected account's downloaded address book. Reply all removes duplicate recipients and your connected account addresses. Forward includes the original attachments.

Draft changes save automatically in the local database. **Drafts** opens saved drafts and the outbox. Closing the popup keeps the draft; **Discard** removes it and its attachments. Drafts are local to this app and do not sync to Gmail Drafts.

**Send** queues the message for 10 seconds. Select **Undo Send** during that time to return it to a draft. The server sends queued mail even if you close the browser. Queued mail survives a server restart. Once sending starts, the app cannot recall the message. If the connection fails during sending, use **Check sent status** and check Gmail Sent mail before you return it to a draft. The app does not automatically repeat an uncertain send.

Use `bun run start` to run an existing build, or `bun run app` to build and start. The start script permits attachment requests through the server; the composer checks Gmail's 35 MiB encoded message limit before queueing. An explicit `BODY_SIZE_LIMIT` environment setting still applies if your deployment needs a smaller request limit.
