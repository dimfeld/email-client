import type { StateScope } from './state-scopes';

type StateChangeDetail = { scopes: Set<StateScope>; waitFor: Promise<unknown>[] };
const eventName = 'email:changed';

/** Tells pages with remote queries which scopes changed, and waits for their refreshes. */
export async function dispatchStateChange(scopes: Set<StateScope>): Promise<void> {
  const detail: StateChangeDetail = { scopes, waitFor: [] };
  window.dispatchEvent(new CustomEvent(eventName, { detail }));
  await Promise.all(detail.waitFor);
}

/** Calls `refresh` for each state change. The dispatcher waits for the returned promise. */
export function onStateChange(refresh: (scopes: Set<StateScope>) => Promise<unknown>): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<StateChangeDetail>).detail;
    detail.waitFor.push(refresh(detail.scopes));
  };
  window.addEventListener(eventName, listener);
  return () => window.removeEventListener(eventName, listener);
}
