export type ResourceRecipe = {
  id: string;
  name: string;
  level: number;
  seconds: number;
  output: string;
  count: number;
  materials: Record<string, number>;
  description: string;
  workGuild: 'blacksmith';
};

const METALS = [
  {
    "id": "copper",
    "ore": "Медная руда",
    "oreId": "ore_copper",
    "ingot": "Медный слиток",
    "ingotId": "ingot_copper",
    "adj": "Медная",
    "level": 1,
    "oreQty": 4,
    "smeltSeconds": 60,
    "baseSeconds": 60
  },
  {
    "id": "iron",
    "ore": "Железная руда",
    "oreId": "ore_iron",
    "ingot": "Железный слиток",
    "ingotId": "ingot_iron",
    "adj": "Железная",
    "level": 10,
    "oreQty": 5,
    "smeltSeconds": 90,
    "baseSeconds": 90
  },
  {
    "id": "steel",
    "ore": null,
    "oreId": null,
    "ingot": "Стальной слиток",
    "ingotId": "ingot_steel",
    "adj": "Стальная",
    "level": 20,
    "oreQty": 0,
    "smeltSeconds": 180,
    "baseSeconds": 120
  },
  {
    "id": "deep_silver",
    "ore": "Руда глубинного серебра",
    "oreId": "ore_deep_silver",
    "ingot": "Слиток глубинного серебра",
    "ingotId": "ingot_deep_silver",
    "adj": "Глубинно-серебряная",
    "level": 40,
    "oreQty": 6,
    "smeltSeconds": 240,
    "baseSeconds": 210
  },
  {
    "id": "astralite",
    "ore": "Осколок звёздного ядра",
    "oreId": "star_core_fragment",
    "ingot": "Астралитовый слиток",
    "ingotId": "ingot_astralite",
    "adj": "Астралитовая",
    "level": 60,
    "oreQty": 3,
    "smeltSeconds": 300,
    "baseSeconds": 270
  }
] as const;
const BLANK_TYPES = [
  {
    "id": "plate",
    "label": "пластина",
    "suffix": "пластина",
    "qty": 2,
    "count": 1,
    "seconds": 90,
    "description": "Плоская металлическая заготовка для броневых элементов и конструкций."
  },
  {
    "id": "rod",
    "label": "пруток",
    "suffix": "пруток",
    "qty": 1,
    "count": 1,
    "seconds": 60,
    "description": "Длинная цельная заготовка для силовых конструкций и рукоятей."
  },
  {
    "id": "wire",
    "label": "проволока",
    "suffix": "проволока",
    "qty": 1,
    "count": 2,
    "seconds": 120,
    "description": "Тонкая металлическая заготовка для креплений и соединений."
  },
  {
    "id": "sheet",
    "label": "лист",
    "suffix": "лист",
    "qty": 3,
    "count": 1,
    "seconds": 150,
    "description": "Большая тонкая заготовка для оболочек и защитных элементов."
  }
] as const;

export const RESOURCE_ITEMS: any[] = [
  {"id":"wood_common","name":"Обычная древесина","kind":"material","price":0,"level":1,"description":"Базовое древесное сырьё. Используется для деревянной заготовки и древесного угля.","resource":true,"resourceGroup":"wood","quality":"common"},
  {"id":"wood_strong","name":"Прочная древесина","kind":"material","price":0,"level":20,"description":"Плотная древесина для усиленных конструкций и продвинутого производства.","resource":true,"resourceGroup":"wood","quality":"strong"},
  {"id":"wood_rare","name":"Редкая древесина","kind":"material","price":0,"level":40,"description":"Редкая древесина высокой прогрессии для сложных изделий.","resource":true,"resourceGroup":"wood","quality":"rare"},
  {"id":"wood_resin","name":"Древесная смола","kind":"material","price":0,"level":1,"description":"Универсальный вспомогательный материал для деревянных и сложных производственных рецептов.","resource":true,"resourceGroup":"organic"},
  {"id":"roots","name":"Корни","kind":"material","price":0,"level":1,"description":"Общий вспомогательный органический материал для подходящих производственных рецептов.","resource":true,"resourceGroup":"organic"},
  ...METALS.flatMap((metal: any) => [
    ...(metal.oreId ? [{ id: metal.oreId, name: metal.ore, kind: 'material', price: 0, level: metal.level, description: metal.id === 'deep_silver' ? 'Редкая руда из глубоких природных месторождений.' : 'Рудное сырьё для металлургического производства.', resource: true, resourceGroup: 'metal', metal: metal.id, resourceForm: 'ore' }] : []),
    { id: metal.ingotId, name: metal.ingot, kind: 'material', price: 0, level: metal.level, description: 'Металлический слиток для непосредственного изготовления четырёх универсальных металлических заготовок.', resource: true, resourceGroup: 'metal', metal: metal.id, resourceForm: 'ingot' },
    ...BLANK_TYPES.map((blank: any) => ({ id: 'metal_' + metal.id + '_' + blank.id, name: metal.adj + ' ' + blank.suffix, kind: 'material', price: 0, level: metal.level, description: blank.description, resource: true, resourceGroup: 'metal', metal: metal.id, resourceForm: 'blank', blankType: blank.id }))
  ]),
  { id: 'charcoal', name: 'Древесный уголь', kind: 'material', price: 0, level: 20, description: 'Единый углеродистый материал из обычной древесины; используется при производстве стали.', resource: true, resourceGroup: 'metalworking', resourceForm: 'processed' },
];

export const RESOURCE_RECIPES: ResourceRecipe[] = [
  { id: 'make_charcoal', name: 'Производство древесного угля', level: 1, seconds: 60, output: 'charcoal', count: 2, materials: { wood_common: 4 }, description: 'Кузнечное производство древесного угля из обычной древесины.', workGuild: 'blacksmith' },
  { id: 'smelt_copper_ingot', name: 'Выплавка медного слитка', level: 1, seconds: 60, output: 'ingot_copper', count: 1, materials: { ore_copper: 4 }, description: 'Переплавка медной руды в медный слиток.', workGuild: 'blacksmith' },
  { id: 'smelt_iron_ingot', name: 'Выплавка железного слитка', level: 10, seconds: 90, output: 'ingot_iron', count: 1, materials: { ore_iron: 5 }, description: 'Переплавка железной руды в железный слиток.', workGuild: 'blacksmith' },
  { id: 'smelt_steel_ingot', name: 'Производство стального слитка', level: 20, seconds: 180, output: 'ingot_steel', count: 2, materials: { ingot_iron: 2, charcoal: 1 }, description: 'Сплавление железных слитков с древесным углём. Стальной руды не существует.', workGuild: 'blacksmith' },
  { id: 'smelt_deep_silver_ingot', name: 'Выплавка слитка глубинного серебра', level: 40, seconds: 240, output: 'ingot_deep_silver', count: 1, materials: { ore_deep_silver: 6 }, description: 'Переработка руды глубинного серебра из редкого природного месторождения.', workGuild: 'blacksmith' },
  { id: 'smelt_astralite_ingot', name: 'Формирование астралитового слитка', level: 60, seconds: 300, output: 'ingot_astralite', count: 1, materials: { star_core_fragment: 3 }, description: 'Обработка осколков звёздного ядра — особого фантазийного источника астралита.', workGuild: 'blacksmith' },
  ...METALS.flatMap((metal: any) => BLANK_TYPES.map((blank: any) => ({
    id: 'forge_' + metal.id + '_' + blank.id,
    name: 'Изготовление: ' + metal.adj.toLowerCase() + ' ' + blank.suffix,
    level: metal.level,
    seconds: blank.seconds + Math.max(0, metal.level - 1) * 2,
    output: 'metal_' + metal.id + '_' + blank.id,
    count: blank.count,
    materials: { [metal.ingotId]: blank.qty },
    description: 'Отдельный кузнечный рецепт. Заготовка производится непосредственно из слитка соответствующего металла.',
    workGuild: 'blacksmith' as const
  })))
];
