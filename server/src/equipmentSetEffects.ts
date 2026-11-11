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


export type EquipmentSetDefinition = {
  id: string;
  name: string;
  profession?: string;
  /** Exactly five armor item IDs; item-level stats remain on the items themselves. */
  itemIds: [string, string, string, string, string];
  /** Only explicitly authored set effects belong here. Empty/missing tiers grant nothing. */
  thresholds: Partial<Record<2 | 3 | 4 | 5, EquipmentSetEffect[]>>;
};

/**
 * Validate a future structured set registry against the authoritative item catalog.
 * This validates identity and ownership only; it never derives set effects from item stats.
 */
export function validateEquipmentSetDefinitions(input: unknown, catalog: unknown): string[] {
  if (!Array.isArray(input)) return ['set definitions must be an array'];
  if (!Array.isArray(catalog)) return ['equipment catalog must be an array'];
  const errors: string[] = [];
  const itemsById = new Map<string, EquipmentSetCatalogItem>();
  const catalogSets = new Map<string, EquipmentSetCatalogItem[]>();

  catalog.forEach(raw => {
    if (!isRecord(raw) || typeof raw.id !== 'string') return;
    itemsById.set(raw.id, raw as EquipmentSetCatalogItem);
    if (typeof raw.set === 'string' && raw.set.trim()) {
      const group = catalogSets.get(raw.set) || [];
      group.push(raw as EquipmentSetCatalogItem);
      catalogSets.set(raw.set, group);
    }
  });

  const definitionIds = new Set<string>();
  input.forEach((raw, index) => {
    const prefix = `definitions[${index}]`;
    if (!isRecord(raw)) { errors.push(`${prefix} must be an object`); return; }
    if (typeof raw.id !== 'string' || !raw.id.trim()) errors.push(`${prefix}.id must be a non-empty string`);
    else if (definitionIds.has(raw.id)) errors.push(`${prefix}.id is duplicated`);
    else definitionIds.add(raw.id);
    if (typeof raw.name !== 'string' || !raw.name.trim()) errors.push(`${prefix}.name must be a non-empty string`);
    if (raw.profession !== undefined && (typeof raw.profession !== 'string' || !raw.profession.trim())) {
      errors.push(`${prefix}.profession must be a non-empty string when supplied`);
    }

    if (!Array.isArray(raw.itemIds) || raw.itemIds.length !== 5 ||
        raw.itemIds.some(id => typeof id !== 'string' || !id.trim())) {
      errors.push(`${prefix}.itemIds must contain exactly five non-empty item IDs`);
    } else {
      const ids = raw.itemIds as string[];
      if (new Set(ids).size !== 5) errors.push(`${prefix}.itemIds contains duplicates`);
      const resolved = ids.map(id => itemsById.get(id));
      if (resolved.some(item => !item)) errors.push(`${prefix}.itemIds references an unknown catalog item`);
      else {
        const items = resolved as EquipmentSetCatalogItem[];
        if (items.some(item => item.kind !== 'armor')) errors.push(`${prefix}.itemIds must reference armor items only`);
        const setNames = new Set(items.map(item => item.set));
        if (setNames.size !== 1 || !items[0].set) errors.push(`${prefix}.itemIds must belong to one catalog set`);
        else {
          const group = catalogSets.get(String(items[0].set)) || [];
          if (group.length !== 5 || group.some(item => !ids.includes(String(item.id)))) {
            errors.push(`${prefix}.itemIds must match all five items in the catalog set`);
          }
        }
        if (new Set(items.map(item => item.profession ?? '')).size !== 1) {
          errors.push(`${prefix}.itemIds mixes catalog professions`);
        }
        if (raw.profession !== undefined && items.some(item => item.profession !== raw.profession)) {
          errors.push(`${prefix}.profession does not match catalog items`);
        }
      }
    }

    if (!isRecord(raw.thresholds)) { errors.push(`${prefix}.thresholds must be an object`); return; }
    for (const key of Object.keys(raw.thresholds)) {
      if (!['2', '3', '4', '5'].includes(key)) errors.push(`${prefix}.thresholds has unsupported tier ${key}`);
    }
    for (const tier of [2, 3, 4, 5] as const) {
      const effects = raw.thresholds[String(tier)];
      if (effects === undefined) continue;
      errors.push(...validateEquipmentSetEffects(effects).map(error => `${prefix}.thresholds.${tier}: ${error}`));
      if (Array.isArray(effects) && effects.some(effect => isRecord(effect) && effect.pieces !== tier)) {
        errors.push(`${prefix}.thresholds.${tier} contains an effect assigned to another tier`);
      }
    }
  });
  return errors;
}
