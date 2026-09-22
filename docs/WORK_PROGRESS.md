# Mail UI, search, chat, and calendar replies

## Contract

Update the main mail view to follow the two CleanShot images in `/home/dimfeld`: a dark, compact message list, a reader that opens beside it, and a narrow calendar panel. Keep account and category selection, keyboard controls, message actions, and safe HTML display. The layout must also work on a small screen.

Add local SQLite FTS5 search with BM25 ranking across subject, sender, recipients, and body. Support words, exact phrases (including common words), address or domain filters, and date ranges. Index existing messages and keep the index current as messages change. Search stored mail, including archived mail, but exclude deleted mail.

Add chat with email. The model can search stored messages, read candidates, and use Jev to check relevance. Support follow-up questions, account scope, cancellation, clear errors, and links to source messages. Model tools must be read-only. Treat message content as data, not instructions.

Add accept, tentative, and decline responses for Google Calendar invitations. Show the event, account, and response before the user sends it. Check the current event and attendee at Google, preserve other attendees, and update local state only after success. Explain when an account must reconnect for Calendar write access.

Add a persistent background task for historical Gmail backfill. Accept a Gmail query or date range, show progress, support pause and resume, and resume after restart. Save page progress and handle rate limits without losing the task. Do not run a real backfill as part of testing.

Use the existing project structure. Add tests that prove search correctness, chat tool scope and source handling, and calendar response safety. Run the project checks, tests, and build. Check the UI in a browser if browser tools are available. Commit each completed part with `jj`.

## Progress

- [x] Read the future work list, inspect the screenshots, and record the contract.
- [x] Update the main mail UI and check desktop and small-screen layouts.
- [x] Add and test BM25 search, index migration, and filters.
- [ ] Add and test email chat and source links.
- [ ] Add and test calendar invitation replies.
- [ ] Add and test persistent historical email backfill and Settings controls.
- [ ] Update user documentation, run final checks, and commit all task changes.

## Evidence and open items

- Initial working copy has user changes in `docs/FUTURE_WORK.md` and `vite.config.ts`. Preserve these changes.
- No external message or calendar response is needed to test this work. Use mocked providers for mutation tests.

- Tests must never use the production database (user instruction). Browser checks use `/tmp/email-client-check/mail.sqlite`, made with SQLite backup from a read-only source connection. Accounts are disabled and tokens removed in the copy.

- UI: Svelte check passed with no errors or warnings. Playwright checked a 1600 × 1000 inbox and reader, plus a 390 × 844 mobile view. No page errors or horizontal overflow. Screenshots are in `/tmp/email-client-check/`. The calendar uses overlap columns so long events do not cover other events.

- Search: 11 search and database tests passed, including old-database migration, reopen, rank order, exact phrases, HTML-only mail, address/date filters, account scope, archive, update, delete, and restore. Svelte check passed.
