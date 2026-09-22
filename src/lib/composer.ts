// The owner requested a 10-second Undo Send delay.
export const UNDO_SEND_SECONDS = 10;
export type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward';
export type DraftStatus = 'draft' | 'queued' | 'sending' | 'sent' | 'failed' | 'uncertain';
export type DraftAttachment = { id: string; filename: string; contentType: string; size: number };
export type Draft = {
  id: string;
  accountEmail: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  html: string;
  text: string;
  mode: ComposeMode;
  sourceEmailId: number | null;
  version: number;
  status: DraftStatus;
  sendAt: number | null;
  error: string | null;
  messageId: string | null;
  updatedAt: string;
  attachments: DraftAttachment[];
};
export type DraftInput = Pick<
  Draft,
  'accountEmail' | 'to' | 'cc' | 'bcc' | 'subject' | 'html' | 'text'
>;
export type ComposeRequest = {
  mode: ComposeMode;
  sourceEmailId?: number;
  account?: string;
  draftId?: string;
  to?: string;
};
export function openComposer(request: ComposeRequest = { mode: 'new' }) {
  window.dispatchEvent(new CustomEvent('email:compose', { detail: request }));
}
