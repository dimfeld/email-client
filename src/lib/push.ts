/** The data in a Web Push message for a new email or a due reminder. The service worker shows it. */
export type PushPayload = {
  title: string;
  body: string;
  /** The app URL that opens the message or to-do. */
  url: string;
  /** A later notification with the same tag replaces the earlier one. */
  tag: string;
};
