# Bundles design

## Contract

A bundle is one Inbox row for a group of related threads that arrived recently, for example GitHub notifications or promotions. Opening the bundle shows its threads, and each thread opens as usual. The keyboard moves in and out of a bundle with the same keys that open and close a message: Right arrow or Enter goes in, Left arrow, Escape, or `U` comes out.

Categories control bundles. Each category gets two new settings:

1. **Rules.** A rule matches a message by sender address or domain, by a subject regular expression, or by both. A match puts the message in the rule's category, and replaces the category that Jev chose.
2. **Bundle.** A boolean. When it is on, Inbox shows the category's recent threads as one row, and its older threads as a second row.

The work is complete when these statements are true and tested:

- A rule match sets the message's category. Jev's choice is kept, and it becomes the category again when the rule is removed or stops matching. A rule change does not call Jev.
- In Inbox, two or more threads in a bundled category and the same age group show as one row, across all accounts. The row shows the category, the age group, the thread count, the unread count, recent senders, and the latest time.
- From the list, Right arrow or Enter on a bundle row shows the bundle's threads. Left arrow, Escape, or `U` goes back to the list, with the cursor on the bundle row. From an open message in a bundle, Left arrow goes back to the bundle's thread list, with the cursor on that thread.
- Archive and Delete on a bundle row act on every thread that the row shows. Undo reverses them.
- Existing Inbox, filter, count, search, and thread behavior does not change for categories that do not bundle.

## Terms

- **Thread category.** The category of the thread's latest classified, received, nondeleted member. The Inbox row already shows this category (`mail-list.ts`); bundles use the same value, so a thread is in one bundle at most.
- **Age group.** `recent` when the thread's latest time is in the last 7 days (the length from the request), and `older` otherwise. The boundary moves with the current time: a bundle means "recent related mail", not a fixed period. A new reply moves a thread back to `recent`. The `older` group keeps old threads of a bundled category together, so they do not become separate rows when they leave `recent`.
- **Bundle key.** `(thread category, age group)`, written as `<categoryId>/recent` or `<categoryId>/older`. A bundle contains threads from every account in the view. When the view shows one account, the bundle contains only that account's threads. Threads keep their account boundaries (see `THREADING_PLAN.md`); only the bundle row combines them.

## Category rules

### Storage

```sql
ALTER TABLE categories ADD COLUMN bundle INTEGER NOT NULL DEFAULT 0;

CREATE TABLE category_rules (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  from_pattern TEXT,     -- an address (a@b.com) or a domain (@b.com); case is ignored
  subject_pattern TEXT,  -- JavaScript RegExp source; the `i` flag is added
  CHECK (from_pattern IS NOT NULL OR subject_pattern IS NOT NULL)
);

ALTER TABLE emails ADD COLUMN classifier_category TEXT;  -- Jev's choice
ALTER TABLE emails ADD COLUMN category_rule_id TEXT;     -- the rule that set `category`, or NULL
```

`emails.category` stays the effective category. Because of this, `thread_filters`, its triggers, filter counts, and the category display do not change. The migration copies `category` into `classifier_category` for every classified row.

When a rule has both patterns, both must match. Match `from_pattern` with the address parser that the `from:` search filter uses (`email_search_address`), so display names do not affect the match. Save validates the regular expression and rejects an empty rule.

### Order

Rules are evaluated in category order (the Settings order), then in `position` order. The first match wins. The Settings page shows this order, so the user can see which rule applies.

### When rules apply

- **Classification.** `saveClassification` stores Jev's answer in `classifier_category`, and then evaluates the rules. It sets `category` to the matched rule's category, or to `classifier_category` if no rule matches. All classification paths (ingest, history poll, historical backfill, reclassification) call `saveClassification`, so they all get the rules.
- **Rule or category change.** In one transaction, evaluate the rules again for every received message that has `classifier_category`, and update `category` and `category_rule_id` only where they change. This does not call Jev. The existing `emails_thread_classification` trigger keeps `thread_filters` current. Publish `categories` and `mail`.
- **Category removal.** Remove the category's rules. A message whose rule came from the removed category goes back to `classifier_category`. A message whose `classifier_category` is the removed category is cleared for reclassification, as today.

Jev still runs for rule-matched messages. Its importance, action item, and reminder answers stay useful, and the stored `classifier_category` lets a rule change fall back without a new Jev call.

### Importance

Today the classifier keeps Jev's importance only when Jev's category has the `auto` level. A rule can move a message into an `auto` category, and then the message has no importance. Jev already answers the importance question in the same request for every message, so no extra request is needed: store that answer for every message. A message that a rule moves into an `auto` category then uses Jev's importance. The `effectiveLevel` expression already ignores message importance for fixed-level categories, so filters do not change. This also removes the need to reclassify when a category's level changes to `auto`.

### Classification details

When `category_rule_id` is set, the classification details show "Set by rule" with the rule text, and show Jev's category next to it.

## Mail list

### Which views bundle

Bundles appear only in Inbox without a search. Sent, Snoozed, and search results show threads, as today. In Inbox, the current filter is applied first, and bundling then groups the rows that the filter already selected. A bundle in the Important view contains only the bundle's Important threads.

A thread is bundled when all of these are true:

- It is in the Inbox view's candidate set for the current filter.
- Its thread category has `bundle = 1`.
- It is not starred. Starred threads stay at the top of Inbox as their own rows.

A group with one thread shows as a normal thread row.

### Storage

Add `category TEXT` to `threads`, holding the thread category. The `recompute` statements in `thread-schema.ts` set it, the `emails_thread_classification` trigger updates it, and `rebuildThreads` fills it. Tests must check that the triggers and the rebuild give the same value, as they do for the other derived columns.

The age group is not stored, because it changes with the current time. The list query computes it from `latest_sort_time` and a `recentSince` parameter (the current time minus 7 days). The list response returns `recentSince`, so that later bundle requests and actions use the same boundary as the rows that the user saw.

### Query

The Inbox query keeps its current candidate source (`thread_filters` or `thread_labels`). It adds a row key and groups by it before the page limit:

```sql
WITH candidates AS (<current Inbox candidate query, without LIMIT, plus a `starred` column from `thread_labels`>),
keyed AS (
  SELECT v.*, CASE WHEN c.bundle = 1 AND NOT v.starred
      THEN t.category || CASE WHEN v.latest_sort_time >= :recentSince
        THEN '/recent' ELSE '/older' END END AS bundle_part
  FROM candidates v
  JOIN threads t ON t.account_email = v.account_email AND t.thread_key = v.thread_key
  LEFT JOIN categories c ON c.id = t.category
)
SELECT coalesce(bundle_part, account_email || char(0) || thread_key) AS row_key,
  bundle_part, min(account_email) AS account_email, min(thread_key) AS thread_key,
  count(*) AS thread_count, max(latest_sort_time) AS latest_sort_time,
  max(latest_email_id) AS latest_email_id, max(starred) AS starred
FROM keyed
GROUP BY row_key
ORDER BY starred DESC, latest_sort_time DESC, latest_email_id DESC
LIMIT ?
```

Thread rows load their summaries as today. Bundle rows load their unread thread count and their most recent distinct senders with one indexed query for each bundle row on the page.

This query groups every Inbox candidate before the limit. `THREADING_PLAN.md` does not allow that without evidence. Implement this query first. Then check the query plan and measure first-page time on a scratch database with a representative number of Inbox threads, bundled categories, and accounts. If the first page is too slow, add an index on `threads(category, latest_sort_time)` or a derived table of bundled threads that triggers keep current, as the threading plan did for `thread_filters`. A derived table cannot store the age group, because the age group changes with time. The measurement decides; this design sets no size or time target.

Sidebar counts do not change. They continue to count threads.

### Row type

`MailList.emails` becomes `MailList.rows`, a union. `MailList` also gets `recentSince: number`.

```ts
type MailRow =
  | ({ kind: 'thread' } & EmailSummary)
  | {
      kind: 'bundle';
      key: string; // `${categoryId}/${age}`
      category: string;
      age: 'recent' | 'older';
      threadCount: number;
      unreadCount: number;
      senders: string[];
      latestSortTime: number;
      latestEmailId: number;
    };
```

### Bundle contents

`listBundle(database, { bundle, recentSince, account, filter, limit })` returns the bundle's thread rows with the same row data as Inbox, from all accounts unless `account` is set. It applies the same Inbox candidate query and filter, adds `threads.category = ?`, the age condition, and "not starred", and orders by latest time. Each thread row keeps its account, so thread actions and the reading pane do not change. Server membership comes from the bundle key, not from a list that the client sends.

### Bundle row display

The row shows the bundle icon (add one to `Icon.svelte`), the category name, the age group ("Last 7 days" or "Older"), the thread count, and as many recent senders as fit on the row. The row is bold when `unreadCount > 0`. Use the tokens in `src/app.css`.

## Navigation

### URL

`?bundle=<key>&since=<recentSince>` opens a bundle. `?bundle=<key>&message=<id>` opens a message in that bundle. The `category`, `account`, and `view` parameters keep their meaning. A `?message=` link without `bundle` opens the message as today; the list then marks the bundle row that contains the thread as selected.

### Keyboard

The page has three levels: the Inbox list, the bundle list, and the message. The keys move one level at a time.

| Where                        | Key                     | Result                                                           |
| ---------------------------- | ----------------------- | ---------------------------------------------------------------- |
| Inbox list, bundle row       | Right arrow, Enter, `O` | Open the bundle. The cursor goes to its first thread.            |
| Bundle list                  | `J`, `K`, Down/Up arrow | Move between the bundle's threads.                               |
| Bundle list                  | Right arrow, Enter, `O` | Open the thread, as today.                                       |
| Message opened from a bundle | `J`, `K`                | Open the next or previous thread in the bundle.                  |
| Message opened from a bundle | Left arrow, Escape, `U` | Close the message. The cursor goes to that thread in the bundle. |
| Bundle list, no open message | Left arrow, Escape, `U` | Close the bundle. The cursor goes to the bundle row.             |
| Inbox list, bundle row       | `E`, `#`, Delete        | Archive or delete every thread in the bundle row.                |
| Inbox list, bundle row       | `S`, `R`, `A`, `F`      | No action.                                                       |

In `handleKeydown` in `+page.svelte`, the close branch first closes an open message, and closes the bundle only when no message is open. The open branch reads the focused row's kind: a bundle row opens the bundle, and a thread row opens the message. Focus handling after close uses the same `requestAnimationFrame` step that the message close uses today, with the bundle row's `data-bundle-key` in place of `data-email-id`.

When the last thread in an open bundle leaves it (Archive, Delete, or a refresh), the bundle closes and the cursor goes to the row that took its place.

On phones (the 760 px breakpoint), the bundle list is a separate view between the Inbox list and the message. `onNavigate` compares the depth of the old and new URL (list = 0, bundle = 1, message = 2) to select the slide direction.

## Bundle actions

Archive or Delete on a bundle row sends the bundle key, the list's `recentSince`, and the largest `latestEmailId` that the row showed. The server resolves the bundle's threads in every account in the view, skips threads that have a newer message than that ID, and runs the existing thread action on each remaining thread. Thus a thread that arrives after the list rendered is not archived without the user seeing it. Partial failure, refresh, and Undo work as for thread actions: Undo targets only the message IDs that succeeded.

## Settings

Each category form on the Categories settings page gets:

- A checkbox, "Group into bundles".
- A rules list. Each rule has a "From address or @domain" field and a "Subject matches" field, and a Remove button. An "Add rule" button adds an empty rule.

Save validates each rule, stores the category and its rules in one transaction, applies the rules to stored messages, and publishes `categories` and `mail`.

## Work sequence

1. Schema: `categories.bundle`, `category_rules`, `emails.classifier_category`, `emails.category_rule_id`, and the migration. Keep Jev's importance for all messages.
2. Rule evaluation in `saveClassification`, rule re-application after a rule or category change, and category removal. Test a match, no match, a rule removal, rule order, both patterns, invalid regular expressions, and category removal with rule-set and Jev-set messages.
3. `threads.category` in the triggers and the rebuild, with trigger-versus-rebuild tests.
4. The Inbox row query, `MailRow`, and `listBundle`. Test grouping by category and age group; one bundle for threads from two accounts, and only one account's threads when the view selects that account; starred threads; single-thread groups; filters; the 7-day boundary; and that Sent, Snoozed, and search do not bundle. Check the query plan and measure the first page.
5. Settings UI.
6. Bundle row, bundle list, URL, keyboard, and phone navigation.
7. Bundle Archive and Delete with Undo and partial failure.
8. Browser test against a scratch database and server, as `AGENTS.md` describes: open and close a bundle and a message in it with only the keyboard, on desktop and phone widths.

## Decisions

- **Age groups.** A rolling 7-day boundary, not calendar weeks. Older threads of a bundled category form one `older` bundle. A later option is persistent bundles: a bundle keeps its threads as they age, and new threads start a new bundle. It is not part of this design.
- **Jev on a rule match.** Jev runs for every message. A rule changes only the category. Action item, reminder, and importance answers still come from Jev.
- **Important threads.** A bundle can contain Important threads; nothing special applies to them. In the All view they are inside the bundle row. In the Important view, the bundle row contains only the Important threads. The only importance change is the one in "Importance" above: it keeps rule-matched messages in the Important and Useful filters.
- **Accounts.** One bundle for all accounts in the view.
