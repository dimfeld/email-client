# Future work

These ideas are not part of the first MVP. They are possible next steps after normal use shows which workflows need more support.

## Backfill

Periodically check for messages that pubsub may have missed and backfill them.

## Full API support

Add a versioned application API for accounts, messages, categories, classifications, watch health, imports, and future message actions. Keep the API separate from `gog` command details so other clients do not depend on the local process design.

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
