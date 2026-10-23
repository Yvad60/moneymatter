import SmsSyncStates from '../models/sms-sync-states.model';

export async function getLatestSmsSyncTimestamp({ userId }: { userId: number }): Promise<number | null> {
  const state = await SmsSyncStates.findOne({ where: { userId } });
  return state ? state.latestSmsTimestamp : null;
}

/** Only ever moves the stored time forward. */
export async function advanceLatestSmsSyncTimestamp({
  userId,
  timestamp,
}: {
  userId: number;
  timestamp: number;
}): Promise<void> {
  const current = await getLatestSmsSyncTimestamp({ userId });
  if (current !== null && current >= timestamp) return;

  await SmsSyncStates.upsert({ userId, latestSmsTimestamp: timestamp });
}
