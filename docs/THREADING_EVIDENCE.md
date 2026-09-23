# Threading checks

The scratch query used two accounts. Each account had 3,000 threads with two messages per thread: one Inbox message and one Sent message. Categories, importance values, and pending messages varied across the threads. The query requested 50 rows for one account. These numbers describe this test data; they are not application limits.

| Query                           | First page time |
| ------------------------------- | --------------: |
| Inbox, all                      |         1.19 ms |
| Inbox, category with no matches |         0.13 ms |
| Inbox, Important                |         0.79 ms |
| Inbox, Pending                  |         0.60 ms |
| Exact filter counts             |         2.18 ms |

Before `thread_filters`, the category query checked each candidate thread in `thread_labels`. A category with no matches checked all 3,000 thread rows for that account and took 4.41 ms in the same scratch data. The derived filter rows remove that scan. `EXPLAIN QUERY PLAN` for the category page now reports `thread_filters_view_account (account_email=? AND filter=?)` and a primary key lookup in `thread_labels` for the Inbox label. The unfiltered page starts at `thread_labels_view_account`.

The scratch browser used a separate database and server. It showed one Inbox row for a thread with an Inbox message and a later Sent reply. The detail view showed both bodies in time order. Sent showed that thread and a separate Sent-only thread. The server returned HTTP 200 for Inbox, Sent, and detail routes. In the scratch source copy only, Gmail actions returned success without a network request. Archive removed the thread from Inbox; Undo restored the row, selected the thread, and showed both bodies again.

`bun test`, `bun run check`, and `bun run lint` are the project checks. The tests include trigger and rebuild equality, account boundaries, label changes, search, filters, migration, and partial Gmail failure. A live Gmail account was not available in the scratch database, so Gmail watch behavior was checked from the watch request settings and the mocked history tests.
