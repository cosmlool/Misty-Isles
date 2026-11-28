# Аудит готовности durable lifecycle катакомб к live handler

Дата: 2026-11-28  
Проверенная ветка: `feature/resource-catalog-implementation-2026-11-26`  
HEAD до документационных изменений: `9de20f400978920015ae0efbac81e5066ce6afa0`

## Подтверждённое состояние

- В production `server/src/index.ts` обработчик `runExpeditionDungeon()` остаётся синхронным legacy-проходом: один босс, один расчёт, немедленные изменения Player, награды/добыча и финальная запись через `persistDungeonResultPlayers()`. Сообщение `dungeonRun` по-прежнему находит запись по `DUNGEONS` и вызывает этот handler.
- В `server/data/dungeon_encounters.json` четыре старых dungeon ID (`fl_dungeon_03/06/09/10`) описаны как ровно один encounter → одна boss wave → один существующий босс. Это адаптер совместимости старого контента, а не утверждённые четыре новые катакомбы и не многошаговый runtime.
- Текущий `server/src/dungeonEncounterConfig.ts` валидирует IDs/ссылки/количества и намеренно отклоняет конфигурацию, которую нельзя спроецировать в legacy single-boss контракт. Production handler пока не использует этот конфиг для прохождения ступеней.
- Durable foundation присутствует: `dungeon_runs.json` в shared WAL; versioned `DungeonRunRecord`; frozen participant roster; start transaction; resumable round plan; encounter commit; finalization; recovery routing; result outbox; resurrection snapshot helper. Это подготовленные транзакционные кирпичи, не подключённый live lifecycle.
- `createPreparedDungeonEncounter()` в `dungeonEncounterPreparation.ts` уже валидирует и глубоко замораживает immutable snapshot с результатом боя, заранее выбранными drops/получателями, per-player reports/text и полными player snapshots. JSON recovery validator есть. Тесты покрывают immutability, JSON round-trip, соответствие распределения loot и HP.
- Однако helper и WAL runtime не вызываются production `runExpeditionDungeon()`. Текущий handler продолжает менять live Player до единственной финальной persistence-операции. Поэтому нельзя просто добавить `commitDungeonRunStart()` или round commits: это создаст риск двойного списания попытки, смешанного legacy/durable settlement и orphan active run.

## Контент и игровые правила

- В утверждённом дизайне: четыре катакомбы под нейтральными городами, вход с 40 уровня, ступени проходятся последовательно, предыдущая ступень недоступна повторно в рамках текущего забега, обычные сложные монстры и боссы без волн, группа движется вместе. Нет анимаций и звуков.
- Отдельная спецификация `DUNGEON_LIFECYCLE_DESIGN.md` также закрепляет группу максимум из трёх, отсутствие смены лидера, spectator для погибшего обычного участника, прекращение забега при смерти лидера без воскрешения, 60-минутный AFK лидера с disband всей группы, durable resume после рестарта и отдельные правила свитков воскрешения.
- В текущем legacy handler отсутствуют durable active run, spectator/AFK lifecycle и playable resurrection loop. Наличие recovery UI/helper не означает, что игрок уже может возобновить забег или воскресить союзника в live игре.
- Старый `rooms` в `forgotten_lands.json` — описательные названия, не roster монстров. Текущие encounter JSON также содержит только старых боссов. Не превращать эти данные в новые ступени/составы катакомб без утверждённого состава и уровней.

## Критические границы безопасности

1. Не подключать durable start отдельно от подготовленного settlement: daily attempts/battles должны списываться ровно один раз в той же согласованной схеме.
2. Сначала получить точный parity snapshot текущего legacy handler: combat result, win/loss, all random drop IDs and recipients, post-combat HP/healing, per-player XP/gold/counters/inventory/quests/reports/outbox. Все RNG outcomes фиксируются единожды до commit.
3. Retry/restart должны использовать только committed prepared snapshot; нельзя пересчитывать по текущему equipment/buffs или заново бросать RNG.
4. Finalization должна применять только frozen player snapshots + terminal run + outbox в одной WAL transaction.
5. Смерть/ spectator semantics ещё требуют отдельной сверки с текущим условием legacy victory и HP clamp. Не менять формулы или трактовку смерти в рамках extraction.
6. Текущий `DUNGEON_LIVE_HANDLER_INTEGRATION.md` содержит историческую шапку с другой веткой `stage29/clean-validation-recovery` и старым checkpoint SHA. Не считать эту шапку текущим состоянием `feature/resource-catalog-implementation-2026-11-26`; фактическая проверка выполнена по указанной здесь ветке и HEAD.

## Следующий технический этап

Сначала реализовать и протестировать **pure legacy-settlement adapter/parity boundary**, который строит `PreparedDungeonEncounter` из уже рассчитанных результатов legacy handler, не меняя момент RNG, формулы, порядок начислений, HP, drops или live persistence. Добавить regression tests на win/loss, соло/группу, персональные модификаторы XP/gold, healing, exact loot recipient, request/outbox payload и полные player snapshots. Сравнить подготовленные snapshots с прежним результатом legacy runtime.

Только после успешного parity доказательства в отдельном этапе переключать handler на durable start → prepared encounter commit → finalization. Многоступенчатые катакомбы, roster новых монстров, смерть/spectator/AFK и клиентские действия не смешивать с этим первым переходом.

## Изменения этого аудита

Только документация. Не менялись production code, encounter JSON, dungeon content, combat formulas, RNG, rewards, drops, player saves, client protocol или PR state. Пользователь сообщил, что CI прошёл; workflow самостоятельно не запускались.


## Pure legacy settlement adapter — 2026-11-28

Added `server/src/dungeonLegacySettlementAdapter.ts` as a pure mapping boundary from the already-calculated legacy result into `PreparedDungeonEncounter`.

- The adapter accepts the frozen ordered roster, existing combat result, already-rolled drop IDs and recipients, each participant's post-healing HP, already-calculated personalized XP/gold, exact report/result text, complete `Player.toJSON()` snapshot, and exact legacy request/outbox event.
- It does not call combat math, RNG, healing, reward calculation, clocks, persistence, or network sends.
- It verifies roster order; player snapshot ID/HP; the saved `dungeonLastRequest` identity, report, text and binding; and the outbox event ID/run ID/recipient/message/payload. It then delegates immutable snapshot validation and freezing to `createPreparedDungeonEncounter()`.
- `PreparedDungeonEncounter` now optionally retains the exact per-participant outbox events. The field is optional so previously persisted version-1 prepared snapshots remain readable; when supplied, it is strictly validated against the frozen roster, reports, result text and request ID.
- Regression fixtures cover all four legacy outcome/party combinations: solo win, group win, solo loss and group loss. Assertions cover individualized XP/gold, post-healing/clamped HP, exact drop recipients, full player snapshots, request replay binding, outbox payload, immutability and input non-mutation.

### Deliberate limit

The adapter is not yet called from production `runExpeditionDungeon()`, and no WAL transaction or live behavior was changed. The new tests validate the adapter contract with explicit legacy-shaped fixtures; they are not yet a golden comparison captured from a live runtime execution. The next safe step is a narrow, side-effect-free capture at the existing handler's settlement point plus parity assertions against its actual pre-persistence Player snapshots and events. Only after that proof should the live handler be switched to durable start/encounter commit/finalization.

No combat formulas, RNG call order, loot selection, reward modifiers, healing, attempt charging, request replay behavior, client protocol or player persistence timing changed. CI/tests were not run by the assistant; the user checks CI.
