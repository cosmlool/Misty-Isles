# Проверка покрытия входов рецептов новой брони

Дата: 2026-11-28  
Источники: `server/src/armorCatalog.ts`, `server/src/resourceCatalog.ts`, `RESOURCE_ID_INVENTORY.md`.

## Результат

- Проверены все 78 рецептов брони.
- Найдено 21 уникальных прямых входных resource ID.
- Все прямые входы присутствуют в утверждённом ресурсном каталоге и имеют производственную цепочку в `RESOURCE_RECIPES` (включая параметризованные семейства металлических заготовок и усиленных креплений).
- Непокрытых прямых входных ID в броневых рецептах не обнаружено.

## Полный набор прямых входов

- `fabric`
- `leather_blank`
- `leather_strip`
- `metal_astralite_plate`
- `metal_astralite_sheet`
- `metal_astralite_wire`
- `metal_copper_plate`
- `metal_copper_sheet`
- `metal_copper_wire`
- `metal_deep_silver_plate`
- `metal_deep_silver_sheet`
- `metal_deep_silver_wire`
- `metal_iron_plate`
- `metal_iron_sheet`
- `metal_iron_wire`
- `metal_steel_plate`
- `metal_steel_sheet`
- `metal_steel_wire`
- `processed_leather`
- `reinforced_fastening`
- `thread`

## Цепочки, подтверждённые текущим каталогом

| Прямой вход брони | Действующая цепочка |
|---|---|
| `fabric` | 3 `thread` → 1 ткань |
| `thread` | 3 `plant_fiber` → 1 нить **или** 3 `wool` → 1 нить |
| `processed_leather` | 3 `hide` → 1 кожа **или** 3 `rough_hide` → 1 кожа |
| `leather_strip` | 1 `processed_leather` → 2 полосы |
| `leather_blank` | 2 `processed_leather` → 1 заготовка |
| `reinforced_fastening` | 1 металлическая проволока + 1 `leather_strip` → 1 крепление; есть варианты для пяти металлов |
| `metal_<grade>_plate` | 2 слитка того же металла → 1 пластина |
| `metal_<grade>_sheet` | 3 слитка того же металла → 1 лист |
| `metal_<grade>_wire` | 1 слиток того же металла → 2 проволоки |

## Оставшиеся неопределённости

- Броня использует общий `reinforced_fastening`, не указывая металл. Пять производственных вариантов создают один ID. Поэтому покрытие существует, но требуемый грейд металла и его распределение по ступеням брони не определены.
- Текстильная и кожевенная цепочки имеют альтернативные исходные ресурсы; текущие рецепты не устанавливают доли их использования.
- Наличие рецепта не подтверждает наличие источника сырья в PvE. Добыча/дроп не назначались.
- Требование рабочей гильдии и параметры очереди не менялись.

Новые рецепты и материалы не добавлялись; игровых данных, drops, монстров, зон, runtime и сохранений аудит не меняет.
