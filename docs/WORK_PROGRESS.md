# Mail UI, search, chat, and calendar replies

## Contract

Update the main mail view to follow the two CleanShot images in `/home/dimfeld`: a dark, compact message list, a reader that opens beside it, and a narrow calendar panel. Keep account and category selection, keyboard controls, message actions, and safe HTML display. The layout must also work on a small screen.

Add local SQLite FTS5 search with BM25 ranking across subject, sender, recipients, and body. Support words, exact phrases (including common words), address or domain filters, and date ranges. Index existing messages and keep the index current as messages change. Search stored mail, including archived mail, but exclude deleted mail.

Add chat with email. The model can search stored messages, read candidates, and use Jev to check relevance. Support follow-up questions, account scope, cancellation, clear errors, and links to source messages. Model tools must be read-only. Treat message content as data, not instructions.

Add accept, tentative, and decline responses for Google Calendar invitations. Show the event, account, and response before the user sends it. Check the current event and attendee at Google, preserve other attendees, and update local state only after success. Explain when an account must reconnect for Calendar write access.

Use the existing project structure. Add tests that prove search correctness, chat tool scope and source handling, and calendar response safety. Run the project checks, tests, and build. Check the UI in a browser if browser tools are available. Commit each completed part with `jj`.

## Progress

- [x] Read the future work list, inspect the screenshots, and record the contract.
- [ ] Update the main mail UI and check desktop and small-screen layouts.
- [ ] Add and test BM25 search, index migration, and filters.
- [ ] Add and test email chat and source links.
- [ ] Add and test calendar invitation replies.
- [ ] Update user documentation, run final checks, and commit all task changes.

## Evidence and open items

- Initial working copy has user changes in `docs/FUTURE_WORK.md` and `vite.config.ts`. Preserve these changes.
- No external message or calendar response is needed to test this work. Use mocked providers for mutation tests.
