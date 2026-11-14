# Контрольная точка продолжения Misty-Isles

Обновлено: 2026-11-13. Перед изменениями сверять точку с актуальным HEAD и GitHub Actions.

## Репозиторий и ограничения

- Репозиторий: `cosmlool/Misty-Isles`.
- Рабочая ветка: `stage29/clean-validation-recovery`.
- PR #15: https://github.com/cosmlool/Misty-Isles/pull/15 — Draft/open, не объединять без отдельного разрешения.
- PR #14 — исторический reference, не менять и не объединять без разрешения.
- Не менять баланс, цены, шансы и реальные сохранения без полного аудита и согласования.
- Работать последовательно, проверять CI на точном последнем HEAD, сохранять этапы коммитами и обновлять эту точку.

## Задача непосредственно перед просьбой о выборе пола

Да, это был отдельный dungeon durable outbox этап, а не задача по гендеру.

- Начальный commit `6b7b215a99e3b968937719d058904c51edcb409b`: foundation для `dungeon_outbox.json`, совместная WAL-запись с финальным состоянием и наградами.
- Затем эта задача была продолжена и фактически реализована следующими коммитами:
  - `aeedd1470ef2` — replay pending dungeon results при reconnect.
  - `f9f3e34629ca` — enqueue live dungeon results в durable outbox.
  - `0ad0220942ae` — сохранять и dispatch-ить результаты поражения через outbox.
  - `bb053ce0de90` — стабильные event IDs в сообщениях результата.
  - `e60e5f329e68` — сохранять тот же event ID при повторном запросе.
  - `ce36e5e65c5d`, `5146da9db5a8`, `45d2ddbc94ab` — клиентская дедупликация и persisted event IDs.
  - `ce7a3ea23d38` — restart/replay integration tests.
- В текущем коде server dispatch вызывает pending events при подключении игрока и после завершения результата. Server отмечает событие delivered только после успешного вызова `client.send`; клиент использует `eventId` для подавления повтора, сохраняя обработанные ID в localStorage.
- Тесты покрывают порядок send/ack, отказ отправки, отказ WAL-ack, адресацию по игроку, повторную доставку после simulated crash/restart, отсутствие повторной отправки после ACK и клиентскую дедупликацию после reload.
- Важное уточнение: это server-side transport ACK после успешного `client.send`, а не отдельное подтверждение от браузера. Клиентская дедупликация защищает от повторного отображения при повторной доставке.

## Задача выбора пола

Пользователь отдельно попросил выбор Male/Female для всех четырёх рас при создании персонажа. Это косметическое/информационное поле: без влияния на характеристики, формулы, навыки, профессии, экипировку, доступ и баланс. Пол должен сохраняться и отображаться в профиле. Не назначать существующим персонажам произвольное значение и не добавлять преимущества/классы/профессии.

## Следующая dungeon-задача после outbox delivery

Следующий незавершённый крупный этап — подключить durable encounter preparation/commit/finalization к реальному live handler.

- Вспомогательная инфраструктура уже есть: `PreparedDungeonEncounter`, immutable/frozen snapshots, durable attach к run, terminal finalization и соответствующие regression tests.
- Но live `runExpeditionDungeon()` в `server/src/index.ts` всё ещё синхронный legacy handler: рассчитывает бой и случайные результаты на месте, напрямую применяет XP/gold/loot/history, затем сохраняет итог. Само наличие durable start/round/finalization helpers не доказывает, что live бой переключён на них.
- Требуемая интеграция: единая immutable preparation, фиксирующая roster, combat result, все random outcomes, healing, HP, XP/gold, counters, inventory, quest/report/outbox snapshots; durable start/round/finalization; повтор запроса должен читать уже сохранённый результат, а не пересчитывать бой и не повторять награды.
- Не менять числовой баланс и не переписывать формулы боя в этом этапе. Сначала составить карту legacy handler → prepared snapshot → durable transaction, затем покрыть crash/retry tests на входе, раунде и финализации.

## E2E lockfile — завершено

- Исправлен Playwright tarball URL в `e2e/package-lock.json`; теперь E2E зависимости устанавливаются через `npm ci`.
- Проверен точный commit `bf2781716fc9f2cb99cdf07d2fb44f49a0a0748e`.
- Quality Gate run `43356896203`: success. Все 4 jobs прошли, включая Playwright browser smoke tests и чистую установку E2E lockfile.
- Server checks run `43356896223`: success.
- Следующий этап начат: добавлен `DUNGEON_LIVE_HANDLER_INTEGRATION.md` (commit `28f368fe96172558c8768ebf8bea55a2c014151d`). В документе зафиксированы legacy handler, готовые durable helpers, границы транзакций и безопасная последовательность интеграции.
- Перед следующим кодовым изменением перепроверить актуальный HEAD и CI. PR #15 оставить Draft.

## Durable dungeon entry — защита от повторного запуска

- На ветке добавлена защита в `server/src/dungeonRunStartTransaction.ts`.
- Повторный `requestId` теперь сверяет не только run/dungeon/group/leader/roster, но и boss ID.
- Если существующий run уже terminal (`completed` или `aborted`), повторный запуск отклоняется с требованием воспроизвести сохранённый результат, а не запускать бой заново.
- Добавлены regression tests в `server/test/dungeonRunStartTransaction.test.ts`: terminal replay и повторное использование request ID с другим boss.
- Коммиты: `d9273c6846923b40aa4c730c44a047dac705fd3c` (fix), `aa68ddeb71b8bfe3ad53f625057e8e358b86df3a` (tests).
- На момент checkpoint workflow/status для тестового коммита ещё не вернули CI results. Не считать тесты прошедшими; проверить CI на актуальном HEAD перед следующим кодовым этапом.
- Это защитное улучшение helper-уровня, не полная интеграция durable entry в `runExpeditionDungeon()`. Live handler пока legacy; не заявлять, что интеграция завершена.

## Recovery routing — 2026-11-13

- Добавлен `server/src/dungeonRequestRecovery.ts` (commit `956ca04e493993f325158aca16cb74cbab1fdcf1`): pure resolver повторного request ID.
- Состояния: `not-found`, `prepare-encounter` (active без committed encounter), `finalize-committed-encounter` (active с committed encounter), `replay-terminal-result` (terminal).
- Resolver проверяет dungeon/group/leader/participant roster, отклоняет identity mismatch и duplicate request IDs. Не меняет игроков, не рассчитывает бой, не бросает random и не списывает попытки.
- Regression tests: `server/test/dungeonRequestRecovery.test.ts` (commit `6fd854595c38b9d64dde52aa7e1f7850f1eb658a`).
- Документация обновлена: `DUNGEON_LIVE_HANDLER_INTEGRATION.md` (commit `cd61fd4de8fbbea46e8a910435eb00e4513507b1`).
- CI для code commit `6fd8545` запущен: Server checks run `43458815754`, job `server` ID `131999962446` был `in_progress` при последней проверке. Обязательно дождаться результата и исправить возможные ошибки.
- ВАЖНО: helper пока не подключён к `runExpeditionDungeon()`; live handler остаётся legacy. Не заявлять о завершённой интеграции.
- Последний известный code HEAD на момент записи: `6fd854595c38b9d64dde52aa7e1f7850f1eb658a`; затем docs commit `cd61fd4...`. Перед продолжением проверить PR head и CI.
- PR #15 остаётся Draft/open; не объединять без разрешения.

## PR

PR #15 остаётся Draft/open и не объединён. Слияние без отдельного разрешения пользователя запрещено.


## Актуальная контрольная точка — 2026-11-13 (после CI)

- PR #15 head на момент проверки: `1811b12e14ed6e07f409f241f3670cf00fed550d`; Draft/open, merged=false. Не объединять без разрешения.
- Последний code commit для recovery routing: `6fd854595c38b9d64dde52aa7e1f7850f1eb658a`; последующий checkpoint commit `1811b12...` включает документацию и контрольную точку.
- CI на точном PR head `1811b12...` полностью зелёный:
  - Quality Gate run `43458901750`: все 4 jobs success — client TypeScript/Vite, data/docs/structure, server transaction recovery tests + TypeScript build, Playwright browser smoke tests.
  - Server checks run `43458901733`: job success — isolated player-save tests и server build.
- Старые runs `43458804854` / `43458815818` содержали отменённые jobs из-за конкурирующих запусков; они заменены успешной полной проверкой на актуальном HEAD.
- Документ интеграции обновлён commit `8e02f6f9022a052e57c4fcea696cf87d08aed1eb`.
- Следующий кодовый этап: выделить из монолитного `Room.runExpeditionDungeon()` чистую preparation-функцию, которая работает с detached Player snapshots и фиксирует все текущие результаты (combat, drops/recipients, HP/healing, XP/gold, counters, inventory, activity, reports и outbox payloads), не меняя live Player. Сохранить без изменений формулы, порядок random rolls и распределение наград.
- Только после regression-тестов preparation boundary подключать durable start → prepared encounter commit → finalization/replay. Не включать live handler на частичную durable-схему: это может потерять попытки/награды или повторно выполнить бой.
- `runExpeditionDungeon()` пока legacy; recovery helper пока не подключён к live handler. Полная durable integration НЕ завершена.


## Контрольная точка — 2026-11-13 (извлечение добычи подземелья)

- Новый код: `server/src/dungeonDropPreparation.ts`.
- Live handler `Room.runExpeditionDungeon()` теперь вызывает `rollDungeonDropIds` и `allocateDungeonDropRecipients` вместо inline циклов.
- Сохранены формула dropBonus и cap 95%; гарантированный dungeon resource; исходный порядок бросков optional drops; recipient selection выполняется на прежнем участке после начисления XP/золота; каждый предмет назначается ровно одному участнику.
- RNG инъецируется из handler (`Math.random` и существующий `rand`), helper не создаёт собственный random stream.
- Регрессии: `server/test/dungeonDropPreparation.test.ts` — 4 теста; подключён в server test script.
- Кодовые commits: handler `0b59f851fd61d2e6316fb9c01234292b18a030cb`, helper `f9b7f481538e459161afe8ac2af7de033fda0d06`, tests `265e47d41cbf4a1de02d3dff92264dc99416a831`, test script `c52786ea0f20d3ff6df48e48696cb2747eab1a09`.
- Документация интеграции: `4c31d4a4a885ccaf0fa5a1628cd6ae8862b816c8`.
- Требуется дождаться CI на новом HEAD. Не считать этот этап подтверждённым до server build/test и полного Quality Gate.
- Следующая подзадача: вынести подготовку snapshot-отчётов и per-player settlement payload из handler, сохраняя точные legacy значения; затем покрыть это тестами до включения durable orchestration.
- Всё ещё НЕ реализовано: detached player settlement end-to-end; подключение `resolveDungeonRequestRecovery` к live handler; full durable commit/replay. PR #15 не сливать.


## Контрольная точка — 2026-11-13 (извлечение отчётов участников подземелья)

- Helper: `server/src/dungeonMemberCombatReport.ts`; live win/loss ветки `runExpeditionDungeon()` используют `buildDungeonMemberCombatReport`.
- Helper копирует базовый report, выставляет прежние participant поля, применяет `Math.floor` к attack/defense/damage и fallback профессии `Без профессии`. Победа получает персональные XP/gold/loot; поражение оставляет нулевые rewards базового report.
- Тесты: `server/test/dungeonMemberCombatReport.test.ts` — 3 проверки; добавлен в server test script.
- Коммиты: helper `c38f93d6f8ddede836bd1fa4ae865129643ae837`; handler `4fe39e369c68c2ec77aa5d5529f1833824466a1e`; test `3371f27b25cf9911333ac4e27844afe340ace562`; package script `f03d8837b0baa6961ef04354acc4329dcb4541e0`; integration doc `022aa4b3ec39a55cc9402b7cb465b70a04fc105b`.
- До этого полный Quality Gate на HEAD `73c63f001dfaf47df992052ad6f6bc6d25b304b3` прошёл 4/4 jobs. Новый HEAD пока ожидает полного CI.
- Следующий шаг после CI: проверить тесты/сборку на новом HEAD; исправить обнаруженное. Затем продолжить декомпозицию legacy handler малыми чистыми helper-ами без изменения combat/reward formulas, RNG порядка, persisted state и outbox semantics.
- Не включать частичную durable интеграцию. `runExpeditionDungeon()` всё ещё legacy; recovery routing helper не подключён; полная durable lifecycle integration не завершена.
- PR #15 остаётся Draft/open; не объединять без отдельного разрешения.


## CI correction — 2026-11-13

- На HEAD `db44014009810f45c07122594d56d3d8c8351a47` server checks завершились: все 354 теста прошли, но TypeScript build выявил ошибку вывода типа в `dungeonMemberCombatReport.ts` (поле `rewards` не было доступно на выведенном типе объекта).
- Исправлено в commit `1abc30687bc0d2f8cd981407f2124712bf7a57a1`: локальная переменная результата теперь явно типизирована как `Record<string, any>`; поведение helper не менялось.
- Требуется повторный полный CI на новом HEAD. Не считать исправление подтверждённым до успешного server build и Quality Gate.


## CI follow-up — 2026-11-13 (race equipment persistence assertion)

- На PR #15 HEAD `e2256dc80a5acbd5210e781597553815f920a001` server checks прошли: isolated player-save tests и TypeScript build — success.
- Quality Gate: client build, data/docs/structure audit и Playwright smoke tests прошли. Server TypeScript build job остановился на одном runtime-тесте из 354: `raceEquipmentRuntime.test.ts`, проверка экипировки Лучника сразу после сообщения об успешной экипировке прочитала сохранение до завершения асинхронной записи (`''` вместо `WPN-ЛУЧ-025`). Остальные 353 теста прошли.
- Исправлен только тест: добавлено ожидание фактического появления экипированного оружия в `players.json` перед проверкой. Игровая логика и правила экипировки не менялись.
- Test-only commit: `77122fa3e1b8e1a2ae279313186bb91acd24f53a`.
- Требуется полный CI на новом HEAD; до его завершения Quality Gate не считать зелёным.
- PR #15 остаётся Draft/open, merged=false. Durable dungeon lifecycle по-прежнему не подключён.


## Контрольная точка — 2026-11-13 (общий отчёт подземелья)

- Извлечён pure helper `server/src/dungeonGroupCombatReport.ts`; победа и поражение в `Room.runExpeditionDungeon()` используют `buildDungeonGroupCombatReport()`.
- Сохранены точные поля/значения общего report, win/loss rewards и порядок/тексты `lines`. Время передаётся явно через `at: Date.now()` в прежнем месте вызова; helper не вызывает часы сам.
- Regression tests: `server/test/dungeonGroupCombatReport.test.ts` — точный win report, loss report, rewards, строки, timestamp и отсутствие мутации входа. Тест включён в server test script.
- Коммиты: helper `1411e5ef5cd1905cbf9583dde60cd0a4593603e2`; tests `435795b92790b3ef9a8b5de4d4142921371e4471`; test script `fb829d37d90aab489310294c0ca5f6434e6d1e40`; handler `caea5971af97a51648a648b3581242af0ff5824b`; integration doc `197268322234a8456455fe0d4ea74c38ec576043`.
- На предыдущем HEAD `ebb8991953548e21463bf7f069c473af73b4b933` все server checks и все 4 Quality Gate jobs завершились успешно. Эти результаты не относятся к новым коммитам.
- Текущий этап ожидает новый CI на свежем HEAD. До завершения CI не вносить новые кодовые изменения.
- Изменение не затрагивает combat formulas, RNG calls/order, reward calculation, player HP/inventory, request history, outbox или момент persistence.
- Live `runExpeditionDungeon()` остаётся legacy; detached settlement и полная durable lifecycle integration не подключены. PR #15 оставить Draft/open, не объединять без разрешения.


## Контрольная точка — 2026-11-13 (дневные попытки подземелья)

- Перед этапом проверен PR #15: HEAD `cf8239d0e8f9a9389ba6f48df9473ca8a7882a62`, Draft/open, merged=false.
- Повторный запуск серверного job после прежнего нестабильного PvP-теста завершился success: run `43469653763`, attempt 3; все 4 Quality Gate jobs success. Это подтверждает повторный прогон, но само по себе не доказывает устранение причины первоначального race; PvP-код не менялся.
- Извлечён pure helper `server/src/dungeonAttemptPreparation.ts`:
  - `getDungeonRunsForDay` учитывает сохранённый счётчик только при совпадении дневного ключа.
  - `consumeDungeonAttemptForDay` возвращает новый quest object, обновляет день и увеличивает счётчик, сохраняя остальные поля.
  - Сохранена legacy coercion `Number(value || 0)`; helper не мутирует вход.
- Live `runExpeditionDungeon()` использует helper в проверке лимита и при списании попытки. Сохранены лимит 3, UTC day key и исходная точка списания попытки до боя.
- Добавлены 4 regression tests в `server/test/dungeonAttemptPreparation.test.ts`; тест включён в `server/package.json`.
- Кодовые commits: handler `1eb841c60a97d39880d0d4d233a5a8d1abcc9816`, helper `1e1a6affb0de703c14a43418cc55951cc6b6a508`, tests `69f384798f7d5d980902aff88a6d40348c57957e`, test script `668c3395d9907d77df734049cedcec6935da8cf9`; integration doc `60f7c7ff0bcd8f2fa717652ea06ee0252c398f0b`.
- Новый HEAD требует полного CI. Не считать этап подтверждённым до server tests/build и всех Quality Gate jobs.
- Не менялись combat formulas, RNG, XP/gold, HP, inventory, reports, request history, outbox и момент persistence. Live dungeon handler остаётся legacy; detached settlement и полная durable lifecycle integration НЕ подключены.
- PR #15 оставить Draft/open; не объединять без отдельного разрешения.
- Следующая подзадача после CI: продолжить изоляцию detached settlement небольшими pure helper-ами, сохраняя legacy порядок и точные persisted payloads; не включать частичную durable orchestration.


## Контрольная точка — 2026-11-13 (подготовка replay history и outbox event)

- CI предыдущего HEAD `6bb2a2bc6fcae4fcffbd8d15c6a6072fab3e774d` завершился полностью успешно: Quality Gate run `43481584530` — 4/4 jobs success; Server workflow run `43481590002` — success.
- Добавлен pure helper `server/src/dungeonRequestResultPreparation.ts` (`prepareDungeonRequestResult`): возвращает новый quest snapshot и точный legacy outbox event.
- Сохранена семантика request history: удалить запись с текущим request ID, добавить актуальный report/text, оставить последние 5; обновить `dungeonLastRequest`.
- Сохранены event ID `dungeon:legacy_<requestId>:<playerId>:combatResult`, run ID, player ID, message type и payload.
- Обе live ветки (win/loss) переведены на helper; исходный quest object не мутируется.
- Добавлены 4 regression tests и регистрация в `server/package.json`.
- Commits: helper `03a0b319d553a8ee06c6e74d59a4828e66e56a37`; tests `26af6293c9d39ec95ecf0b398a8480693d0df071`; handler `d62d54f8a8cab431c7bc3e3ec0088366528ce909`; test script `fe367c225a0bd64d022a1244559065f634f13630`; integration doc `9b493b9ba14c3f36a92976146daead9308c38e45`.
- Новый HEAD требует полного CI. Не считать этап подтверждённым до успешных server tests/build и всех Quality Gate jobs.
- Не менялись combat formulas, RNG, награды, HP, inventory, report contents, request ID semantics, event IDs, outbox delivery или persistence boundary. Полная durable dungeon lifecycle integration по-прежнему НЕ подключена.
- PR #15 остаётся Draft/open, merged=false; не объединять без отдельного разрешения.


## Контрольная точка — 2026-11-13 (detached quest settlement участника подземелья)

- Предыдущий PR CI на HEAD `cba6aae2c7b528223d033b5ba37e4612e83a2a94` завершился полностью успешно: run `43484270078`, 4/4 jobs success. PR #15 остаётся Draft/open, merged=false.
- Добавлен pure helper `server/src/dungeonMemberQuestSettlement.ts`, объединяющий подготовку activity log, combat history, request replay history и outbox event в один detached quest snapshot.
- Сохранены дневной rollover и счётчики activity, порядок и лимиты логов (30 activity / 20 combat / 5 request), `dungeonLastRequest`, event ID/run ID/payload.
- Timestamp activity захватывается в прежней точке выполнения в win/loss ветках; helper не вызывает Date.now самостоятельно.
- Обе ветки `runExpeditionDungeon()` теперь присваивают подготовленный quest snapshot один раз вместо последовательной мутации через `recordActivity`, `saveCombatReport` и отдельную request preparation.
- Добавлены 3 regression tests; тест подключён к `server/package.json`. Обновлена `DUNGEON_LIVE_HANDLER_INTEGRATION.md`.
- Изменение не трогает combat formulas, RNG, XP/gold, HP, inventory, report contents, request ID semantics, outbox delivery и persistence boundary.
- Новый HEAD ещё не прошёл CI. Следующий шаг — дождаться полного Quality Gate и server checks; до этого не делать новых кодовых изменений.
- Важно: это detached preparation только quest state. Live handler всё ещё мутирует остальные поля Player напрямую и сохраняет через `persistDungeonResultPlayers()`; полная durable dungeon lifecycle integration НЕ подключена. PR #15 не сливать.


## Исправление dungeon win settlement — 2026-11-13

- На HEAD `323c20370d3c1bf2a4d58e5470c82a0d84b70c06` CI завершился с двумя ошибками runtime-интеграции: solo boss dungeon и group boss dungeon не получили combatResult. Ошибки указывали на timeout ожидания результата; 366/368 server tests прошли, остальные quality jobs (client build, data/docs/structure, Playwright) прошли.
- Причина найдена в win branch `Room.runExpeditionDungeon()`: `xpGain` и `goldGain` были объявлены как block-scoped `const` внутри первого цикла участников, но использовались во втором цикле при подготовке activity settlement. Это вызывало ReferenceError до сохранения/отправки результата и объясняло оба timeout.
- Исправление в `server/src/index.ts`: activity теперь читает уже сохранённые персональные значения `actualRewards[i].xp` и `actualRewards[i].gold`. Это точные reward values после pendant/active buff modifiers, уже используемые report/player state; combat/reward formulas и RNG не менялись.
- Добавлены прямые regression assertions в `server/test/groupDungeonRuntime.test.ts`: `activityToday.gold === 110` и `activityToday.xp === 420` для каждого участника победившей группы.
- Commits: handler fix `a6bcc88db556f68a86803cd97d5b154dcae38a6e`; regression assertions `9ad55913a8ec3f1e404ab944a585f84ad66c5dbc`.
- Текущий PR #15 HEAD после этих коммитов требует нового полного CI. Не считать исправление подтверждённым до успешного server test suite/build и всех Quality Gate jobs.
- Следующий шаг: проверить свежие workflow runs на HEAD, получить logs при любой ошибке; только после зелёного CI продолжить следующий этап технической декомпозиции.
- PR #15 остаётся Draft/open, merged=false; не объединять. Полная durable dungeon lifecycle integration всё ещё НЕ подключена.


## Исправление дневной статистики наград подземелья — 2026-11-13

- На PR #15 HEAD `1d4dcaadbdc9cb405ff0651a594f50a5fd8e8a11` Quality Gate run `43494016696` и Server checks run `43494016684` завершились с одним и тем же падением теста `groupDungeonRuntime.test.ts`: ожидалось `activityToday.gold === 110`, фактически было `0`; 367/368 server tests прошли. Клиентская сборка, структура/данные и Playwright прошли.
- Точная причина: `prepareDungeonMemberQuestSettlement` увеличивал `activityToday.dungeons`, но не суммировал `activity.gold` и `activity.xp`. В результате награды были корректно начислены игрокам (gold 610 / XP 420), но дневные агрегаты оставались нулевыми.
- Исправлено: helper теперь добавляет персональные `activity.gold` и `activity.xp` к дневным итогам. Это значения из уже рассчитанного `actualRewards[i]`, с учётом модификаторов; loss ветка по-прежнему передаёт нули.
- Обновлены unit expectations: rollover даёт 50 gold / 100 XP, same-day totals накапливают 57 gold / 109 XP. Group runtime assertions 110 gold / 420 XP сохранены.
- Обновлён `DUNGEON_LIVE_HANDLER_INTEGRATION.md`.
- Commits: helper `a787f8c70b4a22a48712e930e3a6d855d5101eba`; unit tests `b235e6b4fbb57a8b07c8d6463ec8bccee581a078`; integration docs `e162fdd646dd30ddcc214fbaaf3fa8d3a87d8a4d`.
- Новый HEAD ещё требует полного Server checks и Quality Gate. Не считать исправление подтверждённым до успешного CI.
- Не менялись combat formulas, RNG, начисление XP/gold игроку, HP, inventory, drops, reports, request replay/outbox или persistence boundary. Live dungeon handler остаётся legacy; полная durable dungeon lifecycle integration НЕ подключена.
- PR #15 остаётся Draft/open, merged=false; не объединять.


## Подтверждение исправления дневной статистики — CI success (2026-11-13)

- На HEAD `d0d9acf6779f5a9bcd5ae7447e51fee01af50db9` Server checks run `43494861789` завершился успешно: isolated player-save tests и server build — success.
- Quality Gate run `43494862108` завершился успешно, все 4 jobs success: Client TypeScript/Vite build, Server TypeScript build + transaction recovery tests, Data/docs/project structure, Playwright browser smoke tests.
- Исправление дневных итогов dungeon gold/xp подтверждено полным CI на указанном HEAD.
- Это подтверждает текущий этап, но не означает завершение всего технического аудита или подключение durable dungeon lifecycle.
- PR #15 остаётся Draft/open, merged=false; merge не выполнять.
- Контрольная точка зафиксирована отдельным commit; новый HEAD после неё требует повторного CI.


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


## Продолжение dungeon audit: recovery перед изменением Player (2026-11-13)

- Quality Gate на предыдущем HEAD `d3d2db6e960badb5d52f23e7e0a4fccb63c278fe` завершился успешно: все 4 jobs (Data/docs/structure, Client TS/Vite, Server TS/build + transaction recovery, Playwright). Отдельный Server Checks workflow также success.
- При полном просмотре live `Room.runExpeditionDungeon()` обнаружено окно: handler изменял online Player объекты до `persistDungeonResultPlayers()`; WAL recovery внутри persistence мог восстановить disk snapshot и отклонить commit, оставив в памяти рассчитанные, но не сохранённые изменения.
- Исправление: commit `a11002b36e2f8b456e683f12618ff5fe04afe69b` добавляет вызов `recoverPlayerStateBeforeMutation()` в самом начале dungeon handler. При recovery online players синхронизируются из сохранения и текущий вход отклоняется до чтения/расхода попыток, RNG и боя.
- Документация: commit `89ba20fd9aadc75e5e552d1e143b5f9eba4b4814`.
- Новый HEAD после checkpoint commit требует полного CI; до его завершения код не менять.
- Следующая проверка: после CI продолжить аудит целостности settlement/persistence всей dungeon подсистемы, включая поведение при ошибке WAL commit и отсутствие побочных эффектов. Не считать durable lifecycle подключённым.
- PR #15 остаётся Draft/open, merged=false. Не сливать.

## Контрольная точка — 2026-11-13 (rollback online players при ошибке persistence)

- Quality Gate на HEAD `82f6abf6ab45b08f8cf20396df7579db81cbdc81` завершился успешно: 4/4 jobs (Server TypeScript + transaction recovery tests, Client TypeScript/Vite, Data/docs/structure, Playwright).
- В `sharedStateTransactions.transact()` подтверждена граница: подготовка snapshot, validation и запись WAL выполняются до внутреннего try/catch replay. При отказе на этих этапах транзакция не committed, но dungeon live handler уже мог мутировать online Player objects.
- Исправлено в `server/src/index.ts`: `runExpeditionDungeon()` снимает detached `toJSON()` snapshots всех участников до любых игровых мутаций. `persistDungeonResultPlayers()` при ошибке до создания WAL восстанавливает эти snapshots; если WAL существует — пытается replay и синхронизирует online players с durable `players.json`, не удаляя заблокированный journal.
- Добавлена общая reconciliation после persistence errors в `persistPlayers()` и `transactClanMutation()`. Это покрывает live Player mutations в обычных сохранениях и clan mutation callback; auction операции остаются detached.
- Добавлены тест отказа при записи WAL в `sharedStateTransactions.test.ts` и source regression assertions в `playerPersistenceWriters.test.ts`.
- Combat/RNG/reward/drop/report/outbox semantics и WAL ordering не менялись. Полная durable dungeon lifecycle integration НЕ подключена.
- Коммиты: handler `182508dca291049046ef9f6e68907edde35b2d37`; reconciliation `dc552de102a3bef126f809162cc13535c036339f`; WAL failure test `8f4107feae5317deadf272cfa9e00852364de509`; regression assertions `0996aa3f96a83c1a3b79f3d6e833f635d6333f58`.
- Текущий HEAD после документации/checkpoint требует полного CI. PR #15 остаётся Draft/open, merged=false; не объединять.

## Контрольная точка — 2026-11-14 (проверка всех player persistence callers)

- Для HEAD `73b22a783b65911513aa910edf13ee4d68405498` оба workflow завершились успешно: Server checks (isolated player-save tests + server build) и Quality Gate 4/4 (client build, data/docs/structure, Playwright, server transaction recovery + compile).
- Проведён поиск call sites `persistPlayers`, `persistPlayer`, `persistDungeonResultPlayers`, `transactClanMutation`, `applySaved` в `server/src/index.ts`.
- Найден и исправлен stale rollback в `Room.onLeave()`: после нового централизованного reconciliation в `persistPlayers()` локальный catch восстанавливал только `quests` из pre-save snapshot и тем самым мог испортить согласованное состояние. Локальный rollback удалён; ошибка persistence по-прежнему пробрасывается.
- Добавлен regression assertion для `onLeave()` в `server/test/playerPersistenceWriters.test.ts`.
- Прочие call sites проверены: expedition/room saves проходят через `persistPlayers`; friend save через `persistPlayer`; clan mutations через `transactClanMutation`; auction использует detached snapshots и применяет их после успешного commit. Других stale rollback overrides в просмотренных местах не найдено.
- Новый HEAD после исправления и теста: `e0f0fe214d87a92f6036a658fe5560532f3ee2fa`. Полный CI ожидает запуска/завершения. PR #15 остаётся Draft/open, merged=false.


## Этап: долговечность shared-state WAL (2026-11-14)

- На HEAD `a6b089aa91076b06318992b531d9fe7efe37b8c2` полный CI завершился успешно: Server checks — success; Quality Gate — 4/4 (server transaction recovery/build, client build, data/docs/structure, Playwright).
- В `sharedStateTransactions.ts` найден пробел durability: атомарные временные файлы публиковались через rename без `fsync`. Это защищало от частичной записи, но не гарантировало сохранность WAL/target directory entries при внезапном отключении питания.
- Исправлено: содержимое временного файла fsync-ится до rename; затем fsync-ится родительская директория. Для backup players.json применяется тот же порядок. Удаление WAL также синхронизирует директорию. WAL directory barrier завершается до первого изменения transaction targets.
- Добавлен test hook `afterSync` и 2 regression tests: проверка порядка journal-file sync → directory sync → target write; имитация ошибки directory sync, подтверждающая отсутствие target writes и последующее восстановление из оставшегося журнала.
- Игровые данные, формат журнала, ключи транзакций, combat/reward formulas и порядок применения файлов не менялись.
- Коммиты: fsync implementation `c1314ab50ceda181bc0063acddd30eee3147bf23`; test hook `6a0e8a565fa47a89779a5d4dcbd95955faa8e5e8`; regression tests `9b9c463599b859cfabffc5e9bb41679fffe3a0a4`.
- Новый HEAD требует полного CI. Не считать этап подтверждённым до завершения Server checks и всех Quality Gate jobs. PR #15 остаётся Draft/open, merged=false; не объединять.


- CI на HEAD `59a7af4b` выявил ошибку в новом regression-test, не в реализации WAL: тест сравнивал fsync временного файла с конечным именем журнала, хотя `atomicWrite` корректно fsync-ит temp-файл до rename. Исправлено условие теста: проверяется временный файл с префиксом имени WAL, затем directory sync и только после этого target write. Изменение теста: `779a8b815a140a364e27b7d85dfc6e69506a30df`. Требуется полный повтор CI на новом HEAD.


## Контрольная точка — 2026-11-14 (durability старых transaction recovery paths)

- Предыдущий HEAD `a85f48c2cb57f7bdd97f34da5c7190fcf224e504` прошёл оба workflow полностью: Quality Gate — 4/4 jobs success (server transaction recovery/build, Playwright, client build, data/docs/structure); Server checks — success (player-save tests + server build).
- Продолжен аудит восстановления legacy-журналов. Хотя production runtime больше не создаёт новые auction/clan legacy journals, startup coordinator обязан завершать replay журналов, оставшихся от старых версий.
- Найдено: legacy auction/clan recovery использовали temp-file + rename без fsync содержимого и directory entry; удаление восстановленного журнала также не синхронизировало директорию.
- Исправлено в `auctionTransactions.ts` и `clanTransactions.ts`: fsync temp file до rename, fsync target directory после rename, fsync data directory после удаления журнала; auction player backup тоже fsync-ится до публикации.
- Добавлены hooks `afterSync` и regression tests для обоих recovery paths: проверка file sync → directory sync и финального directory sync после удаления журнала.
- Новые legacy commit methods не возвращены в production runtime; они остаются recovery-only. Transaction contents, player/clan/economy state и игровые правила не менялись.
- Commits: auction durability `9aa4d598cedfcd041005ab073a6da17abed1963a`; clan durability `cf9d49874f70caba7ebcd7f1193c367232f09a7b`; auction regression test `fe4bd1e2eaa969bd1cd7b517716bbc6e76a31e40`; clan regression test `d23468c8a7b9b46c78219114b85d4cb887707409`; integration docs `538df1f6262f245657bc12e5c057a6f1aba5bd87`.
- Новый HEAD после checkpoint update требует полного CI. Следующий шаг — проверить workflow; при ошибках получить job logs и исправить их до продолжения аудита.
- PR #15 остаётся Draft/open, merged=false; не объединять. Полная durable dungeon lifecycle integration НЕ подключена.

## Контрольная точка — 2026-11-14 (локальная изолированная тестовая среда)

- Создан Draft PR #18: https://github.com/cosmlool/Misty-Isles/pull/18, ветка `staging/local-isolated-launcher`, base `stage29/clean-validation-recovery`; не объединять без отдельного решения.
- Клиент поддерживает `VITE_SERVER_URL`; без переменной сохраняется прежний fallback на текущий hostname и порт 2567. Добавлена ссылка типов `vite/client` для TypeScript.
- Windows-лаунчер задаёт `MISTY_DATA_DIR` как абсолютный путь к корневой `.local-data` и `VITE_SERVER_URL=http://127.0.0.1:2567`. Переменные наследуются запущенными процессами сервера и Vite.
- Проверен серверный путь: `server/src/index.ts` валидирует абсолютный `MISTY_DATA_DIR`, создаёт каталог при отсутствии и направляет в него все persistence-файлы; без переменной default остаётся `server/data`.
- `.local-data/`, `logs/` и `.misty-game-processes.json` добавлены в корневой `.gitignore`.
- На HEAD `1c317079be208d6b581892dc127b44677ecbcd7e` Quality Gate прошёл полностью: Data/docs/structure, Client TypeScript/Vite, Server TypeScript и Playwright browser smoke — success. Повторный запуск workflows также завершился success (восемь check runs, включая оба запуска).
- Реальный запуск PowerShell-лаунчера на пользовательском Windows ПК ещё не проверен; CI подтверждает сборки и smoke tests, но не заменяет ручную проверку кнопок запуска/остановки и фактического расположения файлов.
- Следующий этап: проверить diff PR #18, добавить при необходимости безопасную диагностику локального профиля, затем пользователь запускает лаунчер и подтверждает, что тестовые файлы появляются только в `.local-data`.


## Исправление локального запуска: разделение сохранений и игровых ресурсов — 2026-11-14

- Первый ручной запуск ветки `staging/local-isolated-launcher` выявил `ENOENT` для `.local-data/forgotten_lands.json`.
- Причина: `MISTY_DATA_DIR` корректно перенаправлял изменяемые сохранения, но три неизменяемых ресурса игры также ошибочно читались относительно этого каталога: `forgotten_lands.json`, `city_npcs.json`, `equipment_catalog.json`.
- Исправлено в `server/src/index.ts`: `DATA_DIR` остаётся каталогом сохранений (`.local-data` при локальном запуске), а новый `GAME_DATA_DIR` всегда указывает на поставляемую папку `server/data`. Все три статических JSON загружаются из `GAME_DATA_DIR`.
- Сохранения игроков, кланов, аукциона, сессий и прочее изменяемое состояние остаются в `DATA_DIR`. Статические файлы не копируются и не изменяются.
- Добавлен regression test в `server/test/playerPersistenceWriters.test.ts`, проверяющий разделение путей и сохранение player saves в `DATA_DIR`.
- README уточнён: описывает разницу между локальными сохранениями и статическими ресурсами.
- Коммиты: runtime fix `7f406d4daf10030e49ceec39743a2482095c5652`; regression test `30d13dcc814b090297e3d3d52c53507dd65daf0c`; README `a476c12bc7b9883d4fff76c29965deff5ef66ba7`.
- Предыдущее утверждение выше о том, что все persistence-файлы находятся в `.local-data`, относится к изменяемому состоянию; статические игровые ресурсы остаются в `server/data`.
- Новый HEAD требует полного CI. После зелёного CI повторить локальный запуск на Windows. Проверить создание персонажа и появление файлов в `.local-data`; убедиться, что `server/data` не меняется.
- PR #18 остаётся Draft/open, merged=false; `main` не изменять и PR не объединять.

## Исправление регрессии изоляции тестовых игровых ресурсов — 2026-11-14

- CI PR #18 выявил, что тестовые серверы создают временные копии игровых JSON в MISTY_DATA_DIR; некоторые тесты изменяют эти копии (например, searchSeconds=0), а Playwright задаёт searchSeconds=1.
- После первоначального разделения DATA_DIR и GAME_DATA_DIR сервер стал правильно брать игровые ресурсы из server/data при обычном запуске, но перестал учитывать явно подготовленные тестовые копии. Это вызвало таймауты экспедиционных/group-travel тестов и один дополнительный runtime-test failure.
- Исправлено: добавлена отдельная необязательная переменная MISTY_GAME_DATA_DIR, валидируемая как абсолютный путь. При отсутствии переменной GAME_DATA_DIR остаётся server/data; MISTY_DATA_DIR по-прежнему отвечает только за изменяемые сохранения.
- MISTY_GAME_DATA_DIR выставляется только в тестовых процессах, которым нужны disposable static fixtures: dungeon attempts, expedition safety, group travel persistence и Playwright. Windows-лаунчер не задаёт её и продолжает читать поставляемые игровые файлы из server/data.
- Regression source test обновлён, README описывает test-only override. Никакие игровые формулы, баланс, содержимое ресурсов или main не менялись.
- Commits: runtime df166296ff9d43e07c7a3ae756962e88b9627733; dungeon fixture 2221c17f4412709635dc344e848797ac38a40e3f; expedition fixture c618a91cf0e4a5e027900a3236bc837800ab7a65; group fixture f5aae138d720f4fd9d6961b950849c7fe802a2b2; Playwright fixture 643d1d2020d63117e92f816e2eaa6ed3bc3a87c7; regression test b65260132a9144be757199606b6ea8a0f90c6b34.
- Полный CI на новом HEAD обязателен; не считать ошибки устранёнными до успешного повторного прогона. PR #18 остаётся Draft/open, merged=false.


## Исправление Windows EPERM при сохранении — 2026-11-14

- Ручной запуск Windows-лаунчера подтвердил запуск сервера на порту 2567, но сохранение персонажа завершалось EPERM: operation not permitted, fsync.
- Причина: общая WAL-транзакция вызывала fsync на дескрипторе каталога после rename/unlink. Node.js на Windows не позволяет открыть каталог таким способом.
- В shared WAL, а также в legacy auction/clan recovery stores добавлен платформенный syncDirectory: на Windows синхронизация каталога пропускается, на POSIX сохраняется прежний directory fsync. Синхронизация содержимого временных файлов через fsync не отключалась.
- Добавлен регрессионный тест Windows-пути: файловые fsync сохраняются, directory fsync не вызывается, WAL-транзакция завершается и сохраняет файлы.
- В README описано платформенное ограничение: на Windows остаётся меньшая гарантия durability directory entries при внезапном отключении питания; содержимое файлов и WAL по-прежнему fsync-ятся.
- Commits: shared WAL 5cf4c85c878823c5644e6c778b152c27c9104177; auction recovery 81cfd1a820598ba322352166e2e3fb95d735406a; clan recovery e19a41496451db270c3616ce6063df7bca4cada6; Windows regression test 7386ea207779542d76563746ffb8da5377485d01.
- Новый CI обязателен на свежем HEAD. После полного успеха повторить локальный запуск и создание тестового персонажа. Не переносить реальные сохранения и не трогать server/data.
- PR #18 остаётся Draft/open, merged=false; не объединять без явного разрешения.


## Дополнительное исправление Windows EPERM: режим открытия файлов для fsync — 2026-11-14

- Повторная ручная проверка после предыдущего исправления всё ещё показала `EPERM: operation not permitted, fsync` в `sharedStateTransactions.ts`, на вызове `syncPath(temp)` внутри `atomicWrite`.
- Уточнённая причина: directory fsync уже пропускался на Windows, но сами временные файлы открывались для fsync в режиме только чтения (`'r'`). На Windows такой дескриптор не предоставляет право записи/flush, необходимое для `fsync`.
- Исправлено в трёх transaction stores: `sharedStateTransactions.ts`, `auctionTransactions.ts`, `clanTransactions.ts` — `openSync(path, 'r+')` перед `fsyncSync`. Файловая синхронизация остаётся обязательной; отключено только directory fsync на Windows.
- Commits: shared WAL `232c2343a90912c735f1a6bec370c4f666306b75`; auction `552817cfaf681aa34ef89dfecbb549305b6a516c`; clan `aed94f2fa974501a2d6b6a5c2e1f0dcb52d34f19`.
- Новый HEAD: `aed94f2fa974501a2d6b6a5c2e1f0dcb52d34f19`. Требуется полный Quality Gate CI. Не просить пользователя повторять запуск до зелёного CI.
- После CI — дать свежую ZIP-ссылку на эту ветку и повторить ручную проверку сохранения. Ошибка «Требуется войти в аккаунт» в клиенте отдельная от fsync и требует последующей проверки auth/session flow; пока не менять auth.
- PR #18 остаётся Draft/open, merged=false; `main` не менять и PR не объединять.


## Исправление регрессии CI после Windows fsync patch — 2026-11-14

- CI на PR run `43537946529` выявил регрессию: общий `syncPath` был изменён на открытие `r+`, но этот же helper использовался для POSIX directory fsync. Linux завершал тесты с `EISDIR` при открытии каталога как файла; из-за серверного старта/персистенции упали также Playwright сценарии.
- Исправление: `syncPath(path, isDirectory = false)` выбирает `r+` для файлов и `r` для каталогов; `syncDirectory` вызывает `syncPath(path, true)`. На Windows directory fsync по-прежнему пропускается, file fsync использует read/write descriptor.
- Исправлено во всех трёх stores: shared WAL, auction, clan.
- Commit sequence: `ad995d4afd4d6e80d707eb32c9dcd2b45ebc490e`, `80fe6c987fa4271c0c15e540a203ce2529843c75`, `3de115f9b4e3cfddc1260b60181f6a3f71e60681`.
- CI run `43537946529`: client build и data/docs success; server transaction recovery и Playwright failed из-за EISDIR. Новый исправленный HEAD требует полного Quality Gate CI; до его зелёного статуса ZIP пользователю не выдавать.
- Отдельно остаётся проверить Windows file fsync и auth/session flow после CI.


## Контрольная точка — 2026-11-14 (Windows launcher: ручной запуск и CI)

- Актуальный PR #18 HEAD: `890d9c9390fd96f4ef11db3c413914676df13b31`; PR остаётся Draft/open, merged=false.
- Quality Gate run `43538934525` завершился полностью успешно: все 4 jobs success — Client TypeScript/Vite, Data/docs/structure, Playwright browser smoke tests, Server TypeScript build и transaction recovery tests.
- Пользователь подтвердил, что после последнего исправления Windows launcher удалось запустить. Это подтверждает запуск сервера, но пока НЕ подтверждает вход в аккаунт, создание персонажа, сохранение и повторную загрузку.
- Исправление Windows fsync: file descriptors открываются как `r+`, directory descriptors — как `r` на POSIX; directory fsync пропускается на Windows. Не отключать file-content fsync.
- Ранее полученная ошибка `Требуется войти в аккаунт` возникает в `GameRoom.onJoin()`, если session token не проходит `verifySession` или playerId не совпадает. Это отдельный auth/session flow; пока не менять auth до проверки свежего запуска и воспроизведения.
- Следующий шаг: попросить пользователя проверить UI авторизации (регистрация/вход), затем создать тестового персонажа, перезапустить клиент и проверить повторную загрузку. Проверить, что новые изменяемые файлы появляются в `.local-data`, а `server/data` не меняется.
- После подтверждения ручного сценария продолжить технический аудит, начиная с оставшихся persistence/dungeon lifecycle gaps. Полную durable dungeon lifecycle integration не считать завершённой.
- PR #18 не объединять; `main` не менять без отдельного разрешения.

## Исправление сброса одиночной экспедиции при обновлении страницы — 2026-11-14

- Причина: закрытие/перезагрузка вкладки вызывает GameRoom.onLeave(). Старый код сбрасывал активное состояние экспедиции (state='idle', endsAt=0) при любом отключении, включая одиночную охоту.
- Исправлено: отмена поиска/перехода при onLeave() применяется только если отключившийся персонаж состоял в охотничьей группе. Одиночный поиск сохраняет исходный endsAt и восстанавливается после повторного подключения.
- Согласованное поведение групп не менялось: отключение участника по-прежнему отменяет общее действие для группы.
- Добавлен интеграционный регрессионный сценарий: запуск одиночного поиска → disconnect → проверка сохранённого state/endsAt → reconnect → запрос expeditionState → проверка восстановления того же таймера.
- Commits: server fix 23d264217931226fbeb2cfca2b5fcd44b2a1e807; integration test 71a02d834dae794d0eff98fe88fb3d4de734385d.
- Новый HEAD до обновления этой контрольной точки: 71a02d834dae794d0eff98fe88fb3d4de734385d. Требуется полный Quality Gate CI; до его успеха ZIP не выдавать и локальный запуск не просить.
- PR #18 остаётся Draft/open, merged=false. Не объединять без отдельного разрешения.


## Исправление ложного падения теста восстановления одиночного поиска — 2026-11-14

- PR #18 Quality Gate run `43541811685` выявил 1 падение из 381 серверного теста: `expeditionSafetyRuntime`, строка 228, ожидалось `searching`, получено `idle`.
- Причина не в runtime `onLeave()`: интеграционный тест повторно использовал массив уведомлений и при втором поиске находил старое сообщение «Поиск монстра начался.» от предыдущего поиска. Проверка состояния выполнялась до обработки нового запроса.
- Исправлено: тест фиксирует количество уведомлений до отправки второго `expeditionSearchStart` и ждёт именно новое уведомление после этой отметки, исключая ложное срабатывание на старом сообщении.
- Commit: `d109afee54a1a5efeefcbd9141e6ed388d58e40f`.
- Требуется полный повторный Quality Gate на новом HEAD; до 4/4 success не просить повторный запуск игры и не выдавать ZIP.
- PR #18 остаётся Draft/open, merged=false; не объединять.


## Повторная синхронизация интеграционного теста поиска — 2026-11-14

- Quality Gate run `43544127576` на PR merge HEAD `2641cdb3a9b2d34ac81081aa57871b873bb2c4d1`: 3/4 jobs success; серверный тест упал в `expeditionSafetyRuntime.test.ts:231`, ожидал `searching`, получил `idle`.
- Выяснено, что синхронизация второго поиска по тексту уведомления ненадёжна: клиент может получить отложенное уведомление предыдущего поиска после начала следующей проверки.
- Тест теперь ждёт именно новое сохранённое состояние `searching` с `startedAt`, превышающим timestamp предыдущего поиска; уведомление больше не является условием, по которому определяется запуск нового поиска.
- Коммиты тестовой синхронизации: `36fa89955ec7ddef1d573b280c8f2e011013b6a0`, упрощение чтения сохранённого состояния `7117fa13149a9ccdd363191b5be4522c5b9dd0fb`.
- Требуется повторный полный Quality Gate на актуальном PR HEAD. До 4/4 success не просить пользователя запускать игру и не выдавать ZIP.
- PR #18 остаётся Draft/open, merged=false; не объединять.


## Исправление подготовки expedition safety runtime test — 2026-11-14

- Quality Gate run `43547929071` на HEAD `3964447e530f5e4ec1097d0c535e51626c671291`: 3/4 jobs success; server transaction recovery job failed на тесте `expeditionSafetyRuntime.test.ts`, ожидание `pending invite before expedition` завершилось timeout.
- Причина в последовательности самого интеграционного теста: soloId восстанавливал после reconnect активный одиночный поиск, затем тест пытался пригласить этого же персонажа в группу. Runtime корректно запрещает приглашения, если у приглашающего или целевого игрока состояние экспедиции `searching`/ `moving`. Следовательно, ожидаемое pending invite было несовместимо с проверяемым активным одиночным поиском.
- Исправлена подготовка теста: после проверки восстановления исходного `state` и `endsAt` тест теперь завершает уже восстановленный нулевой по длительности одиночный поиск через `expeditionSearchClaim`, прежде чем использовать персонажа как адресата группового приглашения. Runtime-правило не ослаблялось.
- Commit: `eb8e0fd364afa2028868928b43228d4ef1d1f335`.
- Новый полный Quality Gate обязателен на свежем HEAD. Не считать исправление подтверждённым до 4/4 success; не просить пользователя запускать игру и не выдавать ZIP до этого.
- PR #18 остаётся Draft/open, merged=false; не объединять и не менять `main` без отдельного разрешения.


## Подтверждение полного Quality Gate после исправления expedition safety test — 2026-11-14

- Актуальный PR #18 HEAD: `12c91a8ad73ae8e4a48e4b40f96caa95ca4cedc5`.
- Quality Gate run `43548309302` завершился с conclusion=success.
- Все четыре обязательные проверки на этом HEAD завершились success: Data/docs/project structure; Client TypeScript and Vite build; Server TypeScript build; Playwright browser smoke tests.
- Предыдущий runtime-test failure устранён изменением только последовательности подготовки теста; runtime запреты на изменение состава группы во время поиска/перехода сохранены.
- PR #18 остаётся Draft/open, merged=false. Никакого merge или изменения main не выполнялось.
- Теперь можно продолжать технический аудит на текущем зелёном HEAD. Ручной запуск игры не требуется для подтверждения CI; перед следующей ручной проверкой всё равно сверять HEAD и полный Quality Gate.


## Аудит фактического восстановления активного забега подземелья — 2026-11-14

- Проверен текущий путь server startup → room join → client UI → dungeon entry.
- При старте сервер действительно восстанавливает shared WAL, валидирует `dungeon_runs.json`, проверяет отсутствие пересекающихся активных забегов и заполняет `ACTIVE_DUNGEON_RUNS`.
- При подключении игрока сервер отправляет `dungeonRunRecovery`; клиент принимает snapshot и показывает карточку «Сохранённый забег», блокируя новый вход.
- Однако клиент пока только отображает snapshot: обработчика продолжения/завершения забега нет.
- В серверном `index.ts` `ACTIVE_DUNGEON_RUNS` используется для обнаружения и блокировки повторного входа/покупки свитка, но live `runExpeditionDungeon()` по-прежнему выполняет legacy aggregate combat, расход попытки, reward/drop allocation и settlement напрямую. Новые durable start/round/encounter/finalization runtime helpers не подключены к этому обработчику.
- Следствие: если активный durable run уже окажется на диске после аварийного завершения, игрок увидит сохранённый забег, но не сможет продолжить его; новый вход будет заблокирован. Это fail-closed поведение предотвращает потерю/повтор наград, но оставляет забег в тупике.
- Не вносить частичную интеграцию. Перед подключением требуется целостный сценарий: idempotent start + attempt charge → durable encounter/round progression → immutable prepared encounter → atomic player/run/outbox finalization → restart/retry recovery → client resume/result acknowledgement. Существующий legacy путь должен быть заменён целиком за один согласованный этап или оставлен как изолированный fallback без смешения состояний.
- Проверено по `server/src/index.ts`, `server/src/dungeonRunState.ts`, durable runtime modules, `client/src/main.ts`; никаких игровых данных и баланса не менялось.
- Следующий этап аудита: сверить семантику состояния durable run (round plan, participant health/death/spectator, terminal outcomes, result outbox) с утверждёнными правилами подземелий и выявить все несовпадения до проектирования интеграции.


## Сверка семантики durable dungeon lifecycle — 2026-11-14

- PR #18 HEAD: `8f91341c8a815ea266f72281f983ff7e3f46580e`; Quality Gate run `43563764060` завершился success, все 4 обязательных jobs success: Data/docs/project structure; Client TypeScript and Vite build; Server TypeScript build; Playwright browser smoke tests.
- PR #18 остаётся Draft/open, merged=false. Merge и изменения `main` не выполнялись.
- Проверены `dungeonRunState.ts`, `dungeonRunStartTransaction.ts`, start/round/finalization runtimes, prepared encounter/commit/finalization, request recovery, recovery view и соответствующие тесты.
- Стартовая транзакция корректно объединяет расход ежедневной попытки, инкремент `battles` и запись активного run в shared WAL; повтор того же requestId не списывает попытку повторно, пересекающиеся активные roster блокируются.
- Round plan сохраняет суммарный урон детерминированными срезами; round commit атомарно пишет run и HP игроков, защищён от stale round index. Но round resolver намеренно зажимает HP живых участников минимум до 1; смерть/перевод в spectator существует отдельным переходом, не выводится из damage schedule.
- Семантическое несовпадение №1: durable run разрешает spectator с HP=0, однако `createPreparedDungeonEncounter()` требует `hpBefore > 0` и `hpAfter >= 1` для КАЖДОГО roster участника, а snapshot health должен совпадать с hpAfter. Значит, prepared settlement для roster с павшим spectator невалиден; модель должна явно отделить spectator/no-combat settlement от боевых участников, не исключая его из roster и не выдавая ему боевые награды автоматически.
- Семантическое несовпадение №2: `finishDungeonRun()` допускает исходы `leader_afk` и `leader_dead`, но finalization runtime не проверяет, что лидер действительно AFK/погиб и не был воскрешён. Также runtime не реализует требуемые последствия: лидер AFK — завершить забег, вернуть всех в город и расформировать группу; лидер погиб без воскрешения — вывести весь roster, сохранив группу. Эти правила должны быть проверяемыми переходами, а не произвольными terminal outcome строками.
- Семантическое несовпадение №3: finalization WAL атомарно коммитит players, dungeonRuns и dungeonOutbox, но не `hunt_groups`. Поэтому последствия для состава/сохранения группы при leader AFK/death не могут быть атомарно зафиксированы вместе с результатом забега в текущем runtime.
- Resurrection transition учитывает spectator, живого спасателя, scroll count и запрет повторного revive одной и той же парой rescuer→target; однако runtime-атомарность расхода предмета вместе с изменением run пока не подключена к live handler.
- Result outbox имеет at-least-once delivery и idempotent event ID, но доставка/ack/replay ещё не подключены к live transport и клиентскому acknowledgement.
- Это аудит, не изменение runtime или баланса. Не подключать lifecycle частями. Перед интеграцией спроектировать согласованную модель participant combat eligibility/spectator, leader terminal transitions + hunt_groups transaction, resurrection item transaction, reward/outbox replay и client resume/result acknowledgement.
- Следующий этап: проверить правила попыток/поражения и legacy reward/drop semantics против подготовленного encounter, затем составить целевой end-to-end контракт интеграции с перечнем затрагиваемых файлов и тестов.

## Сверка legacy dungeon attempt/reward/drop semantics — 2026-11-14

- На PR #18 HEAD `6ddcdb551ec47576d0a0626342918a9252f9da88` запущен Quality Gate run `43600975727`; на момент проверки он ещё in_progress. Не считать CI подтверждённым до 4/4 jobs success.
- Legacy handler `GameRoom.runExpeditionDungeon()` проверяет лимит 3 входа на игрока за UTC-день до боя, затем списывает попытку и увеличивает `battles` до расчёта результата. Поражение также расходует попытку; новая durable start transaction повторяет эту семантику и идемпотентно не списывает повторно тот же requestId.
- Legacy combat formula возвращает win только если `rounds <= 3` и у каждого участника `health > incomingDamage`. При поражении и победе `prepareDungeonMemberHealthOutcome()` ограничивает итоговое здоровье минимумом 1 HP; текущий legacy boss dungeon бой не создаёт смерть/0 HP и не переводит участника в spectator.
- Победа: каждому участнику начисляются индивидуально рассчитанные XP и gold; базовое золото делится через `Math.floor(dungeon.gold / partySize)`, затем учитываются личные эффекты экипировки/баффов. Гарантированный ресурс и дополнительные drops роллятся один раз, после чего каждый item распределяется одному случайному участнику. Поражение: XP/gold/drop отсутствуют, но попытка и последствия входа сохраняются; здоровье уменьшается.
- Legacy quest settlement обновляет daily activity, activity log, combat history, request history и создаёт result event на каждого участника. Сохранение players и dungeon result events идёт через общую persistence/recovery обвязку. Durable prepared encounter замораживает уже рассчитанные XP/gold/loot/snapshots, запрещает drops при loss, а finalization сохраняет players+run+outbox одним WAL; он сам не пересчитывает награды и не бросает RNG.
- Выявлен контрактный нюанс: durable start транзакция хранит общий дневной счётчик `dungeonRuns` на игрока, а legacy ограничение также глобальное для всех подземелий; при интеграции нельзя ошибочно вводить отдельный лимит по dungeonId. День сейчас ключуется UTC через `toISOString().slice(0,10)`; это существующая семантика, менять без отдельного решения.
- Не найдено оснований менять численные формулы, reward rates или drop chances. Код/баланс не менялись.
- До end-to-end интеграции остаются решения/контракты: согласовать spectator eligibility и 0 HP; лидер AFK/death + атомарная связь с `hunt_groups`; расход revive item вместе с run; сохранение legacy quest/history/request-id semantics в player snapshots; at-least-once outbox delivery/replay/client acknowledgement; resume UI и terminal result flow.
- Следующий шаг аудита: собрать точную карту переходов legacy dungeon request → attempt charge → combat calculation → reward/drop roll → quest/history settlement → persistence/outbox и сопоставить её с durable run state machine, затем определить минимальную полную границу миграции без частичного dual-write.


## Карта legacy dungeon request → persistence/outbox — 2026-11-14

- Текущая legacy последовательность в `GameRoom.runExpeditionDungeon()`:
  1. Recovery gate shared WAL; проверка leader/group/online roster/requestId.
  2. Проверка кэша `dungeonRequestHistory`/`dungeonLastRequest` по requestId; повтор возвращает сохранённый результат без нового боя.
  3. Блокировка участников с активным durable run; проверка min level, group ±5 и персонального глобального дневного лимита.
  4. Подготовка boss/stats/passive/weakness/group guard и pure `calculateDungeonCombatPlan()`.
  5. Снимок rollback, списание попытки + battles, расчёт win/loss и здоровья; на победе XP/gold, drop rolls и случайные получатели.
  6. Подготовка персональных combat reports, activity log/daily activity/combat history/request history и result events.
  7. Один shared WAL транзакционно сохраняет полные player snapshots + dungeon result outbox; при ошибке rollback/recovery синхронизирует online players.
  8. Отправка combatHistory/notice, затем dispatch pending outbox combatResult и ack после send; повторная доставка возможна при crash между send и ack.
- Durable целевой путь уже имеет отдельные helpers для idempotent start/attempt charge, round progress, prepared encounter commit, atomic player+run+outbox finalization и outbox ack. Однако helpers пока не подключены к legacy handler; live flow по-прежнему использует legacy aggregate combat и пишет legacy result outbox event с `runId=legacy_<requestId>`.
- Для миграции нужно сохранить requestId idempotency и последние 5 request history entries, legacy duplicate result behavior, player quest/history fields, battles/attempt charge, exact reward/drop RNG decisions, reports и per-player combatResult payload. Нельзя повторно рассчитывать или роллить loot после того, как prepared encounter уже закоммичен.
- Существенная разница: legacy сохраняет player settlement + outbox, но не создаёт terminal dungeon run; durable путь должен добавить run lifecycle, не меняя семантику уже начисленных player rewards. Переключение должно иметь однозначную точку commit: либо legacy path до durable start, либо durable run после атомарного start; смешанные списания/дублирование rewards недопустимы.
- Отдельно требуется определить восстановление при падении между start, combat preparation, prepared snapshot commit, finalization и event delivery. Prepared snapshot должен быть единственным источником истины после commit; до него можно безопасно повторять только этапы с idempotency key и неизменяемыми входными данными.
- CI run `43600975727` на HEAD `6ddcdb551ec47576d0a06281f983ff7e3f46580e` на момент обновления checkpoint: client, Playwright и data/docs jobs success; server transaction/build job ещё in_progress. Не объявлять 4/4 до его завершения.
- Следующий этап: проверить существующие durable runtime tests на failure injection для каждого crash boundary, а также проверить outbox replay/ack при повторном подключении; затем оформить полную таблицу crash matrix и acceptance tests до проектирования live integration.
