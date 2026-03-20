/**
 * Native app uses Expo push + `staff.pushToken`. Web push needs FCM Web + VAPID and
 * iOS 16.4+; not wired here — staff can use this PWA for appointments; use the
 * Android app if they need push alerts.
 */
export async function setupPushNotifications(): Promise<void> {
  // Intentionally no-op for PWA parity with optional enhancement later.
}
