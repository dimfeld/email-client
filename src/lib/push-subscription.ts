// Browser helpers that connect this device's push subscription to the server.

export type PushSupport = 'supported' | 'unsupported' | 'needs-install';

export function pushSupport(): PushSupport {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
    // iOS gives the Push API only to an app that is on the Home Screen.
    return /iPhone|iPad/.test(navigator.userAgent) && !isStandalone()
      ? 'needs-install'
      : 'unsupported';
  return 'supported';
}

function isStandalone(): boolean {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'supported') return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

async function saveSubscription(subscription: PushSubscription): Promise<void> {
  const response = await fetch('/api/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(subscription.toJSON()),
  });
  if (!response.ok) throw new Error('The server did not save the push subscription.');
}

/** Call from a click. iOS rejects a permission request that does not come from a user action. */
export async function enablePush(publicKey: string): Promise<NotificationPermission> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission;
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: publicKey,
    }));
  await saveSubscription(subscription);
  return permission;
}

export async function disablePush(): Promise<void> {
  const subscription = await currentPushSubscription();
  if (!subscription) return;
  await fetch('/api/push', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  await subscription.unsubscribe();
}

/** The push endpoint can change, and iOS does not reliably tell the service worker. */
export async function resendPushSubscription(): Promise<void> {
  const subscription = await currentPushSubscription();
  if (subscription) await saveSubscription(subscription);
}
