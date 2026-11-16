export function utcIsoWeekKey(date: Date = new Date()): string {
  if (!Number.isFinite(date.getTime())) throw new Error('A valid date is required.');
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = thursday.getUTCDay() || 7;
  thursday.setUTCDate(thursday.getUTCDate() + 4 - weekday);
  const isoYear = thursday.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

export function resetWeeklyHuntProgress(quests: Record<string, any>, weekKey: string = utcIsoWeekKey()): boolean {
  if (quests.challengeWeek === weekKey) return false;
  quests.challengeWeek = weekKey;
  quests.weeklyHunts = 0;
  return true;
}
