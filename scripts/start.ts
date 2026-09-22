import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// Attachment and inline-image requests must reach the composer. It checks Gmail's
// encoded message size before queueing. Keep an explicit deployment limit if set.
process.env.BODY_SIZE_LIMIT ??= 'Infinity';
await import(pathToFileURL(resolve('build/index.js')).href);
