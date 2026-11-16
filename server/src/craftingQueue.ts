export type CraftMaterialMap = Record<string, number>;
export type CraftJob = { id: string; recipe?: string; name?: string; output: string; count: number; finishAt: number; materials?: unknown; specialtyBonus?: boolean; [key: string]: any };
export type CraftRefundResult = { inventory: string[]; refunded: boolean };

function validMaterials(value: unknown): value is CraftMaterialMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.keys(value).length > 0 && Object.entries(value).every(([id, quantity]) =>
    id.length > 0 && id.length <= 128
    && Number.isSafeInteger(quantity) && Number(quantity) >= 1 && Number(quantity) <= 1000
  );
}

export function refundCraftMaterials(
  inventory: string[],
  job: { materials?: unknown } | null | undefined,
  fallbackMaterials?: CraftMaterialMap,
): CraftRefundResult {
  const materials = validMaterials(job?.materials)
    ? job.materials
    : validMaterials(fallbackMaterials) ? fallbackMaterials : null;
  if (!materials) return { inventory: [...inventory], refunded: false };
  const next = [...inventory];
  for (const [id, quantity] of Object.entries(materials)) {
    for (let count = 0; count < quantity; count++) next.push(id);
  }
  return { inventory: next, refunded: true };
}

export function startCraftJob(input: {
  inventory: string[]; queue: CraftJob[]; materials: CraftMaterialMap; job: CraftJob; maxQueue?: number;
}): { inventory: string[]; queue: CraftJob[] } {
  if (!Array.isArray(input.inventory) || input.inventory.some(x => typeof x !== 'string')) throw new Error('Craft inventory is invalid.');
  if (!Array.isArray(input.queue) || input.queue.length >= (input.maxQueue ?? 3)) throw new Error('Craft queue is full.');
  if (!validMaterials(input.materials)) throw new Error('Craft recipe materials are invalid.');
  if (!input.job || typeof input.job.id !== 'string' || !input.job.id || typeof input.job.output !== 'string' || !input.job.output) {
    throw new Error('Craft job is invalid.');
  }
  const nextInventory = [...input.inventory];
  for (const [id, quantity] of Object.entries(input.materials)) {
    const available = nextInventory.filter(item => item === id).length;
    if (available < quantity) throw new Error(`Missing craft material: ${id}.`);
  }
  for (const [id, quantity] of Object.entries(input.materials)) {
    let remaining = quantity;
    for (let i = nextInventory.length - 1; i >= 0 && remaining > 0; i--) {
      if (nextInventory[i] === id) { nextInventory.splice(i, 1); remaining--; }
    }
  }
  return { inventory: nextInventory, queue: [...input.queue, { ...input.job, materials: { ...input.materials } }] };
}

export function claimCraftJob(input: {
  inventory: string[]; queue: CraftJob[]; jobId: string; now: number;
  outputCount?: number; uniqueConflict?: boolean; fallbackMaterials?: CraftMaterialMap;
}): { inventory: string[]; queue: CraftJob[]; outputCount: number; refunded: boolean } {
  const job = input.queue.find(entry => entry.id === input.jobId);
  if (!job) throw new Error('Craft job not found.');
  if (!Number.isFinite(job.finishAt) || input.now < job.finishAt) throw new Error('Craft job is not finished.');
  if (input.uniqueConflict) {
    const refund = refundCraftMaterials(input.inventory, job, input.fallbackMaterials);
    if (!refund.refunded) throw new Error('Craft materials cannot be safely refunded; job retained for review.');
    return { inventory: refund.inventory, queue: input.queue.filter(entry => entry.id !== input.jobId), outputCount: 0, refunded: true };
  }
  const count = input.outputCount ?? Number(job.count || 1);
  if (!Number.isSafeInteger(count) || count < 1 || count > 1000) throw new Error('Craft output quantity is invalid.');
  return {
    inventory: [...input.inventory, ...Array.from({ length: count }, () => job.output)],
    queue: input.queue.filter(entry => entry.id !== input.jobId),
    outputCount: count,
    refunded: false,
  };
}


export function cancelCraftJob(input: {
  inventory: string[]; queue: CraftJob[]; jobId: string; now: number; fallbackMaterials?: CraftMaterialMap;
}): { inventory: string[]; queue: CraftJob[]; refunded: true } {
  if (!Array.isArray(input.inventory) || input.inventory.some(item => typeof item !== 'string')) {
    throw new Error('Craft inventory is invalid.');
  }
  if (!Array.isArray(input.queue) || !Number.isFinite(input.now)) throw new Error('Craft queue is invalid.');
  const job = input.queue.find(entry => entry.id === input.jobId);
  if (!job) throw new Error('Craft job not found.');
  if (!Number.isFinite(job.finishAt) || input.now >= job.finishAt) {
    throw new Error('Completed craft jobs cannot be cancelled; claim the result instead.');
  }
  const refund = refundCraftMaterials(input.inventory, job, input.fallbackMaterials);
  if (!refund.refunded) throw new Error('Craft materials cannot be safely refunded; job retained for review.');
  return { inventory: refund.inventory, queue: input.queue.filter(entry => entry.id !== input.jobId), refunded: true };
}
