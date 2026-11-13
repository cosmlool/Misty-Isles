# Интеграция durable dungeon в live handler

Статус: CI подтверждён зелёным на checkpoint HEAD `1811b12e14ed6e07f409f241f3670cf00fed550d`; pure recovery routing helper добавлен, live handler ещё не переключён.
Ветка: `stage29/clean-validation-recovery`.

## Добавленное recovery routing

`server/src/dungeonRequestRecovery.ts` классифицирует повторный request ID без изменения игроков:
- `not-found` — запрос ещё не начинался;
- `prepare-encounter` — active run без сохранённого encounter, можно продолжить подготовку без повторного входа;
- `finalize-committed-encounter` — encounter уже сохранён, разрешена только финализация из snapshot;
- `replay-terminal-result` — забег завершён, требуется воспроизвести сохранённый результат.

Helper проверяет полную identity запроса (dungeon/group/leader/roster), отклоняет повторный request ID с другой identity и обнаруживает дубли request ID в durable store. Он не выполняет combat, не бросает random и не списывает попытки.

Regression tests: `server/test/dungeonRequestRecovery.test.ts` — unknown request, active/no encounter, committed encounter, terminal replay, identity mismatch и duplicate durable request IDs. Проверка helper подтверждена полным CI на checkpoint HEAD `1811b12e14ed6e07f409f241f3670cf00fed550d`: Quality Gate run `43458901750` — все 4 jobs success (client build, data/docs, server TS build + transaction recovery tests, Playwright); Server checks run `43458901733` — success. Предыдущие отменённые дублирующие runs не считаются результатом.

## Что происходит сейчас

`server/src/index.ts → Room.runExpeditionDungeon()` выполняет весь бой синхронно:

1. Проверяет лидера, online roster, request ID/cache, active-run guard, уровень и дневные попытки.
2. Разрешает характеристики игроков и босса; вызывает `calculateDungeonCombatPlan()`.
3. Бросает случайные drop rolls через `Math.random()`, выбирает получателей через `rand()`.
4. Сразу меняет daily attempts, battle counters, HP, XP/gold, victories, inventory и activity history.
5. Строит combat reports и request history.
6. Сохраняет игроков вместе с dungeon result outbox через `persistDungeonResultPlayers()`, затем отправляет события.

Ключевой риск: расчёт, случайные результаты и изменение Player объектов смешаны в одном методе. При аварии до durable commit повторный запрос может пересчитать бой; при неверном порядке записи можно потерять или повторить награды.

## Уже готовые durable building blocks

- `dungeonRunState.ts`: run identity, roster, participant HP/status, optional round plan и prepared encounter.
- `dungeonRunStartRuntime.ts`: `commitDungeonRunStart()` — атомарно сохраняет попытки игроков и active run через shared WAL.
- `dungeonEncounterPreparation.ts`: `createPreparedDungeonEncounter()` — проверяет и замораживает combat result, drops/recipients, participant results и полные player snapshots.
- `dungeonEncounterCommitRuntime.ts`: `commitPreparedDungeonEncounter()` — сохраняет неизменяемый encounter в run через WAL.
- `dungeonPreparedEncounterFinalizationRuntime.ts`: `commitCommittedDungeonEncounterFinalization()` — берёт только ранее сохранённый encounter и атомарно пишет player snapshots, terminal run и outbox.
- `dungeonRequestRecovery.ts`: pure recovery routing для повторного request ID; пока не подключён к live handler.
- `dungeonResultOutboxDelivery.ts`: уже используется для последующей доставки событий.

Важное различие: `commitDungeonRunRound()` — инфраструктура для поэтапного раунда. Текущий live handler рассчитывает весь бой целиком. Не нужно искусственно разбивать его на раунды при первой интеграции; сначала сохранить прежнюю семантику боя.

## План безопасного подключения

1. **Durable entry.** После всех проверок и до боевого расчёта создать стабильный run ID и записать active run + расход попытки одной WAL-транзакцией. Убрать старое повторное увеличение `dungeonRuns`.
2. **Recovery routing.** Подключить pure helper выше: committed encounter — только финализировать из него; active без encounter — продолжить подготовку без повторного списания попытки. Другой запрос при active run отклонять.
3. **Pure preparation boundary.** Сохранить прежние формулы и порядок вычислений, но собирать все изменения в detached player snapshots. Все случайные drop rolls и recipients выбрать ровно один раз; не менять живые Player до durable commit.
4. **Encounter commit.** Записать frozen prepared encounter. После этого любые retry/restart используют только сохранённый snapshot.
5. **Finalization.** Из committed encounter атомарно применить полные player snapshots, terminal marker и outbox events. Затем обновить ONLINE_PLAYERS из committed snapshots и отправить outbox.
6. **Regression tests.** Entry crash/retry; duplicate request; crash до/после encounter commit; crash при finalization; повторная финализация; drop recipient stability; попытки не списываются дважды; победа и поражение; группа 1–3 игрока.

## Ограничения

- Не менять combat formulas, награды, drop chances, распределение золота/добычи и тексты без отдельного согласования.
- Не считать `client.send()` подтверждением получения браузером; оставить текущую outbox семантику и клиентскую дедупликацию.
- Не переводить live бой на round-by-round механику в рамках этой задачи.
- WAL recovery error требует перечитать актуальные players/runs/outbox snapshots; нельзя продолжать со старыми объектами в памяти.
- Не менять PR #15 из Draft и не объединять его без разрешения.
