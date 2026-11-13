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


## Этап: извлечение подготовки добычи (2026-11-13)

- Добавлен `server/src/dungeonDropPreparation.ts`.
- `rollDungeonDropIds` выполняет броски в прежнем порядке: гарантированный ресурс добавляется первым; каждый дополнительный drop (кроме дубликата гарантированного ресурса) проверяется тем же выражением `Math.min(0.95, chance * (1 + dropBonus))`. RNG передаётся снаружи, функция сама не генерирует случайность.
- `allocateDungeonDropRecipients` распределяет каждый уже выпавший предмет по одному участнику, сохраняя порядок предметов и порядок вызовов генератора индекса.
- `runExpeditionDungeon()` использует обе функции на прежних позициях выполнения. Формулы dropBonus, шанс, гарантированный ресурс и RNG остаются прежними; выбор получателей происходит в прежней фазе после начисления наград.
- Добавлены 4 теста: порядок и число RNG-вызовов, 95% cap, сохранение порядка распределения и отклонение недопустимого индекса/повторного roster ID.
- Тест добавлен в `server/package.json`.
- Это только извлечение подзадач. Игроки всё ещё мутируются legacy handler напрямую; detached settlement snapshots и durable live recovery не подключены.


## Этап: извлечение подготовки отчётов участников (2026-11-13)

- Добавлен pure helper `server/src/dungeonMemberCombatReport.ts`; обе ветки победы и поражения в `runExpeditionDungeon()` используют его для построения индивидуального combat report.
- Сохранены прежние поля и значения: fallback профессии `Без профессии`, округление `Math.floor` для attack/defense/damage, HP до/после, incoming damage, maxHealth.
- Победа передаёт персональные XP/gold/loot; поражение сохраняет нулевые награды базового отчёта. Общий report не мутируется, вложенный объект rewards для победителя копируется.
- Добавлены 3 regression tests: win/personal rewards/rounding, loss/zero rewards, profession fallback/base immutability. Тест включён в server test script.
- RNG, combat plan, начисления, инвентарь, request history, outbox payloads и порядок выполнения не менялись.
- Кодовые commits: helper `c38f93d6f8ddede836bd1fa4ae865129643ae837`, handler `4fe39e369c68c2ec77aa5d5529f1833824466a1e`, tests `3371f27b25cf9911333ac4e27844afe340ace562`, test script `f03d8837b0baa6961ef04354acc4329dcb4541e0`.
- Предыдущий Quality Gate на HEAD `73c63f001dfaf47df992052ad6f6bc6d25b304b3` завершился успешно по всем 4 jobs. Новый HEAD требует отдельного полного CI подтверждения.
- Это изоляция подготовки отчёта, а не подключение durable run lifecycle или изменение игровых правил.


## Этап: извлечение общего отчёта подземелья (2026-11-13)

- Добавлен pure helper `server/src/dungeonGroupCombatReport.ts`: `buildDungeonGroupCombatReport()` строит общий report для победы и поражения без доступа к runtime state.
- Обе ветки `runExpeditionDungeon()` используют helper. Вызов по-прежнему происходит в прежней точке каждой ветки, а `at: Date.now()` вычисляется непосредственно при вызове, без дополнительного чтения времени внутри helper.
- Сохранены точные ключи и значения report, win/loss rewards, порядок и текст строк `lines`. Для поражения XP/gold/loot остаются нулевыми/пустыми; для победы сохраняются исходные dungeon XP, разделённое золото и список выпавших предметов.
- Добавлены regression tests для точного win/loss report, rewards, line order, timestamp и отсутствия мутации входа. Тест включён в `server/package.json`.
- Изменены только подготовка общего report и тестовая инфраструктура. Combat plan, RNG, награды игроков, HP, inventory, request history, outbox и момент сохранения не менялись.
- Helper commit: `1411e5ef5cd1905cbf9583dde60cd0a4593603e2`; tests: `435795b92790b3ef9a8b5de4d4142921371e4471`; test script: `fb829d37d90aab489310294c0ca5f6434e6d1e40`; handler: `caea5971af97a51648a648b3581242af0ff5824b`.
- Новый HEAD требует полного CI. Не считать этап подтверждённым до успешных server tests/build и Quality Gate.
- Live handler по-прежнему legacy; detached settlement и durable live lifecycle integration не подключены.


## Этап: извлечение дневного счётчика попыток (2026-11-13)

- Добавлен pure helper `server/src/dungeonAttemptPreparation.ts`: `getDungeonRunsForDay` читает число попыток только для совпадающего ключа дня; `consumeDungeonAttemptForDay` возвращает новый quest snapshot с увеличенным счётчиком.
- Live handler использует helper и при проверке лимита, и при списании попытки. Сохранены прежняя числовая coercion `Number(value || 0)`, дневной rollover, значение лимита 3 и момент списания до результата боя.
- Входной quest object не мутируется; остальные quest-поля сохраняются.
- Добавлены 4 regression tests: совпадающий/другой день, rollover, инкремент, отсутствие мутации и legacy numeric coercion. Тест включён в server test script.
- Не менялись UTC day key, combat plan, RNG, rewards, HP, inventory, reports, request history, outbox или persistence boundary.
- Это изоляция только дневного счётчика; live dungeon handler остаётся legacy, detached player settlement и durable lifecycle integration не подключены.


## Этап: подготовка replay history и outbox event (2026-11-13)

- Добавлен pure helper `server/src/dungeonRequestResultPreparation.ts`.
- Helper формирует detached quest snapshot с `dungeonRequestHistory` и `dungeonLastRequest`, удаляет прежнюю запись с тем же request ID и сохраняет последние 5 записей.
- Одновременно формируется legacy outbox event с прежними `eventId`, `runId`, `playerId`, `messageType` и payload.
- Обе ветки live handler (победа и поражение) используют один helper; прежний формат результата и event identity сохранены.
- Добавлены 4 regression tests: повторный request ID/лимит истории, точная event identity, некорректная история и отсутствие мутации исходного quest snapshot. Тест включён в server test script.
- Helper и тесты пока не меняют durable lifecycle: live handler по-прежнему сохраняет результат через существующий `persistDungeonResultPlayers()`; полноценная detached settlement и durable recovery integration не подключены.
- CI для нового HEAD ожидает проверки.


## Этап: detached подготовка quest settlement участника (2026-11-13)

- Добавлен pure helper `server/src/dungeonMemberQuestSettlement.ts`: одним новым quest snapshot объединяет dungeon activity, combat history и request replay/outbox event.
- Сохранены legacy правила: дневной rollover activity, инкремент `activityToday.dungeons`, порядок/лимит activity log (30), combat history (20), request history (5), `dungeonLastRequest` и прежняя event identity/payload.
- `now` для activity по-прежнему захватывается в исходной точке ветки победы/поражения; helper не вызывает часы самостоятельно.
- Обе ветки live handler теперь формируют quest snapshot без промежуточных мутаций `member.quests`, затем присваивают его один раз. История для клиента берётся из подготовленного snapshot.
- Добавлены 3 regression tests: дневной rollover, сохранение same-day counters, лимиты логов, replay/outbox и отсутствие мутации исходного quest object. Тест зарегистрирован в server test script.
- Изменение не меняет combat formulas, RNG, rewards, HP, inventory, report contents, request ID, outbox delivery или transaction boundary.
- Это только detached preparation quest state, не durable dungeon lifecycle integration. `runExpeditionDungeon()` по-прежнему использует legacy прямые player mutations и `persistDungeonResultPlayers()`.


## Исправление дневной статистики наград подземелья (2026-11-13)

- Интеграционный тест на PR HEAD `1d4dcaad` выявил, что detached settlement увеличивал `activityToday.dungeons`, но не суммировал фактически выданные золото и опыт.
- `prepareDungeonMemberQuestSettlement` теперь добавляет `activity.gold` и `activity.xp` к дневным итогам. Используются персональные значения после модификаторов; поражение добавляет нули.
- Исправлены unit expectations для rollover и same-day накопления; групповой runtime test проверяет 110 gold и 420 XP на участника.
- Это исправление отображаемой дневной статистики; боевые формулы, начисление наград игроку и persistence boundary не меняются.


## Этап: изоляция расчёта HP участника подземелья (2026-11-13)

- Добавлен pure helper `server/src/dungeonMemberHealthOutcome.ts`: `prepareDungeonMemberHealthOutcome()` рассчитывает HP после входящего урона, вампиризма и группового лечения Баффера.
- Ветка победы использует helper вместо последовательной прямой записи HP; ветка поражения использует тот же helper только для урона и минимального HP=1.
- Сохранён порядок legacy-операций: сначала урон с нижней границей 1, затем вампиризм с верхней границей maxHealth, затем лечение Баффера (4% maxHealth × healingMultiplier) с верхней границей maxHealth.
- Коэффициенты, округление Math.floor, maxHealth, условия профессии и входные значения не изменялись.
- Добавлены 4 unit tests: порядок урона/лечения, нижняя и верхняя границы HP, общий healing multiplier, отсутствие лечения при поражении. Тест включён в server test script.
- Изменение ограничено подготовкой итогового HP. Остальные Player поля по-прежнему мутируются legacy handler; transaction/persistence boundary не менялась.
- Кодовые commits: helper `b9c118df6c377fb2c57c4296b66dff3f83235cce`; tests `368d94e3d0f927c3e2bc69d06ddc9d6cec76d3cf`; test script `ac51746324f6c29e3580cd0080cd4859e6c2bc54`; test expectation correction `49d29134212ce6367b15fc6df5ed0a19b53a3f66`; handler `308acb9359dcca4b713b1e0911df55e7d7b4bbb0`.
- Новый HEAD требует полного CI подтверждения. До завершения CI не начинать следующий кодовый этап.
- PR #15 остаётся Draft/open, merged=false; merge не выполнять. Полная durable dungeon lifecycle integration НЕ подключена.


## Этап: recovery gate перед dungeon mutation (2026-11-13)

- Полный просмотр live `runExpeditionDungeon()` выявил важную границу: handler до вызова `persistDungeonResultPlayers()` меняет живые Player объекты (попытки, battles, HP, награды, inventory и quests).
- Общий WAL runtime может восстановить более свежий сохранённый snapshot непосредственно внутри persistence-вызова. Если это произошло, прежняя проверка `recovered` отклоняла commit, но online Player объекты уже содержали рассчитанные legacy изменения.
- Исправлено: `runExpeditionDungeon()` теперь вызывает `recoverPlayerStateBeforeMutation()` до чтения группы, roster, попыток, RNG и любых игровых изменений. Если recovery был выполнен, online players синхронизируются с восстановленными сохранениями, а dungeon request отклоняется с просьбой повторить вход. Бой и расход попытки в этом вызове не запускаются.
- Это закрывает окно восстановления перед мутациями, не меняя combat formulas, RNG, награды, drop allocation, report, outbox или WAL transaction boundary.
- Commit: `a11002b36e2f8b456e683f12618ff5fe04afe69b`. Shared runtime tests уже покрывают сигнал recovery; новый handler HEAD требует полного CI подтверждения.
- Durable dungeon lifecycle integration по-прежнему НЕ подключена; PR #15 остаётся Draft/open, merge запрещён.

## Этап: восстановление online Player после ошибки settlement persistence (2026-11-13)

- Новый просмотр `sharedStateTransactions.transact()` подтвердил отдельное окно отказа: `prepareAfterRecovery`, `validateFiles` и запись самого WAL выполняются до внутреннего блока replay. Ошибка на этих шагах выбрасывается до commit, но live dungeon handler к этому моменту уже меняет объекты `Player`.
- В `runExpeditionDungeon()` теперь сохраняются detached snapshots всех участников до игровых мутаций. Если settlement persistence падает до создания WAL, участники восстанавливаются из этих snapshots.
- Если WAL уже существует, runtime повторно пытается выполнить recovery и синхронизирует online players с текущим durable `players.json`, даже если replay остаётся заблокированным. Ошибка исходного сохранения по-прежнему возвращается; pending journal не удаляется и дальнейшие writers остаются fail-closed.
- Общие `persistPlayers()` и `transactClanMutation()` также синхронизируют online players с durable snapshot после ошибки записи, поскольку их callbacks могут выполняться после live mutations. Auction operations остаются detached snapshot transactions.
- Добавлен тест отказа при создании WAL: target files должны остаться без изменений. Добавлены regression assertions на snapshot capture/rollback и recovery branch.
- Не менялись combat formulas, RNG, попытки, rewards, inventory allocation, report, outbox identity или transaction commit semantics. Это защита live memory consistency при persistence failure, а не подключение durable dungeon lifecycle.
- Новый HEAD требует полного CI; PR #15 остаётся Draft/open, merged=false.

## Дополнительная проверка persistence callers: room leave (2026-11-14)

- После успешного CI на HEAD `73b22a783b65911513aa910edf13ee4d68405498` просмотрены все call sites `persistPlayers`, `persistPlayer`, `persistDungeonResultPlayers`, `transactClanMutation` и прямые `applySaved` в `server/src/index.ts`.
- Найдено пересечение старого и нового rollback поведения в `Room.onLeave()`: `persistPlayers()` теперь при ошибке сам восстанавливает online players из durable snapshot, но локальный catch затем повторно записывал в `player.quests` устаревшие значения, снятые до persistence. Это могло частично отменить reconciliation.
- Удалён устаревший локальный rollback. `onLeave()` теперь полагается на единый reconciliation path `persistPlayers()`; если запись не удалась, ошибка продолжает пробрасываться, а live objects не перезаписываются устаревшим quest snapshot.
- Добавлен source regression test, который проверяет lifecycle section и запрещает повторный stale rollback.
- Другие проверенные call sites: expedition mutations идут через `persistPlayers`; friend acceptance через `persistPlayer` (который сохраняет весь online snapshot); clan mutations через guarded `transactClanMutation`; auction commits строят detached snapshots и применяют их только после успешного commit. Не найдено второго локального rollback, который перезаписывает reconciliation.
- Новые изменения требуют полного CI. PR #15 остаётся Draft/open, merged=false.
