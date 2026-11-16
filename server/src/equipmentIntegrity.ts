export const EQUIPMENT_SLOTS = ['weapon','armor','helmet','gloves','boots','cloak','amulet'] as const;
export type EquipmentSlot = typeof EQUIPMENT_SLOTS[number];

export function resolveEquipmentSlot(item: { kind?: unknown; slot?: unknown }): EquipmentSlot | null {
  const kind = item?.kind;
  const slot = item?.slot == null || item.slot === '' ? undefined : item.slot;
  if (kind === 'weapon') return slot === undefined || slot === 'weapon' ? 'weapon' : null;
  if (kind === 'amulet') return slot === undefined || slot === 'amulet' ? 'amulet' : null;
  if (kind === 'armor') {
    const resolved = slot === undefined ? 'armor' : slot;
    return typeof resolved === 'string' && EQUIPMENT_SLOTS.includes(resolved as EquipmentSlot) && resolved !== 'weapon' && resolved !== 'amulet'
      ? resolved as EquipmentSlot
      : null;
  }
  return null;
}
