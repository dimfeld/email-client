# Future work

These ideas are not part of the first MVP. They are possible next steps after normal use shows which workflows need more support.

## Full API support

Add a versioned application API for accounts, messages, categories, classifications, watch health, imports, and future message actions. Keep the API separate from Google API details so other clients do not depend on the local process design.

## Semantic search with dense vectors

Create embeddings for downloaded messages and store dense vectors in a local vector index. Support meaning-based search and combine its score with BM25 for hybrid retrieval. Measure model quality, storage size, and index speed on the real mailbox before selecting an embedding model and vector extension.

## MCP server

Expose safe read operations through an MCP server. Initial tools could list raised messages, search mail, read one stored message, and show account or watcher health. Keep Gmail mutation tools out until their confirmation and safety model is clear.

## Native mobile app

Build a native mobile client after the local API and authentication model are stable. The first mobile version could show raised messages, categories, search results, and classification status. A later version could add notifications and safe Gmail actions.

## Preload messages before they open

Load the previous and next messages, and the row under the pointer, before the user opens them, so `J`, `K`, and clicks show a message without a wait.

A first attempt kept extra `getSelectedMessage` query proxies alive. It was removed because a message that opened while its own preload request was still in flight never appeared in the reading pane: the page's `await` on the shared cache entry did not get the result. SvelteKit has no supported prefetch API for remote queries. Possible next steps: check a newer SvelteKit version for a fix or a prefetch API, or preload through a separate remote function with its own cache key and use that data only for the first render.
