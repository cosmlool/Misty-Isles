export type CraftMaterialMap = Record<string, number>;

export type CraftRefundResult = {
  inventory: string[];
  refunded: boolean;
};

function validMaterials(value: unknown): value is CraftMaterialMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([id, quantity]) =>
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
