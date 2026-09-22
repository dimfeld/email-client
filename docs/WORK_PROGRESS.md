# Mail application feature work

## Contract

Update the main mail view to follow the two CleanShot images in `/home/dimfeld`: a dark, compact message list, a reader that opens beside it, and a narrow calendar panel. Keep account and category selection, keyboard controls, message actions, and safe HTML display. The layout must also work on a small screen.

Add local SQLite FTS5 search with BM25 ranking across subject, sender, recipients, and body. Support words, exact phrases (including common words), address or domain filters, and date ranges. Index existing messages and keep the index current as messages change. Search stored mail, including archived mail, but exclude deleted mail.

Add chat with email. The model can search stored messages, read candidates, and use Jev to check relevance. Support follow-up questions, account scope, cancellation, clear errors, and links to source messages. Model tools must be read-only. Treat message content as data, not instructions.

Add accept, tentative, and decline responses for Google Calendar invitations. Show the event, account, and response before the user sends it. Check the current event and attendee at Google, preserve other attendees, and update local state only after success. Explain when an account must reconnect for Calendar write access.

Add a persistent background task for historical Gmail backfill. Accept a Gmail query or date range, show progress, support pause and resume, and resume after restart. Save page progress and handle rate limits without losing the task. Do not run a real backfill as part of testing.

Add a full email composer in a nonmodal popup so the rest of the app remains available. Include durable drafts, rich HTML editing, Markdown-to-HTML shortcuts, contact suggestions, recipients (To/Cc/Bcc), attachments, new mail, reply, reply all, and forward. Compare existing rich text editors before choosing one. Queue sends durably and support Undo Send before the actual send. The owner selected a 10-second Undo Send delay. Test MIME output, draft storage, delayed-send state, and the popup workflow without sending real mail.

Use the existing project structure. Add tests that prove search correctness, chat tool scope and source handling, and calendar response safety. Run the project checks, tests, and build. Check the UI in a browser if browser tools are available. Commit each completed part with `jj`.

## Progress

- [x] Read the future work list, inspect the screenshots, and record the contract.
- [x] Update the main mail UI and check desktop and small-screen layouts.
- [x] Add and test BM25 search, index migration, and filters.
- [x] Add and test email chat and source links.
- [x] Add and test calendar invitation replies.
- [x] Add and test persistent historical email backfill and Settings controls.
- [x] Add and test the popup composer, drafts, contacts, reply/forward, and Undo Send.
- [ ] Update user documentation, run final checks, and commit all task changes.

## Evidence and open items

- Initial working copy has user changes in `docs/FUTURE_WORK.md` and `vite.config.ts`. Preserve these changes.
- No external message or calendar response is needed to test this work. Use mocked providers for mutation tests.

- Tests must never use the production database (user instruction). Browser checks use `/tmp/email-client-check/mail.sqlite`, made with SQLite backup from a read-only source connection. Accounts are disabled and tokens removed in the copy.

- UI: Svelte check passed with no errors or warnings. Playwright checked a 1600 × 1000 inbox and reader, plus a 390 × 844 mobile view. No page errors or horizontal overflow. Screenshots are in `/tmp/email-client-check/`. The calendar uses overlap columns so long events do not cover other events.

- Search: 11 search and database tests passed, including old-database migration, reopen, rank order, exact phrases, HTML-only mail, address/date filters, account scope, archive, update, delete, and restore. Svelte check passed.

- Chat: four mocked tests passed for account scope, deleted mail, partial reads, Jev relevance, follow-up context, verified sources, cancellation, and missing credentials. Svelte check passed. No live model request was required. Search browser checks also passed with no page errors.

- Calendar replies: 19 calendar/API tests passed, including all response values, attendee-only writes, conditional event versions, failed writes, and sync persistence. Svelte check passed. Browser checks confirmed the review step and reconnect error on the isolated fixture; no reply was sent to Google.
- Chat browser check passed: the panel opens, accepts a question, and shows the missing-key error without page errors.

- Historical backfill: five tests passed for durable cursors, database reopen, archive handling, Retry-After, pause during a request, expired page tokens, duplicate suppression, missing messages, concurrent calls, and input errors. Svelte check passed. Request pacing reuses `GOOGLE_SYNC_PAGE_DELAY_MS`; retry waits follow the [Gmail error guide](https://developers.google.com/workspace/gmail/api/guides/handle-errors).
- Composer editor decision: use Tiptap with StarterKit. Its [Svelte integration](https://tiptap.dev/docs/editor/getting-started/install/svelte) and [formatting extensions](https://tiptap.dev/docs/editor/extensions/functionality/starterkit) fit the existing app. Lexical supports HTML and Markdown but needs more integration code for this UI.

- Composer: seven tests passed for durable drafts, stale saves, safe HTML, MIME headers and bodies, attachments and inline images, reply-all recipients, forward attachments, the 10-second queue, Undo Send, restart, concurrent send claims, and uncertain send recovery. All providers were mocked. The browser check passed for contact suggestions, Markdown headings and conversion, inline images, attachments, draft reopen, reading mail while composing, mobile layout, and disconnected-account errors. A mocked queue check confirmed Undo Send and popup state across navigation to Settings.
- Draft autosave exposed a navigation race in background refresh. Refresh now waits until navigation ends. A regression test and the composer browser check passed.
- Historical import browser check passed: saved progress appears, and resume reports the missing account connection without starting a remote import.
