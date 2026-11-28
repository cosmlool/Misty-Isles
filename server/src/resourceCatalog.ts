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
  { id: 'stone', name: 'Камень', kind: 'material', price: 0, level: 1, description: 'Обычное минеральное сырьё для производства каменных конструктивных деталей.', resource: true, resourceGroup: 'mineral', mineral: 'stone', resourceForm: 'raw' },
  { id: 'granite', name: 'Гранит', kind: 'material', price: 0, level: 20, description: 'Прочный тяжёлый минеральный материал для массивных конструктивных деталей и опор.', resource: true, resourceGroup: 'mineral', mineral: 'granite', resourceForm: 'raw' },
  { id: 'obsidian', name: 'Обсидиан', kind: 'material', price: 0, level: 40, description: 'Твёрдый вулканический материал для острых режущих и колющих элементов и специальных вставок.', resource: true, resourceGroup: 'mineral', mineral: 'obsidian', resourceForm: 'raw' },
  { id: 'clay', name: 'Глина', kind: 'material', price: 0, level: 1, description: 'Пластичное минеральное сырьё для изготовления керамических и формованных компонентов.', resource: true, resourceGroup: 'mineral', mineral: 'clay', resourceForm: 'raw' },
  { id: 'stone_blank', name: 'Каменная заготовка', kind: 'material', price: 0, level: 1, description: 'Обработанный каменный материал для конструктивных и других подходящих минеральных деталей.', resource: true, resourceGroup: 'mineral', mineral: 'stone', resourceForm: 'blank' },
  { id: 'granite_blank', name: 'Гранитная заготовка', kind: 'material', price: 0, level: 20, description: 'Обработанный гранит для тяжёлых и прочных конструктивных деталей, оснований и опор.', resource: true, resourceGroup: 'mineral', mineral: 'granite', resourceForm: 'blank' },
  { id: 'obsidian_blank', name: 'Обсидиановая заготовка', kind: 'material', price: 0, level: 40, description: 'Обработанный обсидиан для острых режущих и колющих элементов и специальных вставок.', resource: true, resourceGroup: 'mineral', mineral: 'obsidian', resourceForm: 'blank' },
  { id: 'ceramic_blank', name: 'Керамическая заготовка', kind: 'material', price: 0, level: 1, description: 'Обработанная глина для керамических деталей и вспомогательных формованных компонентов.', resource: true, resourceGroup: 'mineral', mineral: 'clay', resourceForm: 'blank' },
  {"id":"wood_common","name":"Обычная древесина","kind":"material","price":0,"level":1,"description":"Базовое древесное сырьё. Используется для деревянной заготовки и древесного угля.","resource":true,"resourceGroup":"wood","quality":"common"},
  {"id":"wood_strong","name":"Прочная древесина","kind":"material","price":0,"level":20,"description":"Плотная древесина для усиленных конструкций и продвинутого производства.","resource":true,"resourceGroup":"wood","quality":"strong"},
  {"id":"wood_rare","name":"Редкая древесина","kind":"material","price":0,"level":40,"description":"Редкая древесина высокой прогрессии для сложных изделий.","resource":true,"resourceGroup":"wood","quality":"rare"},
  {"id":"wood_blank_common","name":"Деревянная заготовка","kind":"material","price":0,"level":1,"description":"Обработанная заготовка из обычной древесины; категория качества сохраняется для рецептов изделий.","resource":true,"resourceGroup":"wood","resourceForm":"blank","quality":"common"},
  {"id":"wood_blank_strong","name":"Деревянная заготовка","kind":"material","price":0,"level":20,"description":"Обработанная заготовка из прочной древесины; категория качества сохраняется для рецептов изделий.","resource":true,"resourceGroup":"wood","resourceForm":"blank","quality":"strong"},
  {"id":"wood_blank_rare","name":"Деревянная заготовка","kind":"material","price":0,"level":40,"description":"Обработанная заготовка из редкой древесины; категория качества сохраняется для рецептов изделий.","resource":true,"resourceGroup":"wood","resourceForm":"blank","quality":"rare"},
  {"id":"wood_handle_common","name":"Деревянная рукоять","kind":"material","price":0,"level":1,"description":"Универсальная деревянная рукоять из обычной древесины.","resource":true,"resourceGroup":"wood","resourceForm":"component","quality":"common"},
  {"id":"wood_handle_strong","name":"Деревянная рукоять","kind":"material","price":0,"level":20,"description":"Универсальная деревянная рукоять из прочной древесины.","resource":true,"resourceGroup":"wood","resourceForm":"component","quality":"strong"},
  {"id":"wood_handle_rare","name":"Деревянная рукоять","kind":"material","price":0,"level":40,"description":"Универсальная деревянная рукоять из редкой древесины.","resource":true,"resourceGroup":"wood","resourceForm":"component","quality":"rare"},
  {"id":"wood_resin","name":"Древесная смола","kind":"material","price":0,"level":1,"description":"Универсальный вспомогательный материал для деревянных и сложных производственных рецептов.","resource":true,"resourceGroup":"organic"},
  {"id":"roots","name":"Корни","kind":"material","price":0,"level":1,"description":"Общий вспомогательный органический материал для подходящих производственных рецептов.","resource":true,"resourceGroup":"organic"},
  { id: 'leaves', name: 'Листья', kind: 'material', price: 0, level: 1, description: 'Общее исходное растительное сырьё для подходящих производственных рецептов.', resource: true, resourceGroup: 'organic', resourceForm: 'raw' },
  { id: 'plant_fiber', name: 'Растительное волокно', kind: 'material', price: 0, level: 1, description: 'Исходное растительное сырьё для производства общей нити.', resource: true, resourceGroup: 'textile', resourceForm: 'raw' },
  { id: 'wool', name: 'Шерсть', kind: 'material', price: 0, level: 1, description: 'Исходное волокнистое сырьё животного происхождения для производства общей нити.', resource: true, resourceGroup: 'textile', resourceForm: 'raw' },
  { id: 'thread', name: 'Нить', kind: 'material', price: 0, level: 1, description: 'Общий текстильный полуфабрикат, производимый из растительного волокна или шерсти.', resource: true, resourceGroup: 'textile', resourceForm: 'processed' },
  { id: 'fabric', name: 'Ткань', kind: 'material', price: 0, level: 1, description: 'Общий текстильный материал, производимый из нити.', resource: true, resourceGroup: 'textile', resourceForm: 'processed' },
  { id: 'hide', name: 'Шкура', kind: 'material', price: 0, level: 1, description: 'Исходное сырьё животного происхождения для производства общей обработанной кожи.', resource: true, resourceGroup: 'leather', resourceForm: 'raw' },
  { id: 'rough_hide', name: 'Грубая шкура', kind: 'material', price: 0, level: 20, description: 'Более плотное исходное сырьё животного происхождения для производства общей обработанной кожи.', resource: true, resourceGroup: 'leather', resourceForm: 'raw' },
  { id: 'processed_leather', name: 'Обработанная кожа', kind: 'material', price: 0, level: 1, description: 'Единый обработанный кожаный материал, производимый из шкуры или грубой шкуры.', resource: true, resourceGroup: 'leather', resourceForm: 'processed' },
  { id: 'leather_strip', name: 'Кожаная полоса', kind: 'material', price: 0, level: 1, description: 'Универсальный кожаный компонент для рукоятей, креплений и соединений.', resource: true, resourceGroup: 'leather', resourceForm: 'blank' },
  { id: 'leather_blank', name: 'Кожаная заготовка', kind: 'material', price: 0, level: 1, description: 'Универсальная кожаная основа для защитных и конструктивных компонентов.', resource: true, resourceGroup: 'leather', resourceForm: 'blank' },
  { id: 'bone', name: 'Кость', kind: 'material', price: 0, level: 1, description: 'Исходный костный материал для универсальных костяных компонентов.', resource: true, resourceGroup: 'beast', resourceForm: 'raw' },
  { id: 'bone_blank', name: 'Костяная заготовка', kind: 'material', price: 0, level: 1, description: 'Общая обработанная основа для изготовления костяных деталей.', resource: true, resourceGroup: 'beast', resourceForm: 'processed' },
  { id: 'bone_plate', name: 'Костяная пластина', kind: 'material', price: 0, level: 1, description: 'Плоский универсальный костяной компонент.', resource: true, resourceGroup: 'beast', resourceForm: 'blank' },
  { id: 'bone_spike', name: 'Костяной шип', kind: 'material', price: 0, level: 1, description: 'Универсальный костяной колющий компонент.', resource: true, resourceGroup: 'beast', resourceForm: 'blank' },
  { id: 'bone_fragment', name: 'Костяной фрагмент', kind: 'material', price: 0, level: 1, description: 'Обработанный костяной фрагмент для подходящих конструкций.', resource: true, resourceGroup: 'beast', resourceForm: 'blank' },
  { id: 'claw', name: 'Коготь', kind: 'material', price: 0, level: 1, description: 'Исходный когтевой материал для универсальных звериных компонентов.', resource: true, resourceGroup: 'beast', resourceForm: 'raw' },
  { id: 'processed_claw', name: 'Обработанный коготь', kind: 'material', price: 0, level: 1, description: 'Общая обработанная основа для изготовления когтевых деталей.', resource: true, resourceGroup: 'beast', resourceForm: 'processed' },
  { id: 'claw_element', name: 'Когтевой элемент', kind: 'material', price: 0, level: 1, description: 'Универсальный компонент, изготовленный из обработанного когтя.', resource: true, resourceGroup: 'beast', resourceForm: 'blank' },
  { id: 'claw_hook', name: 'Когтевой крюк', kind: 'material', price: 0, level: 1, description: 'Изогнутый универсальный компонент из обработанного когтя.', resource: true, resourceGroup: 'beast', resourceForm: 'blank' },
  { id: 'fang', name: 'Клык', kind: 'material', price: 0, level: 1, description: 'Исходный клыковый материал для универсальных звериных компонентов.', resource: true, resourceGroup: 'beast', resourceForm: 'raw' },
  { id: 'sharpened_fang', name: 'Заточенный клык', kind: 'material', price: 0, level: 1, description: 'Общая обработанная основа для изготовления клыковых деталей.', resource: true, resourceGroup: 'beast', resourceForm: 'processed' },
  { id: 'fang_tip', name: 'Клыковый наконечник', kind: 'material', price: 0, level: 1, description: 'Универсальный наконечник, изготовленный из заточенного клыка.', resource: true, resourceGroup: 'beast', resourceForm: 'blank' },
  { id: 'fang_inlay', name: 'Клыковая вставка', kind: 'material', price: 0, level: 1, description: 'Универсальная вставка, изготовленная из заточенного клыка.', resource: true, resourceGroup: 'beast', resourceForm: 'blank' },
  { id: 'reinforced_fastening', name: 'Усиленное крепление', kind: 'material', price: 0, level: 1, description: 'Универсальный комбинированный компонент из металлической проволоки и кожаной полосы.', resource: true, resourceGroup: 'combined', resourceForm: 'component' },
  { id: 'reinforced_fabric', name: 'Армированная ткань', kind: 'material', price: 0, level: 1, description: 'Универсальный текстильный компонент, усиленный металлической проволокой.', resource: true, resourceGroup: 'combined', resourceForm: 'component' },
  { id: 'bone_overlay', name: 'Костяная накладка', kind: 'material', price: 0, level: 1, description: 'Универсальная защитная накладка из костяной пластины и кожаной заготовки.', resource: true, resourceGroup: 'combined', resourceForm: 'component' },
  { id: 'reinforced_metal_node', name: 'Усиленный металлический узел', kind: 'material', price: 0, level: 1, description: 'Универсальный силовой узел из металлического прутка, пластины и проволоки одного металла.', resource: true, resourceGroup: 'combined', resourceForm: 'component' },
  ...METALS.flatMap((metal: any) => [
    ...(metal.oreId ? [{ id: metal.oreId, name: metal.ore, kind: 'material', price: 0, level: metal.level, description: metal.id === 'deep_silver' ? 'Редкая руда из глубоких природных месторождений.' : 'Рудное сырьё для металлургического производства.', resource: true, resourceGroup: 'metal', metal: metal.id, resourceForm: 'ore' }] : []),
    { id: metal.ingotId, name: metal.ingot, kind: 'material', price: 0, level: metal.level, description: 'Металлический слиток для непосредственного изготовления четырёх универсальных металлических заготовок.', resource: true, resourceGroup: 'metal', metal: metal.id, resourceForm: 'ingot' },
    ...BLANK_TYPES.map((blank: any) => ({ id: 'metal_' + metal.id + '_' + blank.id, name: metal.adj + ' ' + blank.suffix, kind: 'material', price: 0, level: metal.level, description: blank.description, resource: true, resourceGroup: 'metal', metal: metal.id, resourceForm: 'blank', blankType: blank.id }))
  ]),
  { id: 'charcoal', name: 'Древесный уголь', kind: 'material', price: 0, level: 20, description: 'Единый углеродистый материал из обычной древесины; используется при производстве стали.', resource: true, resourceGroup: 'metalworking', resourceForm: 'processed' },
];

export const RESOURCE_RECIPES: ResourceRecipe[] = [
  { id: 'make_charcoal', name: 'Производство древесного угля', level: 1, seconds: 60, output: 'charcoal', count: 2, materials: { wood_common: 4 }, description: 'Кузнечное производство древесного угля из обычной древесины.', workGuild: 'blacksmith' },
  { id: 'process_wood_blank_common', name: 'Обработка деревянной заготовки (обычная древесина)', level: 1, seconds: 60, output: 'wood_blank_common', count: 1, materials: { wood_common: 3 }, description: 'Обработка обычной древесины в универсальную деревянную заготовку.', workGuild: 'blacksmith' },
  { id: 'process_wood_blank_strong', name: 'Обработка деревянной заготовки (прочная древесина)', level: 20, seconds: 120, output: 'wood_blank_strong', count: 1, materials: { wood_strong: 3 }, description: 'Обработка прочной древесины в деревянную заготовку с сохранением категории материала.', workGuild: 'blacksmith' },
  { id: 'process_wood_blank_rare', name: 'Обработка деревянной заготовки (редкая древесина)', level: 40, seconds: 180, output: 'wood_blank_rare', count: 1, materials: { wood_rare: 3 }, description: 'Обработка редкой древесины в деревянную заготовку с сохранением категории материала.', workGuild: 'blacksmith' },
  { id: 'make_wood_handle_common', name: 'Изготовление деревянной рукояти (обычная древесина)', level: 1, seconds: 60, output: 'wood_handle_common', count: 1, materials: { wood_blank_common: 1 }, description: 'Изготовление универсальной деревянной рукояти из обычной деревянной заготовки.', workGuild: 'blacksmith' },
  { id: 'make_wood_handle_strong', name: 'Изготовление деревянной рукояти (прочная древесина)', level: 20, seconds: 90, output: 'wood_handle_strong', count: 1, materials: { wood_blank_strong: 1 }, description: 'Изготовление универсальной деревянной рукояти из прочной деревянной заготовки.', workGuild: 'blacksmith' },
  { id: 'make_wood_handle_rare', name: 'Изготовление деревянной рукояти (редкая древесина)', level: 40, seconds: 120, output: 'wood_handle_rare', count: 1, materials: { wood_blank_rare: 1 }, description: 'Изготовление универсальной деревянной рукояти из редкой деревянной заготовки.', workGuild: 'blacksmith' },
  { id: 'smelt_copper_ingot', name: 'Выплавка медного слитка', level: 1, seconds: 60, output: 'ingot_copper', count: 1, materials: { ore_copper: 4 }, description: 'Переплавка медной руды в медный слиток.', workGuild: 'blacksmith' },
  { id: 'smelt_iron_ingot', name: 'Выплавка железного слитка', level: 10, seconds: 90, output: 'ingot_iron', count: 1, materials: { ore_iron: 5 }, description: 'Переплавка железной руды в железный слиток.', workGuild: 'blacksmith' },
  { id: 'smelt_steel_ingot', name: 'Производство стального слитка', level: 20, seconds: 180, output: 'ingot_steel', count: 2, materials: { ingot_iron: 2, charcoal: 1 }, description: 'Сплавление железных слитков с древесным углём. Стальной руды не существует.', workGuild: 'blacksmith' },
  { id: 'smelt_deep_silver_ingot', name: 'Выплавка слитка глубинного серебра', level: 40, seconds: 240, output: 'ingot_deep_silver', count: 1, materials: { ore_deep_silver: 6 }, description: 'Переработка руды глубинного серебра из редкого природного месторождения.', workGuild: 'blacksmith' },
  { id: 'smelt_astralite_ingot', name: 'Формирование астралитового слитка', level: 60, seconds: 300, output: 'ingot_astralite', count: 1, materials: { star_core_fragment: 3 }, description: 'Обработка осколков звёздного ядра — особого фантазийного источника астралита.', workGuild: 'blacksmith' },
  { id: 'process_stone_blank', name: 'Обработка каменной заготовки', level: 1, seconds: 60, output: 'stone_blank', count: 1, materials: { stone: 3 }, description: 'Обработка обычного камня в универсальную каменную заготовку.', workGuild: 'blacksmith' },
  { id: 'process_granite_blank', name: 'Обработка гранитной заготовки', level: 20, seconds: 120, output: 'granite_blank', count: 1, materials: { granite: 4 }, description: 'Обработка гранита в прочную заготовку для тяжёлых конструктивных деталей.', workGuild: 'blacksmith' },
  { id: 'process_obsidian_blank', name: 'Обработка обсидиановой заготовки', level: 40, seconds: 180, output: 'obsidian_blank', count: 1, materials: { obsidian: 3 }, description: 'Обработка обсидиана в заготовку для острых элементов и специальных вставок.', workGuild: 'blacksmith' },
  { id: 'process_ceramic_blank', name: 'Формование керамической заготовки', level: 1, seconds: 90, output: 'ceramic_blank', count: 1, materials: { clay: 4 }, description: 'Формование глины в керамическую заготовку для производственных компонентов.', workGuild: 'blacksmith' },
  { id: 'spin_plant_fiber_thread', name: 'Прядение растительного волокна', level: 1, seconds: 60, output: 'thread', count: 1, materials: { plant_fiber: 3 }, description: 'Получение общей нити из растительного волокна.', workGuild: 'blacksmith' },
  { id: 'spin_wool_thread', name: 'Прядение шерсти', level: 1, seconds: 60, output: 'thread', count: 1, materials: { wool: 3 }, description: 'Получение общей нити из шерсти.', workGuild: 'blacksmith' },
  { id: 'weave_fabric', name: 'Ткачество ткани', level: 1, seconds: 90, output: 'fabric', count: 1, materials: { thread: 3 }, description: 'Производство общего типа ткани из нити.', workGuild: 'blacksmith' },
  { id: 'tan_hide', name: 'Обработка шкуры', level: 1, seconds: 90, output: 'processed_leather', count: 1, materials: { hide: 3 }, description: 'Обработка обычной шкуры в общий тип обработанной кожи.', workGuild: 'blacksmith' },
  { id: 'tan_rough_hide', name: 'Обработка грубой шкуры', level: 20, seconds: 150, output: 'processed_leather', count: 1, materials: { rough_hide: 3 }, description: 'Обработка грубой шкуры в тот же общий тип обработанной кожи.', workGuild: 'blacksmith' },
  { id: 'cut_leather_strips', name: 'Нарезка кожаных полос', level: 1, seconds: 60, output: 'leather_strip', count: 2, materials: { processed_leather: 1 }, description: 'Разделение обработанной кожи на две универсальные кожаные полосы.', workGuild: 'blacksmith' },
  { id: 'prepare_leather_blank', name: 'Подготовка кожаной заготовки', level: 1, seconds: 90, output: 'leather_blank', count: 1, materials: { processed_leather: 2 }, description: 'Подготовка плотной универсальной основы из обработанной кожи.', workGuild: 'blacksmith' },
  { id: 'process_bone_blank', name: 'Подготовка костяной заготовки', level: 1, seconds: 60, output: 'bone_blank', count: 1, materials: { bone: 3 }, description: 'Обработка кости в универсальную костяную основу.', workGuild: 'blacksmith' },
  { id: 'shape_bone_plate', name: 'Изготовление костяной пластины', level: 1, seconds: 60, output: 'bone_plate', count: 1, materials: { bone_blank: 1 }, description: 'Формование костяной заготовки в плоскую пластину.', workGuild: 'blacksmith' },
  { id: 'shape_bone_spike', name: 'Изготовление костяного шипа', level: 1, seconds: 60, output: 'bone_spike', count: 2, materials: { bone_blank: 1 }, description: 'Формование костяной заготовки в два универсальных шипа.', workGuild: 'blacksmith' },
  { id: 'prepare_bone_fragment', name: 'Подготовка костяных фрагментов', level: 1, seconds: 45, output: 'bone_fragment', count: 2, materials: { bone_blank: 1 }, description: 'Разделение костяной заготовки на два обработанных фрагмента.', workGuild: 'blacksmith' },
  { id: 'process_claw', name: 'Обработка когтя', level: 1, seconds: 90, output: 'processed_claw', count: 1, materials: { claw: 3 }, description: 'Подготовка исходного когтя к изготовлению универсальных деталей.', workGuild: 'blacksmith' },
  { id: 'shape_claw_element', name: 'Изготовление когтевого элемента', level: 1, seconds: 60, output: 'claw_element', count: 1, materials: { processed_claw: 1 }, description: 'Формование обработанного когтя в универсальный когтевой элемент.', workGuild: 'blacksmith' },
  { id: 'shape_claw_hook', name: 'Изготовление когтевого крюка', level: 1, seconds: 90, output: 'claw_hook', count: 1, materials: { processed_claw: 1 }, description: 'Формование обработанного когтя в изогнутый когтевой крюк.', workGuild: 'blacksmith' },
  { id: 'sharpen_fang', name: 'Заточка клыка', level: 1, seconds: 60, output: 'sharpened_fang', count: 1, materials: { fang: 2 }, description: 'Подготовка клыка в универсальный заточенный материал.', workGuild: 'blacksmith' },
  { id: 'shape_fang_tip', name: 'Изготовление клыкового наконечника', level: 1, seconds: 60, output: 'fang_tip', count: 1, materials: { sharpened_fang: 1 }, description: 'Формование заточенного клыка в клыковый наконечник.', workGuild: 'blacksmith' },
  { id: 'prepare_fang_inlay', name: 'Подготовка клыковой вставки', level: 1, seconds: 90, output: 'fang_inlay', count: 2, materials: { sharpened_fang: 1 }, description: 'Разделение подготовленного клыка на две небольшие вставки.', workGuild: 'blacksmith' },
  ...METALS.flatMap((metal: any) => [
    {
      id: 'make_reinforced_fastening_' + metal.id,
      name: 'Изготовление усиленного крепления (' + metal.adj.toLowerCase() + ' проволока)',
      level: metal.level,
      seconds: 90 + Math.max(0, metal.level - 1) * 2,
      output: 'reinforced_fastening',
      count: 1,
      materials: { ['metal_' + metal.id + '_wire']: 1, leather_strip: 1 },
      description: 'Соединение кожаной полосы металлической проволокой соответствующего металла.',
      workGuild: 'blacksmith' as const
    },
    {
      id: 'make_reinforced_fabric_' + metal.id,
      name: 'Изготовление армированной ткани (' + metal.adj.toLowerCase() + ' проволока)',
      level: metal.level,
      seconds: 120 + Math.max(0, metal.level - 1) * 2,
      output: 'reinforced_fabric',
      count: 1,
      materials: { fabric: 1, ['metal_' + metal.id + '_wire']: 1 },
      description: 'Усиление общей ткани металлической проволокой соответствующего металла.',
      workGuild: 'blacksmith' as const
    },
    {
      id: 'make_reinforced_metal_node_' + metal.id,
      name: 'Изготовление усиленного металлического узла (' + metal.adj.toLowerCase() + ' металл)',
      level: metal.level,
      seconds: 150 + Math.max(0, metal.level - 1) * 2,
      output: 'reinforced_metal_node',
      count: 1,
      materials: {
        ['metal_' + metal.id + '_rod']: 1,
        ['metal_' + metal.id + '_plate']: 1,
        ['metal_' + metal.id + '_wire']: 1
      },
      description: 'Сборка силового узла из прутка, пластины и проволоки одного металла.',
      workGuild: 'blacksmith' as const
    }
  ]),
  {
    id: 'make_bone_overlay',
    name: 'Изготовление костяной накладки',
    level: 1,
    seconds: 90,
    output: 'bone_overlay',
    count: 1,
    materials: { bone_plate: 1, leather_blank: 1 },
    description: 'Соединение костяной пластины с универсальной кожаной заготовкой.',
    workGuild: 'blacksmith'
  },
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
