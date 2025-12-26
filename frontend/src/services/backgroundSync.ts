import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { syncQueue } from './syncQueue';

const BACKGROUND_SYNC_TASK = 'BACKGROUND_SYNC_TASK';

/**
 * Define the background task.
 */
TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  try {
    console.log('Background sync task started');
    const result = await syncQueue.performFullSync();
    console.log('Background sync task completed:', result);

    return result.pushed > 0 || result.pulled > 0
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch (error) {
    console.error('Background sync task failed:', error);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

/**
 * Register the background sync task.
 */
export const registerBackgroundSync = async () => {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK);
    if (isRegistered) {
      console.log('Background sync task already registered');
      return;
    }

    await BackgroundFetch.registerTaskAsync(BACKGROUND_SYNC_TASK, {
      minimumInterval: 15 * 60, // 15 minutes
      stopOnTerminate: false,
      startOnBoot: true,
    });

    console.log('Background sync task registered');
  } catch (error) {
    console.error('Failed to register background sync task:', error);
  }
};

/**
 * Unregister the background sync task.
 */
export const unregisterBackgroundSync = async () => {
  try {
    await BackgroundFetch.unregisterTaskAsync(BACKGROUND_SYNC_TASK);
    console.log('Background sync task unregistered');
  } catch (error) {
    console.error('Failed to unregister background sync task:', error);
  }
};
