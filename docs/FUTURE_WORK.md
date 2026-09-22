# Future work

These ideas are not part of the first MVP. They are possible next steps after normal use shows which workflows need more support.

## Backfill

Periodically check for messages that pubsub may have missed and backfill them.

## Full API support

Add a versioned application API for accounts, messages, categories, classifications, watch health, imports, and future message actions. Keep the API separate from Google API details so other clients do not depend on the local process design.

## Full-text search with BM25

Add SQLite FTS5 indexes for subject, sender, recipients, snippet, and body. Use BM25 ranking for fast local keyword search. Keep the FTS rows in sync with the main email records through explicit repository operations or SQLite triggers.

## Semantic search with dense vectors

Create embeddings for downloaded messages and store dense vectors in a local vector index. Support meaning-based search and combine its score with BM25 for hybrid retrieval. Measure model quality, storage size, and index speed on the real mailbox before selecting an embedding model and vector extension.

## MCP server

Expose safe read operations through an MCP server. Initial tools could list raised messages, search mail, read one stored message, and show account or watcher health. Keep Gmail mutation tools out until their confirmation and safety model is clear.

## Native mobile app

Build a native mobile client after the local API and authentication model are stable. The first mobile version could show raised messages, categories, search results, and classification status. A later version could add notifications and safe Gmail actions.

## Respond to calendar invites

Add a safe workflow for accepting, declining, or marking Google Calendar invites as tentative from the app.

## Agent email search

Given an LLM tools to search through email and ask it questions. The search can find various candidates and then use a
Jev classifier to further select which are relevant to the question.

## UI smoothness and UX improvements

These recommendations come from a review of the inbox page (`src/routes/+page.svelte`), the layout, and the composer. The items in each group start with the change that gives the most benefit.

### Make mail actions feel immediate

- **Remove archived and deleted messages optimistically.** Now, Archive and Delete wait for the Gmail API before the UI changes. Remove the row immediately, then restore it and show the error if the request fails.
- **Go to the next message after Archive or Delete.** Now, the app closes the reading pane (`updateMailboxUrl({ message: null })`). Most mail clients open the next message, so the user can process mail with `E`, `E`, `E`. Keep focus on the reading pane after the move. Now, focus goes to `<body>` because the form is removed.
- **Replace `window.confirm` for Delete with an Undo toast.** Gmail Trash is recoverable, so a confirmation step only slows the user. Show "Moved to Trash · Undo" for some seconds instead. Use the same toast for Archive. Keep the confirmation for the composer "Discard" action, because it cannot be undone.
- **Show success feedback.** The server actions return `message` ("Message archived."), but the page does not show it. Show it in the toast region with `role="status"`.
- **Prevent double submit.** Disable the Archive and Delete buttons while their request runs, and ignore `E` and `#` while an action is in progress.

### Loading and refresh behavior

- **Show pending state during navigation.** The page uses top-level `await` in `$derived` for every query. When the user selects a message, the old message stays on screen with no signal until the new one loads. Use `$effect.pending()` or a `<svelte:boundary>` with a `pending` snippet to dim the reading pane or show a thin progress bar after a short delay.
- **Preload neighbor messages.** When a message opens, start `getSelectedMessage` for the previous and next rows in `visibleEmails`. Then `J` and `K` show the next message without a wait. Also preload a message on row hover, the same as `data-sveltekit-preload-data="hover"` does for links.
- **Refresh only what changed.** The layout calls `refreshAll()` for each server event, window focus, and `email:state` event. This loads the full mail list, categories, calendars, and events again each time. Send the type of change in the SSE event and refresh only the queries that it affects.
- **Keep the list stable when new mail arrives.** A refresh can insert rows above the selected row and move the list under the pointer. Keep the scroll position anchored to the selected or first visible row (for example, with `overflow-anchor` or a manual scroll offset fix). As an alternative, show a "N new messages" bar that the user clicks to insert them.

### Large mailboxes

- **Paginate or virtualize the message list.** `listEmailSummaries` returns every message that is not archived or deleted, and the page renders one DOM row for each. Filter counts also scan the full array once per category on each render. Load pages from the server (cursor on date and id), render only the visible rows, and calculate counts in SQL.
- **Filter on the server.** Send the active category to `getMailList` so the client does not receive rows that it will hide.

### Keyboard and focus

- **Scroll the selected row into view.** `J` and `K` change the selection but do not scroll the list, so the selection can move off screen. Call `scrollIntoView({ block: 'nearest' })` on the selected row.
- **Add a `/` shortcut to focus search**, and let `Escape` in the search field clear it and return focus to the list. Add both to the shortcut dialog.
- **Use a modal `<dialog>` for keyboard shortcuts.** The dialog uses the `open` attribute and a custom backdrop, so focus is not trapped and does not go back to the trigger button on close. Use `showModal()`, the `::backdrop` pseudo-element, and the native `close` event.
- **Give the message list list semantics.** Rows are buttons with `aria-pressed`. A `role="listbox"` with `aria-selected` and roving `tabindex`, or a list of links, gives screen readers correct information. Links also let the user middle-click to open a message in a new tab.

### Readability and accessibility

- **Increase small text sizes.** Some list text is very small: the time is `0.62rem`, the category tag is `0.6rem`, and the rows are `0.75rem`. Use at least `0.75rem` for secondary text and approximately `0.85rem` for sender and subject.
- **Increase contrast for secondary text.** The preview color `#707075` on `#161618` is below the WCAG AA ratio of 4.5:1 for normal text. Other grays such as `#85858b` are near the limit. Check each gray against its background.
- **Increase touch target size on mobile.** List rows are 44px on mobile, which is good. But the icon buttons (`☰`, `⌕`, `×`, and the composer header buttons) are smaller than 44 × 44px. Make the hit area larger without a change to the icon size.
- **Format the message date in the reading pane.** The pane shows the raw `messageDate` string. Use the same `Intl.DateTimeFormat` logic as the list, with the full date and time. Show the raw value in a `title` attribute.
- **Mark messages as read when they open.** Unread rows are bold, but opening a message does not remove the `UNREAD` label. Mark the message as read locally after it shows for a short time, and sync the change to Gmail.

### Layout and visual hierarchy

- **Simplify the masthead.** The masthead has Compose, Drafts, Chat, three navigation links, Shortcuts, and the account picker in one row. Make Compose the only primary button. Now, Compose and Chat use the same `chat-button` style. Move Contacts, Calendar, and Settings into the sidebar or into a menu.
- **Remove the duplicate filter controls.** The tabs "All mail / Important / Useful" and the sidebar filters do the same thing. Keep one set, or make the tabs show only when the sidebar is closed.
- **Make the account picker navigate on the client.** `event.currentTarget.form?.submit()` does not send a `submit` event, so SvelteKit cannot intercept it and the browser does a full page load. Use `requestSubmit()` or `goto()`.
- **Resize HTML messages when their content changes.** The iframe height is set only on `load`. Remote images that load later can change the height and clip the message or add a second scroll bar. Attach a `ResizeObserver` to the iframe document element.
- **Reduce the white flash of HTML messages.** The iframe has a white background in a dark UI. Fade the iframe in after `load`, or put the message in a light "paper" card with padding so the change in color looks intentional.
- **Add a transition between the list and detail views on mobile.** Use the View Transitions API with `onNavigate` for a short slide. Respect `prefers-reduced-motion`.

### Design system

- **Move colors and sizes into CSS custom properties.** The Svelte files contain approximately 340 hard-coded color values. Put them in tokens in one global stylesheet. This makes contrast fixes easier, keeps components consistent, and makes a light theme possible with `prefers-color-scheme`.
- **Use one icon set.** The UI uses text characters (`☰`, `⌕`, `×`, `—`, `↗`, `▾`) as icons. These render differently on each platform and font. Use a small inline SVG icon set with the same stroke width.

### Composer

- **Debounce draft autosave.** Each change starts a save as soon as the previous save completes. This sends many requests while the user types, and the status text changes between "Saving…" and "Unsaved changes" all the time. Save after a short pause in typing, and always save on blur, close, and send.
- **Let the user type during attachment upload.** `fieldset disabled={busy}` disables the editor while files upload. Show upload progress on the attachment row and keep the fields editable.
