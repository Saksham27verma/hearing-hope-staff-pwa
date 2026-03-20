import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { getPendingSync, removePendingSync, type PendingSyncAction } from './offlineStorage';

export type SyncProgressCallback = (action: PendingSyncAction, success: boolean) => void;

export async function processPendingSync(onProgress?: SyncProgressCallback): Promise<void> {
  const queue = await getPendingSync();
  if (queue.length === 0) return;

  for (const action of queue) {
    try {
      if (action.type === 'complete') {
        await updateDoc(doc(db, 'appointments', action.appointmentId), {
          status: 'completed',
          feedback: action.payload.feedback || '',
          updatedAt: serverTimestamp(),
        });
      } else if (action.type === 'cancel') {
        await updateDoc(doc(db, 'appointments', action.appointmentId), {
          status: 'cancelled',
          updatedAt: serverTimestamp(),
        });
      }
      await removePendingSync(action.id);
      onProgress?.(action, true);
    } catch (e) {
      console.warn('Sync failed for action:', action.id, e);
      onProgress?.(action, false);
      break;
    }
  }
}
