import { createStateEvents } from '$lib/server/state-events';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ request }) => createStateEvents(request.signal);
