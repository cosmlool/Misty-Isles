export type EquipmentSetEffectTarget =
  | 'attack' | 'defense' | 'health'
  | 'critChance' | 'critDamage' | 'accuracy' | 'evasion'
  | 'lifesteal' | 'loot' | 'magicDamage' | 'physicalDamage'
  | 'bossDamage' | 'healing' | 'resistance' | 'controlResistance'
  | 'attributePercent'
  | 'spoilChance' | 'sweepChance' | 'spoilYield' | 'sweepYield';

export type EquipmentSetAttribute =
  | 'strength' | 'dexterity' | 'intelligence' | 'vitality' | 'stamina';

export type EquipmentSetScope = 'hunt' | 'dungeon' | 'pvp';
export type EquipmentSetTrigger =
  | 'always' | 'onCrit' | 'onKill' | 'onAllyLowHealth' | 'onSpoilSuccess';

export type EquipmentSetEffect = {
  pieces: 2 | 3 | 4 | 5;
  target: EquipmentSetEffectTarget;
  attribute?: EquipmentSetAttribute;
  /** Decimal fraction: 0.05 means +5%. Values are design data, not balance defaults. */
  value: number;
  scope: EquipmentSetScope[];
  trigger?: EquipmentSetTrigger;
};

export type EquipmentSetCatalogItem = {
  id?: unknown;
  kind?: unknown;
  set?: unknown;
  slot?: unknown;
  profession?: unknown;
  setBonus?: unknown;
};

const SET_SLOTS = ['helmet', 'armor', 'gloves', 'boots', 'cloak'] as const;
const TARGETS = new Set<EquipmentSetEffectTarget>([
  'attack', 'defense', 'health', 'critChance', 'critDamage', 'accuracy', 'evasion',
  'lifesteal', 'loot', 'magicDamage', 'physicalDamage', 'bossDamage', 'healing',
  'resistance', 'controlResistance', 'attributePercent',
  'spoilChance', 'sweepChance', 'spoilYield', 'sweepYield',
]);
const ATTRIBUTES = new Set<EquipmentSetAttribute>([
  'strength', 'dexterity', 'intelligence', 'vitality', 'stamina',
]);
const SCOPES = new Set<EquipmentSetScope>(['hunt', 'dungeon', 'pvp']);
const TRIGGERS = new Set<EquipmentSetTrigger>([
  'always', 'onCrit', 'onKill', 'onAllyLowHealth', 'onSpoilSuccess',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Validate effect definitions without guessing, coercing, or applying balance defaults. */
export function validateEquipmentSetEffects(input: unknown): string[] {
  if (!Array.isArray(input)) return ['effects must be an array'];
  const errors: string[] = [];

  input.forEach((raw, index) => {
    const prefix = `effects[${index}]`;
    if (!isRecord(raw)) {
      errors.push(`${prefix} must be an object`);
      return;
    }

    if (![2, 3, 4, 5].includes(raw.pieces as number)) {
      errors.push(`${prefix}.pieces must be 2, 3, 4, or 5`);
    }
    if (typeof raw.target !== 'string' || !TARGETS.has(raw.target as EquipmentSetEffectTarget)) {
      errors.push(`${prefix}.target is not supported`);
    }
    if (typeof raw.value !== 'number' || !Number.isFinite(raw.value) || raw.value < 0) {
      errors.push(`${prefix}.value must be a finite non-negative number`);
    }
    if (Array.isArray(raw.scope)) {
      if (raw.scope.length === 0) errors.push(`${prefix}.scope must not be empty`);
      if (raw.scope.some(scope => typeof scope !== 'string' || !SCOPES.has(scope as EquipmentSetScope))) {
        errors.push(`${prefix}.scope contains an unsupported mode`);
      }
      if (new Set(raw.scope).size !== raw.scope.length) {
        errors.push(`${prefix}.scope contains duplicates`);
      }
    } else {
      errors.push(`${prefix}.scope must be an array`);
    }
    if (raw.trigger !== undefined &&
        (typeof raw.trigger !== 'string' || !TRIGGERS.has(raw.trigger as EquipmentSetTrigger))) {
      errors.push(`${prefix}.trigger is not supported`);
    }
    if (raw.attribute !== undefined &&
        (typeof raw.attribute !== 'string' || !ATTRIBUTES.has(raw.attribute as EquipmentSetAttribute))) {
      errors.push(`${prefix}.attribute is not supported`);
    }
    if (raw.target === 'attributePercent' && !ATTRIBUTES.has(raw.attribute as EquipmentSetAttribute)) {
      errors.push(`${prefix}.attribute is required for attributePercent`);
    }
    if (raw.target !== 'attributePercent' && raw.attribute !== undefined) {
      errors.push(`${prefix}.attribute is only valid for attributePercent`);
    }
    if ((raw.target === 'spoilChance' || raw.target === 'sweepChance') &&
        typeof raw.value === 'number' && Number.isFinite(raw.value) &&
        (raw.value < 0 || raw.value > 0.8)) {
      errors.push(`${prefix}.value exceeds the 80% Gatherer chance cap`);
    }
    if (raw.target === 'sweepChance' && raw.trigger !== 'onSpoilSuccess') {
      errors.push(`${prefix}.sweepChance must use onSpoilSuccess`);
    }
  });

  return errors;
}

/**
 * Resolve cumulative unlocked thresholds for one equipped set.
 * This is a pure data operation: it does not execute triggers or alter combat stats.
 */
export function resolveEquipmentSetEffects(
  effects: readonly EquipmentSetEffect[],
  equippedPieces: number,
  scope: EquipmentSetScope,
): EquipmentSetEffect[] {
  const count = Number.isFinite(equippedPieces)
    ? Math.max(0, Math.min(5, Math.floor(equippedPieces)))
    : 0;
  if (count < 2) return [];

  return effects.filter(effect =>
    effect.pieces <= count && effect.scope.includes(scope),
  );
}

/** Structural audit for the current five-slot armor-set catalog. */
export function validateEquipmentSetCatalog(input: unknown): string[] {
  if (!Array.isArray(input)) return ['equipment catalog must be an array'];
  const groups = new Map<string, EquipmentSetCatalogItem[]>();
  const errors: string[] = [];

  const catalogIds = new Set<string>();
  input.forEach((raw, index) => {
    if (!isRecord(raw)) {
      errors.push(`catalog[${index}] must be an object`);
      return;
    }

    const item = raw as EquipmentSetCatalogItem;
    if (typeof item.id !== 'string' || !item.id.trim()) {
      errors.push(`catalog[${index}] has no valid id`);
    } else if (catalogIds.has(item.id)) {
      errors.push(`catalog[${index}] duplicates item id ${item.id}`);
    } else {
      catalogIds.add(item.id);
    }

    const hasSet = typeof item.set === 'string' && Boolean(item.set.trim());
    if (item.kind === 'armor' && !hasSet) {
      errors.push(`catalog[${index}] armor item has no valid set`);
    }
    if (hasSet && item.kind !== 'armor') {
      errors.push(`catalog[${index}] non-armor item cannot belong to an armor set`);
    }
    if (!hasSet) return;

    const group = groups.get(item.set as string) ?? [];
    group.push(item);
    groups.set(item.set as string, group);
  });

  for (const [setName, items] of groups) {
    if (items.length !== 5) {
      errors.push(`set ${setName} must contain exactly five pieces (found ${items.length})`);
    }
    const ids = items.map(item => item.id);
    if (new Set(ids).size !== ids.length) errors.push(`set ${setName} contains duplicate item ids`);
    const slots = items.map(item => item.slot);
    if (new Set(slots).size !== slots.length) errors.push(`set ${setName} contains duplicate slots`);
    for (const slot of SET_SLOTS) {
      if (!slots.includes(slot)) errors.push(`set ${setName} is missing slot ${slot}`);
    }
    const first = items[0];
    if (items.some(item => item.profession !== first.profession)) {
      errors.push(`set ${setName} mixes professions`);
    }
    if (items.some(item => item.setBonus !== first.setBonus)) {
      errors.push(`set ${setName} has inconsistent setBonus descriptions`);
    }
  }

  return errors;
}
