/** The data in a Web Push message for a new email. The service worker shows it. */
export type EmailPushPayload = {
  title: string;
  body: string;
  /** The app URL that opens the message. */
  url: string;
  /** A later notification with the same tag replaces the earlier one. */
  tag: string;
};
