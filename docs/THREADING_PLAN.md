# Message threading plan

## Contract

Show one mailbox row for each group of related, locally stored messages. The row's time is the time of the latest nondeleted message in the thread, even when that message is archived or sent. Opening the row shows every stored, nondeleted message in time order, with every body open and clearly separated. The first page of a view must not need to group the whole `emails` table before it can return rows.

Use Gmail's label model. A message has labels, and a view is a label query on threads: Inbox shows threads with a nondeleted member that has `INBOX`, and Sent shows threads with a nondeleted member that has `SENT`. Sync stores All Mail except Spam and Trash, so sent and archived messages are ordinary thread members.

The design must keep account boundaries, Gmail state, and thread actions correct when messages arrive or change later.

## Labels as local state

- `labels_json` is the source of truth for mailbox state. Local actions apply the same label change that they send to Gmail. Archive removes `INBOX`, Unarchive adds it, and Mark read removes `UNREAD`. One local function applies a `{ addLabelIds, removeLabelIds }` change, and `gmail-actions.ts` uses the same change objects for the Gmail request and the local update.
- Remove `archived_at`. Now it duplicates "no `INBOX` label" and can disagree with it: `markArchived` does not remove `INBOX`, and the upsert clears `archived_at` when the content changes, even without `INBOX`. The migration first removes `INBOX` from `labels_json` for every row that has `archived_at` set, and then drops the column. Queries that used `archived_at IS NULL` use the `INBOX` label.
- Keep `deleted_at` for Trash. The FTS triggers and every query already exclude deleted rows. A message that Gmail reports in Spam is also marked deleted locally.
- Add two virtual generated columns as query helpers: `in_inbox` (`instr(labels_json, '"INBOX"') > 0`) and `is_sent` (`instr(labels_json, '"SENT"') > 0`). They are not separate state.

## Thread identity

- Group messages by `(account_email, thread_key)`. Gmail thread IDs from two accounts do not identify one local thread.
- `thread_key` is a virtual generated column on `emails`: `'t:' || thread_id`, or `'m:' || gmail_id` when the message has no thread ID. The `gmail_id` key stays stable when a message is stored again.
- A thread contains the locally stored messages that are not in Trash or Spam (`deleted_at IS NULL`). Do not fetch missing Gmail thread members when a user opens it. Messages older than the sync window are missing unless a historical backfill stored them.
- A thread with no nondeleted members leaves the derived tables.
- Use the parsed message date for time order. If it is missing or invalid, use `first_seen_at`; break ties with the local message ID. Store the normalized time in a plain `sort_time INTEGER` column on `emails`, set by the upsert and filled once by the migration. Do not make it a generated column: it needs the JS date parser, and a generated column that calls an application function breaks tools that open the database without it.

## Storage and first-page queries

`emails` remains the source of truth. Two derived tables hold the thread data that orders views and decides view membership:

```sql
CREATE TABLE threads (
  account_email TEXT NOT NULL,
  thread_key TEXT NOT NULL,
  latest_email_id INTEGER NOT NULL,
  latest_sort_time INTEGER NOT NULL,
  PRIMARY KEY (account_email, thread_key)
) WITHOUT ROWID;

-- One row for each label on at least one nondeleted member.
-- latest_sort_time and latest_email_id copy the thread's values, so every view orders by thread time.
CREATE TABLE thread_labels (
  account_email TEXT NOT NULL,
  thread_key TEXT NOT NULL,
  label TEXT NOT NULL,
  latest_sort_time INTEGER NOT NULL,
  latest_email_id INTEGER NOT NULL,
  PRIMARY KEY (account_email, thread_key, label)
) WITHOUT ROWID;
CREATE INDEX thread_labels_view ON thread_labels(label, latest_sort_time DESC, latest_email_id DESC);
CREATE INDEX thread_labels_view_account
  ON thread_labels(account_email, label, latest_sort_time DESC, latest_email_id DESC);
```

Index `emails(account_email, thread_key, sort_time)` for member lookups, trigger recomputes, and per-row page data.

SQLite triggers on `emails` keep both tables current, as the `email_fts` triggers do. `AFTER INSERT`, `AFTER DELETE`, and `AFTER UPDATE OF thread_id, deleted_at, sort_time, labels_json` (guarded by `WHEN old.<column> IS NOT new.<column>`) recompute the old and new thread keys from their nondeleted members. The recompute replaces the thread's `threads` row and all its `thread_labels` rows (labels from `json_each(labels_json)`), and deletes them when no member remains. Every write path, including bulk updates and migrations, is then covered, and the change is in the same transaction as the write. Classification and category changes do not touch these tables; they only publish `mail`.

The migration adds the columns, fills `sort_time`, moves `archived_at` into `labels_json`, builds both tables once from existing messages, and then creates the triggers. Keep one rebuild function that the migration and tests use; tests check that a rebuild gives the same rows as the triggers. A full rebuild is not part of normal startup.

A view query starts with ordered `thread_labels` rows for its label (`INBOX` or `SENT`). In Inbox, it checks category, Important, Useful, or Pending membership with an indexed lookup for each candidate thread **before** applying the page limit. It then loads row data for the selected threads: the latest member's summary and unread state (a `thread_labels` row for `UNREAD`). It must not run `GROUP BY` over all messages before the limit. Existing links can retain `?message=<local id>`: the selected message resolves to its thread, and the list marks the thread as selected.

The row's sender, snippet, and time come from the latest member, which can be your own reply or an archived message. A new view for another Gmail label later needs only a sidebar entry; it uses the same query.

## Classification and filters

- Classify a received message (`is_sent = 0`) that has `INBOX` when it is stored or when it later gets `INBOX`. This keeps today's classification volume: All Mail sync does not classify archived mail that never entered the inbox. Do not start classification for sent messages. Preserve classification already stored for sent messages during migration, but do not use it for Inbox filters or show it in Sent.
- The current `content_hash` includes labels, so a label-only upsert clears classification. Change it to track the fields used for classification, excluding Gmail labels, and stop passing labels to the classifier. A label change must preserve the category, importance, confidence, action-item and reminder decisions, and extraction data.
- If those content fields change, retain the previous classification while a replacement is pending. Mark `classified_at` null to request another classification; replace the old result only when the new classification succeeds. On failure, keep the old result and record the error. Reclassify a previously classified received message even if it has since left Inbox. A received message without a previous classification remains eligible only after it enters Inbox.
- In the Inbox view, a category, Important, or Useful filter matches when **any** nondeleted classified received member qualifies, including archived members. Pending matches when a nondeleted received member with `INBOX` has no category.
- The category shown in Inbox comes from the latest classified received member. In a category view, the row shows the matched category. Important and Useful use each member's effective importance, including the current category level. Filter counts count distinct threads. Category changes can change filter membership without changing message rows.
- The Sent view has no category or importance filters and no sidebar count.

An indexed `thread_labels` query solves the Inbox first page, but it does not by itself guarantee an early result for a rare category. First implement the membership check with indexed message lookups by thread. Inspect the query plan and measure first-page time on a scratch database with a representative number of messages, thread sizes, categories, and accounts. If the filtered query must scan most thread rows before finding its page, add derived thread-to-filter membership rows indexed by filter, account, and latest time. Keep them current with triggers as well, including triggers on category and category-level changes. This decision must follow the measurement; no assumed mailbox size or latency target is part of the plan.

Load exact sidebar counts through a separate query so their aggregation does not hold up the first page. Refresh them after mail or category changes. Measure their cost separately; use the derived filter membership rows for counts if the simpler count query is too costly.

## Sync

- The Gmail subscriber and the history poll store every fetched message that is not in Trash or Spam, and store it with its Gmail labels. A message with `TRASH` or `SPAM` is marked deleted. Skip a message with `DRAFT`; the app keeps its own drafts, and when Gmail sends a draft, the history reports its label change and the sent message is fetched again. The history parser already collects message IDs from label changes.
- The periodic backfill query becomes `after:…` without `in:inbox`. The Gmail API list excludes Spam and Trash by default.
- The historical backfill stores the labels that Gmail returns and does not call `markArchived`. It classifies only messages that pass the classification rule above. When the local copy of a message has no thread ID, it fetches the message from Gmail instead of using the local copy, so messages that were sent from the app earlier get their thread ID.
- After a send, the composer stores Gmail's returned `threadId` for every mode, not only for replies. Then a new message and the later replies to it share a thread.
- Check on a scratch account that Gmail history reports sent and archived messages for the current watch; if it does not, change the watch so that it does.

## Search

Search the existing FTS index and return one result per matching thread. Rank each result by its best matching message. Use that message for the preview and identify it when the thread opens. Display the thread's latest time, which can differ from the matching message's time. Search covers every stored, nondeleted message, which now includes sent and archived mail in the sync window. Search groups all FTS matches by thread before its page limit; the match set bounds this cost, so the first-page rule does not apply to search. `bm25()` cannot be used inside an aggregate: compute it in a subquery and take the best rank for each thread. A category or importance filter on search results matches any nondeleted classified received member of a matched thread, even if that member did not match the search text. Search counts also count threads.

## Detail pane and navigation

Fetch the selected message's thread members by account and thread key, including archived and sent members. Render them in time order. Give every message a clear boundary and leave every body open. Show a compact sender line for each message, with its time for orientation; show a sent message's sender as the sending account. Show recipients when the address set changes from the preceding message; compare addresses without display names or address order, and include available To and Cc data. Show a subject change when its meaningful text changes; ignore repeated common reply or forward prefixes for this comparison. Show the thread subject once at the top.

Keep Reply, Reply all, Forward, classification details, and remote image controls tied to the message on which they appear. Reply on a sent message addresses its original recipients, as the composer already does. A sent message has no classification details. Keep classification details collapsed. Keyboard list navigation moves between threads. Keyboard reply and forward actions use the latest message unless the user has chosen an action on a specific message. A thread row is unread if any member is unread.

## Thread actions and failure behavior

- Archive removes `INBOX` from every nondeleted member that has it. Delete moves every nondeleted member to Trash, including archived and sent members, as Gmail does for a thread. Opening a thread removes `UNREAD` from every member that has it.
- Resolve thread membership on the server from a selected local message ID. Do not trust a client-supplied list of Gmail IDs.
- Apply each Gmail action and then apply the same label change, or `deleted_at`, to that message locally. If one Gmail request fails, keep completed changes, report the partial result, and refresh the thread. Do not change a failed message locally.
- Undo targets only the message IDs that succeeded in that action. A later reply is not part of that Undo. A reply that arrives after Archive or Delete remains governed by its own Gmail labels.
- A thread leaves a view when no nondeleted member has that view's label. If an action only partly succeeds, show the state that remains.

## Work sequence and proof

1. Move archive state into `labels_json`, add the shared label-change function, and remove `archived_at`. Add `thread_key`, `sort_time`, `in_inbox`, `is_sent`, the derived tables, indexes, triggers, and the migration. Test new messages, upserts, label changes, thread ID changes, archive, delete, undo, and hard deletes, and check that the triggers and the rebuild function give the same rows.
2. Change sync to All Mail except Spam, Trash, and drafts; add the classification rule, preserve existing results across label changes and failed reclassification, and store the composer thread ID. Test both label-only and content changes.
3. Add view, filter, search, count, and detail queries. Use query plans and scratch data to check the first page and decide whether filter membership rows are needed.
4. Change the mailbox row, URL selection, navigation, and detail pane, and add the Sent view to the sidebar. Keep each message's controls attached to that message.
5. Add server thread actions, partial-failure handling, and Undo. Refresh the relevant `mail` data after changes.
6. Verify mixed categories, sent replies from Gmail and from the app, sent-only threads (in Sent, not in Inbox), messages sent to yourself, archived mail that never entered the inbox (stored, not classified), archived latest messages, search hits in older messages, missing dates and thread IDs, cross-account thread IDs, late replies, pagination, and partial Gmail failures. Run the project checks and browser tests against a scratch database and server.

The implementation is complete when Inbox and Sent first pages use the ordered `thread_labels` index, filters and counts follow the rules above, every stored member appears in detail, local label state matches the Gmail outcome of each action, and `archived_at` is gone. Keep query plans and measured first-page times with the implementation evidence.
