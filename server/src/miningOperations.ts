import { creditCrystals } from './currencyOperations.js';

export const MINING_CYCLE_MS = 5 * 60 * 1000;

export type MiningJob = { startedAt: number; endsAt: number };

export type MiningSettlementResult =
  | { status: 'none' }
  | { status: 'pending'; job: MiningJob; remainingMs: number }
  | { status: 'completed'; job: MiningJob; quests: Record<string, any>; crystals: number; baseReward: 1; bonusReward: 0 | 1; rolledReward: number; credited: number; burned: number };

function asRecord(value: unknown): Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

export function readMiningJob(quests: unknown): MiningJob | null {
  const raw = asRecord(quests).miningJob;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const startedAt = Number(raw.startedAt), endsAt = Number(raw.endsAt);
  if (!Number.isSafeInteger(startedAt) || !Number.isSafeInteger(endsAt) || endsAt - startedAt !== MINING_CYCLE_MS) return null;
  return { startedAt, endsAt };
}

export function startMiningJob(quests: unknown, now: number): { ok: true; quests: Record<string, any>; job: MiningJob } | { ok: false; job: MiningJob } {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(now + MINING_CYCLE_MS)) throw new Error('Mining start time must be a nonnegative safe integer.');
  const current = readMiningJob(quests);
  if (current) return { ok: false, job: current };
  const nextQuests = { ...asRecord(quests) };
  const job = { startedAt: now, endsAt: now + MINING_CYCLE_MS };
  nextQuests.miningJob = job;
  return { ok: true, quests: nextQuests, job };
}

export function isMiningActivityLocked(quests: unknown, now: number): boolean {
  const job = readMiningJob(quests);
  return Boolean(job && now < job.endsAt);
}

export function prepareMiningSettlement(quests: unknown, currentCrystals: number, now: number, extraCrystalChance: number, randomRoll: number): MiningSettlementResult {
  const job = readMiningJob(quests);
  if (!job) return { status: 'none' };
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Mining settlement time must be a nonnegative safe integer.');
  if (now < job.endsAt) return { status: 'pending', job, remainingMs: job.endsAt - now };
  if (!Number.isFinite(extraCrystalChance) || extraCrystalChance < 0 || extraCrystalChance > 1) throw new Error('Mining bonus chance must be between zero and one.');
  if (!Number.isFinite(randomRoll) || randomRoll < 0 || randomRoll >= 1) throw new Error('Mining random roll must be in [0, 1).');
  const bonusReward: 0 | 1 = extraCrystalChance > 0 && randomRoll < extraCrystalChance ? 1 : 0;
  const rolledReward = 1 + bonusReward;
  const credit = creditCrystals(currentCrystals, rolledReward);
  const nextQuests = { ...asRecord(quests) };
  delete nextQuests.miningJob;
  return { status: 'completed', job, quests: nextQuests, crystals: credit.balance, baseReward: 1, bonusReward, rolledReward, credited: credit.credited, burned: credit.burned };
}
