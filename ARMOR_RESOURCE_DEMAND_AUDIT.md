# Аудит прямого потребления ресурсов новой бронёй

Дата: 2026-11-28  
Источник: `server/src/armorCatalog.ts` рабочей ветки `feature/resource-catalog-implementation-2026-11-26`.  
Назначение: оценить подтверждённый производственный спрос до распределения ресурсов по источникам добычи.

## Объём

- В каталоге ровно 78 рецептов новой брони.
- На каждой ступени (1 / 20 / 40 / 60 / 80 / 100) — по 13 рецептов.
- Таблицы ниже показывают сумму материалов для изготовления каждого из 78 выходных предметов ровно по одному разу. Это расчёт прямого потребления рецептами брони, а не план добычи или требование к одному персонажу.

## Прямой расход по ступеням

### Уровень 1 — 13 рецептов

| Resource ID | Суммарный расход |
|---|---:|
| `fabric` | 20 |
| `leather_blank` | 18 |
| `leather_strip` | 19 |
| `metal_copper_plate` | 9 |
| `metal_copper_sheet` | 3 |
| `metal_copper_wire` | 5 |
| `processed_leather` | 4 |
| `reinforced_fastening` | 15 |
| `thread` | 13 |

### Уровень 20 — 13 рецептов

| Resource ID | Суммарный расход |
|---|---:|
| `fabric` | 40 |
| `leather_blank` | 36 |
| `leather_strip` | 38 |
| `metal_iron_plate` | 18 |
| `metal_iron_sheet` | 6 |
| `metal_iron_wire` | 10 |
| `processed_leather` | 8 |
| `reinforced_fastening` | 30 |
| `thread` | 26 |

### Уровень 40 — 13 рецептов

| Resource ID | Суммарный расход |
|---|---:|
| `fabric` | 60 |
| `leather_blank` | 54 |
| `leather_strip` | 57 |
| `metal_steel_plate` | 27 |
| `metal_steel_sheet` | 9 |
| `metal_steel_wire` | 15 |
| `processed_leather` | 12 |
| `reinforced_fastening` | 45 |
| `thread` | 39 |

### Уровень 60 — 13 рецептов

| Resource ID | Суммарный расход |
|---|---:|
| `fabric` | 80 |
| `leather_blank` | 72 |
| `leather_strip` | 76 |
| `metal_deep_silver_plate` | 36 |
| `metal_deep_silver_sheet` | 12 |
| `metal_deep_silver_wire` | 20 |
| `processed_leather` | 16 |
| `reinforced_fastening` | 60 |
| `thread` | 52 |

### Уровень 80 — 13 рецептов

| Resource ID | Суммарный расход |
|---|---:|
| `fabric` | 100 |
| `leather_blank` | 90 |
| `leather_strip` | 95 |
| `metal_astralite_plate` | 45 |
| `metal_astralite_sheet` | 15 |
| `metal_astralite_wire` | 25 |
| `processed_leather` | 20 |
| `reinforced_fastening` | 75 |
| `thread` | 65 |

### Уровень 100 — 13 рецептов

| Resource ID | Суммарный расход |
|---|---:|
| `fabric` | 120 |
| `leather_blank` | 108 |
| `leather_strip` | 114 |
| `metal_astralite_plate` | 54 |
| `metal_astralite_sheet` | 18 |
| `metal_astralite_wire` | 30 |
| `processed_leather` | 24 |
| `reinforced_fastening` | 90 |
| `thread` | 78 |

## Совокупный прямой расход всех 78 рецептов

| Resource ID | Суммарный расход |
|---|---:|
| `fabric` | 420 |
| `leather_blank` | 378 |
| `leather_strip` | 399 |
| `metal_astralite_plate` | 99 |
| `metal_astralite_sheet` | 33 |
| `metal_astralite_wire` | 55 |
| `metal_copper_plate` | 9 |
| `metal_copper_sheet` | 3 |
| `metal_copper_wire` | 5 |
| `metal_deep_silver_plate` | 36 |
| `metal_deep_silver_sheet` | 12 |
| `metal_deep_silver_wire` | 20 |
| `metal_iron_plate` | 18 |
| `metal_iron_sheet` | 6 |
| `metal_iron_wire` | 10 |
| `metal_steel_plate` | 27 |
| `metal_steel_sheet` | 9 |
| `metal_steel_wire` | 15 |
| `processed_leather` | 84 |
| `reinforced_fastening` | 315 |
| `thread` | 273 |

## Интерпретация и границы

- Это именно прямые входы рецептов брони. Например, `fabric`, `thread`, `processed_leather`, `reinforced_fastening` и металлические заготовки — производственные материалы, которые сами имеют отдельные рецепты/цепочки.
- Для получения полного спроса на исходное сырьё потребуется отдельно развернуть цепочки `RESOURCE_RECIPES` до исходных ресурсов. Этот документ не пересчитывает полуфабрикаты в руду, древесину, волокно, шерсть или шкуры.
- Спрос не определяет, где материал должен выпадать: из монстров, через Добытчика, шахту, деревообработку или иной уже утверждённый источник. Источники не назначались.
- Никакие рецепты, количества, времена, resource ID, drop tables, монстры, зоны или runtime не менялись.
- Legacy `FLDROP` не включён в расчёт.

Следующий безопасный шаг — сверить ресурсные производственные рецепты и развернуть эти прямые потребности до исходных ресурсов, не затрагивая будущую таблицу monster drops.
