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
