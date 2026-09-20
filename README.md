# Email Check

Email Check is a local SvelteKit application that downloads Gmail messages, Google Contacts, and Google Calendar data through `gog`. It stores the data in SQLite and uses Jev to classify and raise useful messages.

## Requirements

- Bun
- `gog` with each Google account authenticated for Gmail, Calendar, and Contacts
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

2. Copy `.env.example` to `.env`. Set `TYPESAFE_API_KEY`, or keep the existing `JEV_API_KEY`. Set `OPENAI_API_KEY` to enable action item and reminder extraction.

3. Discover all accounts that are already authenticated in `gog`.

   ```sh
   bun run accounts:discover
   ```

   If an account was authorized only for Gmail, authorize it again with the added read-only services. The sync commands also enforce read-only access at runtime.

   ```sh
   gog auth add you@example.com --services gmail,calendar,contacts --readonly
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

7. Sync the Google address book, calendar list, and calendar events for all enabled accounts. Add `--account` to sync only one account.

   ```sh
   bun run sync:google
   bun run sync:google -- --account you@example.com
   ```

8. Build and run the web server. The server starts one Pub/Sub listener for each unique configured subscription, renews each configured Gmail watch once every 24 hours, and runs a Gmail backfill every five minutes while it runs. The first backfill checks the previous hour. Later backfills use each account's saved backfill time with a five-minute overlap.

   ```sh
   bun run app
   ```

Open `http://127.0.0.1:3000`.

Use **Settings → Google data sync** to refresh one account without the command line. **Contacts** shows the local address book and **Calendar** shows the downloaded events. A sync downloads all Contacts pages, all calendars, and all event pages that `gog calendar events` returns. The app replaces an account's local snapshot only after all remote downloads succeed, so a failed download keeps the prior data.

## Live updates

The browser connects to `/api/events` for server-sent events. Mail, classification, account, and category writes in the web server notify connected browsers to fetch current data. The browser also refreshes after reconnecting, returning online, or regaining focus. Background refreshes preserve the selected message and unsaved category fields.

Commands run in separate processes do not send these notifications. Refresh the page after running an external sync or configuration command. Syncs started from Settings refresh open pages automatically.

## Category settings

Open **Settings** from the mailbox to add, edit, or remove categories. Each category has a name, a description, and a level: **Important**, **Useful**, **Other**, or **Auto**. Jev receives the saved name and description for each category when it classifies a message. Settings apply to all accounts and persist in SQLite.

Fixed levels apply to all messages in a category. For **Auto**, Jev makes a second decision for each message: Important, Useful, or Other. **Action needed** starts as Important; other default categories use Auto.

Jev also checks each new message for possible action items and reminders. When either result is positive and `OPENAI_API_KEY` is set, the app uses GPT-5.6 Luna with medium reasoning and Structured Outputs to extract the relevant items. Classification still succeeds if the OpenAI key is absent or extraction fails. Messages classified without an OpenAI key remain pending and are extracted during the next sync or backfill after the key is available.

**All important** shows messages with an effective level of Important. **Useful now** shows Important and Useful messages. Both views respect the selected account. Existing useful/not-useful results migrate to Useful/Other.

Renaming a category keeps existing messages in that category. Fixed level changes apply to existing messages immediately. Name and description changes apply to future classifications; they do not reclassify stored mail. Switching to Auto uses an existing message-level result where available. Messages without a result need another sync to classify their importance.

Removing a category moves its messages to **Needs classification**. They can be classified again on the next import of those messages. If no categories remain, add a category before classifying mail.

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
