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
- It verifies roster order; player snapshot ID/HP; both saved request-history representations (`dungeonLastRequest` and `dungeonRequestHistory`) including report, text and binding; and the outbox event ID/run ID/recipient/message/payload. It then delegates immutable snapshot validation and freezing to `createPreparedDungeonEncounter()`.
- `PreparedDungeonEncounter` now optionally retains the exact per-participant outbox events. The field is optional so previously persisted version-1 prepared snapshots remain readable; when supplied, it is strictly validated against the frozen roster, reports, result text and request ID.
- Regression fixtures cover all four legacy outcome/party combinations: solo win, group win, solo loss and group loss. Assertions cover individualized XP/gold, post-healing/clamped HP, exact drop recipients, full player snapshots, request replay binding, outbox payload, JSON recovery of frozen outbox events, immutability and input non-mutation.

### Deliberate limit

The adapter is not yet called from production `runExpeditionDungeon()`, and no WAL transaction or live behavior was changed. The new tests validate the adapter contract with explicit legacy-shaped fixtures; they are not yet a golden comparison captured from a live runtime execution. The next safe step is a narrow, side-effect-free capture at the existing handler's settlement point plus parity assertions against its actual pre-persistence Player snapshots and events. Only after that proof should the live handler be switched to durable start/encounter commit/finalization.

No combat formulas, RNG call order, loot selection, reward modifiers, healing, attempt charging, request replay behavior, client protocol or player persistence timing changed. CI/tests were not run by the assistant; the user checks CI.


## Live legacy settlement capture — 2026-11-28

The user confirmed CI passed on the preceding adapter-only HEAD `a62248f`. The current runtime-capture commits are newer and have not yet been checked by CI.

- Production `runExpeditionDungeon()` now calls `prepareLegacyDungeonSettlement()` immediately before the existing `persistDungeonResultPlayers()` call in both victory and defeat branches.
- The capture takes the actual existing `combatPlan`, ordered participant IDs, already-rolled and allocated drop IDs/recipients, pre/post HP, actual per-player credited XP/gold, per-player loot IDs, exact member report/result text, complete `Player.toJSON()` snapshots and the exact request/outbox events already produced by the legacy settlement helper.
- Per-member report/text values are retained during the existing result loop; no second report calculation, reward calculation, healing, random roll, drop allocation, or clock read is introduced. `preparedAt` uses the already-recorded activity timestamps.
- The prepared snapshot is shadow-captured and not yet written to WAL or used as the source of live persistence. Existing `persistDungeonResultPlayers()`, rollback snapshots, deferred sends, replay behavior and outbox delivery remain the production path.
- Capture validation is fail-open for normal runtime: a capture error is logged and legacy persistence proceeds unchanged. With `MISTY_DUNGEON_PARITY_STRICT=1`, the same error is rethrown so integration tests cannot silently pass when the capture contract is broken.
- `groupDungeonRuntime.test.ts` enables strict capture on both server starts (including the restart/replay phase), covering real group win and loss. `dungeonAttemptsRuntime.test.ts` enables it for real solo win and loss plus personalized XP/gold modifier scenarios. The adapter unit suite also now exercises the exact `prepareDungeonMemberQuestSettlement()` helper and its generated request/outbox event rather than only a hand-written event fixture.
- The server test script already includes both runtime suites and the adapter suite; no script expansion was needed.

### Compatibility boundary

No combat formula, RNG call order, loot roll/allocation, healing, XP/gold amount, attempt charging, request replay, player save timing, client protocol or dungeon data changed. The capture creates an immutable shadow object and is not yet durable lifecycle integration.

Static GitHub source review confirms both live branches call the adapter before persistence and both runtime suites set strict mode. Tests and CI were not run by the assistant. The user must check CI on the current HEAD.

Next: after the user confirms CI for this HEAD, review the strict runtime results. If green, the next bounded stage is a transactional durable commit design that replaces the legacy one-shot persistence atomically (not a partial durable start). Keep multi-step catacomb rooms and new combat rules out of that transition.


## 2026-11-28 — атомарное подключение live settlement к shared WAL

Пользователь подтвердил CI как прошедший на предыдущем HEAD `8149085e889d00055542fffa0dc64b3b5ec91cfc` (этап live shadow capture). Изменения этого этапа сделаны уже после указанной проверки; новый HEAD ожидает отдельной проверки пользователя.

### Production integration

- `runExpeditionDungeon()` больше не использует shadow-only capture. Для победы и поражения он формирует immutable `PreparedDungeonEncounter` из фактических уже рассчитанных результатов legacy handler.
- До фиксации сохраняются фактические ordered participant IDs, request binding, исходные и конечные HP, индивидуальные XP/gold, loot IDs и получатели, точные reports/result texts, полные нормализованные Player snapshots и outbox events.
- Создаётся terminal run envelope с реальным временем начала, лидером, группой, roster и boss identity. Он не публикуется как active run.
- Новый `commitPreparedLegacyDungeonSettlement()` в рамках **одной** `sharedStateRuntime.transactWithRecovery()` транзакции:
  1. проверяет/прикрепляет immutable encounter к run envelope;
  2. строит terminal outcome только из committed prepared encounter;
  3. объединяет frozen snapshots участников с полным player store, сохраняя всех неучаствующих персонажей;
  4. записывает `players.json`, terminal `dungeon_runs.json` и pending `dungeon_outbox.json` одним shared-WAL commit.
- Дневная попытка, уже учтённая существующим legacy settlement, попадает в тот же финальный Player snapshot и фиксируется вместе с наградами, HP, terminal run и outbox. Отдельный durable start и промежуточный active-run commit не добавлялись.
- Outbox delivery и ACK остаются после durable commit. Если отправка/ACK прервётся, pending event остаётся доступен для повторной доставки; event IDs и клиентская дедупликация сохранены.
- Повторная финализация того же prepared snapshot идемпотентна. Другой snapshot для уже terminal run отклоняется. WAL recovery восстанавливает все три целевых файла из одного журнала.
- При ошибке до создания WAL live Player возвращается к durable snapshot/rollback snapshot. При незавершённом WAL сервер не публикует несогласованное состояние и блокирует последующие записи до recovery.
- Полные snapshots участников нормализуются до capture; финализация не перезаписывает их более старыми значениями. Остальные online/saved игроки сохраняются в общем players store.

### Tests and files

- Новый `server/src/dungeonLegacySettlementCommitRuntime.ts` — composition layer для atomic commit.
- `server/src/dungeonPreparedEncounterFinalizationRuntime.ts` принимает полный player store и поверх него накладывает frozen participant snapshots.
- Новый `server/test/dungeonLegacySettlementCommitRuntime.test.ts` проверяет один commit с тремя WAL targets, сохранение постороннего игрока, terminal outcome, outbox, повторную идемпотентность и recovery после прерывания target write.
- `groupDungeonRuntime.test.ts` теперь проверяет terminal durable runs и outbox для group win/loss; `dungeonAttemptsRuntime.test.ts` — terminal records для solo win/loss. Удалён прежний strict-capture env flag: capture теперь является обязательной частью production persistence, а не fail-open shadow side effect.
- Новый тест добавлен в `server/package.json`.
- Ошибки capture/подготовки до commit откатывают live Player snapshots; commit failure использует WAL recovery и сверку с durable player store.
- Статически перечитаны production handler, settlement adapter, commit/finalization helpers, shared WAL, run validator, outbox delivery, runtime suites и новый WAL test. Это source review, не запуск тестов.

### Границы этапа

- Не менялись combat formulas, RNG call order, loot rolls/recipients, healing, XP/gold modifiers, attempt limit/charging rules, reports, request IDs, client protocol или dungeon content.
- Это атомарная фиксация уже рассчитанного legacy single-boss encounter. Она **не** означает, что active run уже сохраняется между раундами, что игрок может возобновить бой после рестарта, или что реализованы spectator/AFK/resurrection и новые многоступенчатые комнаты.
- CI и тесты после предыдущего подтверждённого пользователем HEAD `8149085` ассистентом не запускались. Текущий код ожидает пользовательскую CI-проверку.

### Следующий шаг

После CI на текущем HEAD продолжить полноценный resumable lifecycle: атомарный вход/списание попытки и durable active run, затем сохранение каждого разрешённого раунда и восстановление после рестарта. Сохранить текущие combat/reward semantics; не добавлять новые комнаты/roster монстров в рамках этого технического этапа.


### Final GitHub ref refresh — 2026-11-28

- Финальный HEAD после production code, runtime tests, WAL tests и журналов: `fa75ccf3b3b099b8ed8703706a5b681f953a829b`.
- PR #39 остаётся open, Draft, not merged; base `main`; рабочая ветка `feature/resource-catalog-implementation-2026-11-26`.
- Пользовательский CI pass был подтверждён для предыдущего HEAD `8149085e889d00055542fffa0dc64b3b5ec91cfc`. На финальном HEAD `fa75ccf` CI ещё ожидается.
- Ассистент не запускал тесты, CI или workflows. Source review и повторное чтение журналов выполнены; тестовые результаты не заявляются.

## 2026-11-28 — исправлены причины падения CI в durable dungeon settlement

- Пользователь сообщил, что CI не прошёл. Изучены оба workflow PR #39 на проверенном GitHub merge commit `67001ffb3d9b3d2b8e98796de8c9c4a174a34643` (head `6799be24af8e965bf7d80cf8e7274568aeb35c09`): Quality Gate и Server checks падали на одном наборе серверных тестов; 533 из 539 прошли.
- Две runtime-проверки (solo и group dungeon) завершались тайм-аутом до отправки результата. Причина — durable run envelope отклонял корректный текущий HP персонажа, когда он был выше вычисленного effectiveMaxHealth (в legacy saves/test fixtures такое превышение реально присутствует). При создании snapshot run теперь верхняя граница maxHealth равна `Math.max(effectiveMaxHealth(player), hpBefore)`; фактический HP не обрезается, боевой расчёт/лечение/награды не меняются.
- Три проверки `dungeonLegacySettlementCommitRuntime.test.ts` передавали пустой `runs` store, хотя контракт atomic commit требует заранее созданный run envelope. Все четыре fixture calls теперь передают свой корректный `{ [run.runId]: run }`, включая сценарий stale recovery (где проверка recovery по-прежнему должна срабатывать первой).
- Проверка `playerPersistenceWriters.test.ts` ожидала устаревшую сигнатуру legacy persistence. Обновлено ожидание на фактический вызов атомарного commit с `preparedEncounter`, `durableRun` и rollback snapshots.
- Изменены: `server/src/index.ts`, `server/test/dungeonLegacySettlementCommitRuntime.test.ts`, `server/test/playerPersistenceWriters.test.ts`.
- Статически перечитаны обновлённые файлы после записи. Ассистент не запускал тесты и не запускал/перезапускал CI; исправления ожидают пользовательской проверки.
- Workflow build был пропущен вследствие раннего падения server test step; успешная сборка нового HEAD не заявляется.
- Следующий шаг: пользователь проверяет CI на новом HEAD. Не объединять PR #39; после успешной проверки продолжить следующий записанный этап durable active-run entry/per-round commit/recovery.
