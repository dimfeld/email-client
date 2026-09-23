import { UNDO_SEND_SECONDS } from '$lib/composer';

export type ToastAction = { label: string; run: () => void };
export type Toast = { id: number; message: string; tone: 'info' | 'error'; action?: ToastAction };

// Toasts use the same window as Undo Send, so every undo in the app lasts equally long.
const TOAST_SECONDS = UNDO_SEND_SECONDS;

let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();
export const toasts = $state<Toast[]>([]);

export function dismissToast(id: number): void {
  clearTimeout(timers.get(id));
  timers.delete(id);
  const index = toasts.findIndex((toast) => toast.id === id);
  if (index >= 0) toasts.splice(index, 1);
}

/** Shows a toast. Errors stay until the user closes them. */
export function showToast(
  message: string,
  options: { tone?: Toast['tone']; action?: ToastAction } = {}
): number {
  const toast: Toast = {
    id: nextId++,
    message,
    tone: options.tone ?? 'info',
    action: options.action,
  };
  toasts.push(toast);
  if (toast.tone !== 'error') {
    timers.set(
      toast.id,
      setTimeout(() => dismissToast(toast.id), TOAST_SECONDS * 1000)
    );
  }
  return toast.id;
}
