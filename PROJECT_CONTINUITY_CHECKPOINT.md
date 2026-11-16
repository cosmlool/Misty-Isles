# Контрольная точка продолжения Misty-Isles

Обновлено: 2026-11-15. Актуальное состояние сверять с PR #18 и точным HEAD ветки staging/local-isolated-launcher.

## Репозиторий и ограничения

- Репозиторий: `cosmlool/Misty-Isles`.
- Рабочая ветка текущего этапа: `staging/local-isolated-launcher`.
- PR #18: https://github.com/cosmlool/Misty-Isles/pull/18 — Draft/open, не объединять без отдельного разрешения.
- Базовая ветка PR: `stage29/clean-validation-recovery`.
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


## Shared WAL — crash сразу после публикации журнала — 2026-11-15

- Повторно проверены актуальные `sharedStateTransactions.ts`, `sharedStateRuntime.ts`, legacy auction/clan recovery adapters и `sharedStateTransactions.test.ts`.
- В WAL тестах уже были покрыты сбой между target writes, recovery до подготовки следующего snapshot, fsync barrier, отказ синхронизации каталога, повреждённый journal и backup players. Не хватало отдельного реального child-process crash сразу после `afterJournalPersisted`, до первого target write.
- Добавлен тест `a process crash immediately after durable journal publication replays the full transaction`: дочерний процесс завершается с exit code 72 после публикации WAL; проверяется, что целевые файлы ещё не изменены, затем новый store восстанавливает полный snapshot и удаляет journal.
- Коммит: `fcd2abf49d1ba54285f71a132525eca0abee87e1` в `staging/local-isolated-launcher`.
- Изменён только `server/test/sharedStateTransactions.test.ts`; runtime-код, правила игры и сохранения пользователей не затронуты.
- Локально тест не запускался через этот GitHub workflow; обязательный CI для нового HEAD должен подтвердить тест и сборку.
- Следующий шаг: проверить CI на точном новом PR HEAD, затем продолжить аудит общих транзакций и восстановления legacy journals; не подключать durable dungeon lifecycle к live handler без отдельного согласования.

## Проверка crash-matrix и outbox test coverage — 2026-11-14

- `dungeonRunStartTransaction.test.ts` покрывает pure preparation, attempt charge, duplicate request idempotency, overlap, exhausted attempts и invalid snapshots, но не проверяет реальную shared-WAL commit/crash/restart границу для старта.
- `dungeonRunRoundRuntime.test.ts` содержит реальный shared-WAL crash/restart сценарий после записи players; recovery восстанавливает round cursor, boss HP, participant HP и очищает journal.
- `dungeonEncounterCommitRuntime.test.ts` проверяет immutable snapshot attachment, exact retry/conflict и fail-closed после recovery, но commit/recovery проверяется через pure preparation или mock runtime; реального WAL crash/restart теста для сохранения prepared snapshot не найдено.
- `dungeonRunFinalizationRuntime.test.ts` содержит реальный WAL crash/restart после записи players; recovery восстанавливает terminal run и player rewards. Есть duplicate finalization no-op и fail-closed recovery tests.
- `dungeonResultOutboxDelivery.test.ts` проверяет порядок send→ack, отсутствие ack при send failure, поведение при ack failure, фильтрацию чужих событий и idempotent enqueue. Не найден тест полного reconnect/restart replay из сохранённого outbox после crash между transport send и durable ack.
- Подтверждённая неполнота crash matrix: добавить WAL crash/restart для start и prepared encounter commit; добавить outbox persistence+restart replay и повторную доставку при crash после send до ack; проверить восстановление/повторное подключение с pending event и client-side dedup по eventId.
- Эти gaps относятся к тестовому покрытию и будущей интеграции; код пока не менялся.
- Quality Gate run `43600975727` на HEAD `6ddcdb551ec47576d0a06281f983ff7e3f46580e`: client, Playwright, data/docs success; Server TypeScript build / transaction recovery всё ещё in_progress при последней проверке. Следующий документационный HEAD `0928e39f24e3302cfb7b02f923d40670b3791003` требует собственного CI; не считать 4/4 подтверждённым.
- Следующий этап: спроектировать crash matrix с точками аварии до/после каждого durable commit и ожидаемым recovery result; затем добавить отсутствующие тесты до live integration.

## Уточнение crash matrix и outbox coverage — 2026-11-14

- Повторно сверены существующие тесты и package test script; первоначальная gap-карта была неполной: `dungeonRunStartWal.test.ts` уже содержал реальный child-process crash/restart после записи players; `dungeonResultOutboxRecovery.test.ts` уже проверял сохранение pending event, restart replay и отсутствие повторной отправки после durable ack; `dungeonResultDedup.test.ts` уже проверял клиентское подавление повторов по eventId с устойчивым browser storage.
- Подтверждено: `index.ts` вызывает dispatch pending dungeon result events при `onJoin`, то есть reconnect path существует. At-least-once повтор между transport send и ack остаётся ожидаемым; client dedup предназначен для подавления повторного отображения.
- Добавлены реальные child-process crash/restart проверки для start WAL на трёх границах: после durable journal write, после target write `players`, после target write `dungeonRuns`. После каждого сбоя recovery должен восстановить полный набор: ровно одно списание попытки, один increment `battles` и active run.
- Добавлены реальные child-process crash/restart проверки для prepared encounter commit на тех же трёх границах. После recovery immutable prepared snapshot (включая rewards/drop recipient) должен быть сохранён точно, а player snapshots не должны измениться.
- Round и finalization уже имеют crash/restart после записи `players`; их дополнительные точки до/после каждого target write пока не расширялись. Это остаточная глубина crash matrix, не блокер для корректности уже проверенных сценариев.
- Новые тесты находятся в `server/test/dungeonRunStartWal.test.ts` и `server/test/dungeonEncounterCommitRuntime.test.ts`; оба файла уже перечислены в `server/package.json` test script. Никаких runtime gameplay изменений и изменений баланса не сделано.
- Следующий шаг: дождаться Quality Gate на актуальном PR HEAD и при успешном CI проверить crash/ack edge cases round/finalization/outbox; затем зафиксировать итоговую матрицу и только после этого проектировать полную границу live dungeon integration. Не подключать durable lifecycle частями.


## Уведомления после durable save — 2026-11-14
- На PR #18 HEAD `f944d443bf5499d266be3b44d6c63605823c94f8` CI выявил три runtime assertion failures: story_3 city reputation, weekly challenge reward snapshot и legacy Knight weapon snapshot.
- Диагностика подтвердила общий порядок в `GameRoom.notice()`: сообщение отправлялось клиенту до синхронного `save()`. Клиент мог получить notice и прочитать players.json до завершения записи.
- Исправлено в commit `9835a48204588b2d4ae97e9c7919ee6f9819b025`: `notice()` теперь вызывает `save()` перед отправкой сообщения. При ошибке сохранения уведомление не отправляется.
- Это исправление не меняет награды, условия заданий, экипировку или баланс.
- Обязательная проверка: повторный Quality Gate на новом HEAD; особое внимание трём runtime tests в server suite. До полного зелёного CI не просить пользователя запускать игру.


## Восстановление одиночной экспедиции после переподключения — 2026-11-14
- Исправлен edge case в `GameRoom.onJoin()`: старые сохранения одиночного поиска могли не иметь поля `expedition.groupId`; строгое сравнение с пустым ID трактовало это как потерю групповой привязки и сбрасывало поиск.
- Сравнение нормализует отсутствующий/пустой `groupId` к пустой строке. Реальная привязка к отсутствующей группе по-прежнему сбрасывается.
- Добавлен runtime regression test: legacy solo expedition без `groupId` должна пережить reconnect и сохранить исходный `endsAt`; тест на orphaned group search продолжает проверять безопасный сброс.
- Коммиты: `c4a97db0aafcdadbc83b6d24f7b9de2cfcd65bb8` (fix), `78fa07b0f0c6853fa49b83d241baa66bdc5e81ad` (test).
- CI для этих изменений ещё не подтверждён.


## Локальный Git updater — защита работающей игры — 2026-11-14

- PR #18 / ветка `staging/local-isolated-launcher`; перед этапом head был `8ec2a7d683a540efe3c7f15c7cb94b389f00f614`.
- Quality Gate run `43611995201` на этом HEAD завершился успешно: все 4 обязательные jobs прошли (data/docs/structure, client TypeScript+Vite, server tests+build, Playwright browser smoke tests).
- Проверены `tools/Update-Game.ps1`, `Запустить игру.bat`, `tools/Start-Game.ps1`, `tools/Stop-Game.ps1` и локальные ignore rules.
- Найден риск: повторный запуск BAT во время работающей игры мог выполнить Git fast-forward поверх файлов, используемых dev-серверами.
- Добавлена fail-closed проверка портов 2567 и 5173 перед fetch/pull. Если один из портов слушается или проверка портов недоступна, updater прекращает работу и предлагает сначала остановить игру через `Остановить игру.bat`. Никаких автоматических остановок или удаления данных нет.
- Commit: `8dd3a0c98f0830748a90f064cf2d10a94c88a71c`. Новый Quality Gate обязателен; не просить пользователя запускать обновлённый BAT до 4/4 success на новом HEAD.
- Ограничение остаётся: updater применяет изменения только перед запуском игры; live/hot update и бесшовный серверный restart ещё не реализованы.


## Защита XP progression — 2026-11-15

- Вынесен расчёт начисления опыта и level-up в чистую функцию `server/src/xpProgression.ts`.
- Функция не мутирует входного игрока. Она возвращает только изменяемые поля: experience, level, statPoints, experienceToNext, maxHealth и health.
- Формула порога уровня сохранена без изменений: `Math.floor(100 * Math.pow(level, 1.85))`.
- Сохранено прежнее увеличение здоровья за уровень: `18 + vitality * 0.5`; эффективный предел здоровья пересчитывается после каждого повышения уровня на основе обновлённого base maxHealth и прежних данных экипировки/коллекций.
- `GameRoom.addXp()` теперь применяет результат чистой функции к Player. Остальные поля Player не затрагиваются.
- Добавлены регрессионные тесты: XP ниже порога, один level-up, несколько level-ups, последовательный пересчёт effective max health и отсутствие мутации входных данных.
- Тест зарегистрирован в `server/package.json`.
- Коммиты этого этапа: `de8a4ae` (helper), `b666013` (тест), `ea85e5f` (интеграция), `e286cf6` (уточнение теста), `f4b8a28` (регистрация теста).
- Это только безопасное выделение XP progression; live dungeon handler всё ещё не интегрирован с durable encounter/finalization flow.
- Локально тесты не запускались. Не считать этап проверенным до прохождения обязательных CI jobs на точном актуальном HEAD.


## Долговечность auth credentials — 2026-11-15

- Аудит `server/src/index.ts` подтвердил, что `accounts.json`, `sessions.json` и `guest_credentials.json` сохранялись через `writeJsonAtomic()`: temp-файл + rename защищали от частично записанного JSON, но не выполняли `fsync` содержимого и каталога перед успешным HTTP-ответом.
- Риск: после ответа регистрации/гостевого входа/логина внезапное отключение питания или сбой ОС могло потерять последнее изменение каталога или данные temp-файла, несмотря на успешный rename.
- Добавлен `server/src/atomicJsonPersistence.ts`: сериализация JSON, запись уникального temp-файла, `fsync` temp-файла, атомарный rename, затем `fsync` родительского каталога на POSIX. На Windows directory fsync пропускается, file fsync остаётся обязательным — в соответствии с уже принятой платформенной стратегией WAL.
- `saveAccounts`, `saveSessions`, `saveGuestCredentials` теперь используют этот helper. Форматы, token hashes, password hashing, guest proof и правила авторизации не менялись.
- Добавлены тесты порядка file-fsync → rename → directory-fsync, fail-closed при file-fsync failure и Windows поведения; тест зарегистрирован в `server/package.json`.
- Изменения: `9a4b3fd` helper, `c6ce552` tests, `57403a2` auth integration, `f029943` test registration, `caa0b85` cleanup imports.
- Не запускал тесты локально; CI нового HEAD обязателен. Старый Quality Gate на предыдущем HEAD не подтверждает эти изменения.
- Ограничения: это синхронное одно-процессное JSON-хранилище, не межпроцессная блокировка и не полноценная БД. Rate limiting и CORS отдельно не менялись. Следующий этап — проверить CI, затем аудит авторизации/сессий и границ конкурентного доступа; не менять контракт логина или гостевого восстановления без отдельного основания.


## Аудит границы регистрации аккаунта и гостевого восстановления — 2026-11-15

- Проверены актуальные `authHttpHandler`, `verifySession`, `issueSession`, `issueGuestCredential` и runtime tests регистрации, logout и duplicate sessions.
- Подтверждено: токены и guest proof генерируются криптографически стойким `randomBytes(32)`; в JSON сохраняются только SHA-256 digest. Проверка пароля использует `scryptSync` и `timingSafeEqual`. Сессия ограничена 30 днями; logout удаляет digest и закрывает текущий WebSocket. Account-link проверяется при каждом `verifySession`, поэтому старые guest sessions становятся недействительными после появления account record, даже если их строки остались в `sessions.json`.
- Найден подтверждённый риск частичного commit при привязке гостя к аккаунту: `/auth/register` отдельно и последовательно сохраняет `accounts.json`, затем удаляет guest proof, затем guest sessions, затем создаёт account session. Каждый файл теперь устойчиво записывается атомарно, но вся операция не является одной транзакцией.
- Если процесс аварийно завершится или одна из последующих записей завершится ошибкой после сохранения аккаунта, аккаунт уже существует, а клиент может получить общий HTTP 400 вместо успешной регистрации. Повтор регистрации с тем же логином вернёт 409; пользователю придётся выполнить обычный login. С точки зрения доступа старые guest tokens не дают takeover: `verifySession` отвергает guest session при существующем account record. Остаточные guest proof/session записи — проблема согласованности/очистки, а не подтверждённый обход авторизации.
- Существующие `authAccountRuntime.test.ts` проверяют штатную привязку, отзыв гостевых сессий и stale guest session после искусственного crash-состояния, но не инъекцию сбоя между реальными последовательными записями во время регистрации.
- Рекомендованное исправление: сделать account-link + удаление guest proof + отзыв guest sessions единым WAL commit и добавить crash/restart tests на каждой границе. Это потребует расширить shared-state journal новыми auth targets и проверить startup recovery; в этом аудиторском шаге код не менялся, чтобы не расширять формат WAL без отдельной тестовой матрицы.
- Дополнительно подтверждено ограничение: shared-state WAL и auth JSON writers рассчитаны на один процесс сервера на каталог данных; межпроцессной блокировки нет. Не запускать два сервера с одним `MISTY_DATA_DIR`.
- Quality Gate run `43713419370` на точном PR HEAD `142cf8a018b6073cd088725af62d0a531ec0ec0f` завершился успешно: 4/4 jobs — server tests/build, client build, Playwright smoke tests, data/docs/structure.
- Следующий этап: подготовить и протестировать auth WAL transaction для account-link и только затем интегрировать её; не менять парольный контракт, сроки сессий, guest recovery semantics или данные существующих игроков.

## WAL-транзакция привязки гостевого персонажа к аккаунту — 2026-11-15

- Расширен общий `shared_state_transaction.json` WAL тремя auth targets: `accounts`, `sessions`, `guestCredentials`. Существующие версии журнала продолжают поддерживаться; новые targets валидируются тем же allowlist/configured-files механизмом.
- `/auth/register` теперь после recovery готовит один snapshot: новый account record, account session и (при привязке гостя) удаление guest recovery proof и всех прежних сессий этого персонажа. Все файлы публикуются под одним durable journal; raw session token возвращается клиенту только после завершения commit/recovery.
- Обычные операции создания guest proof, выдачи сессии и logout также переведены на shared WAL. Auth HTTP requests и `verifySession` сначала выполняют recovery, чтобы незавершённый journal не позволял читать устаревшее auth-состояние.
- Не менялись парольный контракт, scrypt параметры, token/proof формат, срок сессии (30 дней), guest recovery semantics, коды штатных ответов регистрации, игровые данные и баланс.
- Добавлен crash/restart regression test для привязки аккаунта: дочерний процесс аварийно завершается после записи каждого из трёх targets (`accounts`, `sessions`, `guestCredentials`); после restart проверяется полный согласованный snapshot, отзыв старой guest session и удаление recovery proof.
- Изменённые файлы этого этапа: `server/src/index.ts`, `server/src/sharedStateTransactions.ts`, `server/test/sharedStateTransactions.test.ts`.
- Коммиты: WAL auth targets `e090939f04f054cf6931d1fcad387c88c902510a`; auth runtime integration `1e0beb17e50600e5b7f61915b22cab90bd91a750`; crash-boundary tests `371e41e8aa52b97c3b4306b71392ba94a947aa8a`; auth recovery-before-read `1adfd7f8eedc2ab5b38b082551adf2bc696b7504`.
- Проверка исходников и PR diff выполнена через GitHub. Локально тесты не запускались. Новый Quality Gate для текущего HEAD обязателен; до его завершения изменение не объявлять проверенным.
- Следующий шаг: проверить полный CI на точном HEAD, исправить только подтверждённые регрессии. После зелёного CI продолжить аудит гостевого создания/восстановления и конкурентных границ auth persistence.


## Разбор Quality Gate 43719595242 и исправления — 2026-11-15

- CI на HEAD `87f156436482473c7a7e6107fe8bd9b0786fbe1a` завершился с 3/4 jobs success. Клиентская сборка, Playwright и проверка данных/docs прошли; серверный job сообщил 392/395 тестов, 3 failures.
- Подтверждённая проблема: добавленный recovery внутри `verifySession` мог первым восстановить shared WAL до вызова `onAuthenticatedMessage`. Последующий `recoverPlayerStateBeforeMutation` видел уже очищенный journal и не синхронизировал живые `ONLINE_PLAYERS`. В частности, сценарий PvP специально создаёт pending player journal перед `pvpList`; старый online snapshot мог перезаписать восстановленные данные.
- Исправление в `server/src/index.ts`: `verifySession` теперь принимает необязательный callback и вызывает его только если именно эта проверка выполнила recovery. WebSocket authenticated-message wrapper передаёт `syncOnlinePlayersAfterRecovery`, поэтому live Player objects обновляются до чтения/мутации в handler. Обычная проверка при join и HTTP auth не требует синхронизации уже подключённых игроков.
- Два оставшихся failures имели форму гонки тестового listener: тесты подписывались на `notice` уже после `joinOrCreate`, но buffered initial welcome/character-selection notice мог прийти после подписки и быть принят за ответ на первое игровое действие. Исправлены только тестовые listeners: они игнорируют приветственное сообщение, не меняя игровой контракт или награды.
- Изменения после неуспешного CI: `9114ef5af776beb0a8a069f6fd8ebe24a1de3124` (recovery callback и синхронизация online players); `622a562dc6b168ea14321451751ed8587172898c` (фильтр buffered welcome в guest guard test); `0c3f05faed0f6778f774062cc5765c1596bf3119` (фильтр buffered welcome в quest reward test).
- Эти исправления пока не подтверждены CI. Текущий HEAD на момент checkpoint: `0c3f05faed0f6778f774062cc5765c1596bf3119`. Требуется дождаться Quality Gate именно для него; если PvP или quest idempotency снова упадут, исследовать логи и не считать фильтрацию тестовых welcome сообщений исправлением серверной логики.


- Дополнительная проверка auth entry points выявила ту же границу и для HTTP: `authHttpHandler` сам вызывает recovery до обработки `/auth/*`, а `verifySession` также используется при WebSocket join. Поэтому синхронизация только в WebSocket message wrapper была недостаточной для всех путей.
- Усиление исправления в `17ef9e42816d8978c4ee9a4c304fee343cd3ccfc`: `verifySession` теперь сам синхронизирует `ONLINE_PLAYERS`, если recovery сработал; `authHttpHandler` делает то же после собственного recovery. Это покрывает session verification при join, повторную проверку в сообщениях и HTTP auth requests, не меняя auth token/session semantics.
- Текущая ветка должна получить новый CI запуск после HEAD `17ef9e42816d8978c4ee9a4c304fee343cd3ccfc` и обновления этого checkpoint.


- Regression coverage дополнена: `server/test/pvpRuntime.test.ts` теперь отдельно создаёт pending shared WAL перед HTTP `/auth/check`, а затем выполняет PvP mutation. Проверка баланса после боя подтверждает, что HTTP-triggered recovery синхронизировал живого атакующего, а не позволил stale in-memory gold перезаписать восстановленные 888 золота. Предыдущий этап этого теста по-прежнему проверяет recovery, инициированный непосредственно WebSocket `pvpList`.
- Текущий regression coverage commit: `b9de76ba5a568c21bd202195de44b5f32a2b8302`. Требуется CI на актуальном HEAD.


## Разделение recovery player-state и auth-only WAL — 2026-11-15

- Дополнительный аудит выявил, что синхронизация `ONLINE_PLAYERS` после любого recovery слишком широка: новые auth-only journals могут затрагивать только `accounts`, `sessions` или `guestCredentials`. Перечитывание `players.json` в таком случае способно отбросить ещё не сохранённые изменения живых Player objects.
- `server/src/sharedStateTransactions.ts` теперь предоставляет `hasPendingPlayers()`: метод проверяет и валидирует pending shared journal до replay и определяет, содержит ли он target `players`.
- `server/src/sharedStateRuntime.ts` различает `recoverPendingState()` (любой recovery) и `recoverPendingPlayerState()` (recovery, который действительно заменил player snapshot). Callback аргументы `transact`, `commitAuction` и `commitClan` теперь означают именно `playersRecovered`; legacy auction/clan journals всегда учитываются как player recovery.
- Auth HTTP, `verifySession`, общий player-mutation recovery и persistence-failure reconciliation синхронизируют live players только при восстановлении player target. Auth-only recovery больше не должен обновлять Player objects со старых disk snapshots.
- Добавлен regression test: auth-only journal recovery сообщает `playersRecovered=false` и сохраняет существующий player snapshot; отдельный pending journal с `players` сообщает `true` и replay-ит player state.
- Коммиты этой корректировки: `3d2c3b1aec8aed2f2d837228d934bb862263c54e` (shared WAL target inspection), `f8b0d679d3211fb2afd40ebc5e92f7325b1d3621` (runtime recovery semantics), `cba57b095eddf1e378be75e433f58fbbe8ea5300` (server integration), `fcf691c7854886139bc7040f70134cd2210a39f4` (regression test).
- Требуется новый Quality Gate на текущем HEAD; предыдущие запуски отменены/устарели после новых commits и не подтверждают эту корректировку.

## Штатная остановка и блокировка каталога данных — 2026-11-15

- Подтверждённый API Colyseus 0.16.26: graceful shutdown автоматически закрывает комнаты и транспорт; `onBeforeShutdown` вызывается до закрытия комнат, `onShutdown` — после их закрытия.
- Сервер останавливает autosave в `onBeforeShutdown`. Сохранение персонажей выполняется существующим WAL в `onLeave`; `onDispose` повторяет сохранение комнаты, а `onShutdown` делает дополнительную попытку для оставшихся в `ONLINE_PLAYERS` персонажей.
- Добавлен локальный `POST /internal/shutdown`: доступ только с loopback и с секретом из `MISTY_SHUTDOWN_TOKEN`, сравнение токена constant-time. Ответ отправляется до запуска `gameServer.gracefullyShutdown()`.
- Windows Start-Game генерирует случайный секрет после установки зависимостей, передаёт его только серверному процессу и хранит в игнорируемом Git файле состояния лаунчера. Клиент секрет не получает.
- Windows Stop-Game вызывает локальный endpoint, ждёт закрытия порта и удаления lock-файла. Если штатное завершение не подтверждено, сервер не завершается принудительно; состояние сохраняется для повторной попытки.
- Windows-лаунчер использует `npm run start`, а не `tsx watch`: в Windows Node `SIGTERM` через `child_process.kill` завершает процесс без вызова обработчиков, а watcher применяет такой способ при перезапуске. После изменений серверного кода его нужно перезапустить через BAT-файлы.
- Добавлен `server/src/dataDirectoryLock.ts`: эксклюзивное создание `.misty-server.lock` через `open(..., 'wx')`, PID/время старта/случайный token; release выполняется на `process.exit` только при совпадении собственного token. Второй процесс с тем же `MISTY_DATA_DIR` блокируется.
- Stale или повреждённый lock автоматически не удаляется: это fail-closed политика. Удаление вручную допускается только после проверки, что ни один сервер больше не использует каталог.
- Добавлены `server/test/dataDirectoryLock.test.ts` и `server/test/gracefulShutdownRuntime.test.ts`: эксклюзивность, stale-lock fail-closed, запрет второго процесса, отказ неверному токену, штатное завершение, сохранение созданного персонажа и освобождение lock.
- Quality Gate `43731571802` на HEAD `d53295033532dfb2818f4365ae39dd53866e6f28` завершился 4/4 success: server tests/build, Playwright, client build и data/docs audit. Следующий точный HEAD `ca4e19b4cb06386503b2f4af525fc51abe56b643` проверен Quality Gate run `43731939712`: все 4/4 jobs завершились success (server tests/build, Playwright browser smoke tests, client TypeScript/Vite и data/docs/project structure).
- PR #18 остаётся Draft/open, base `stage29/clean-validation-recovery`; merge не выполнять.
## Проверка WAL, онлайн-состояния и интеграции dungeon runs — 2026-11-15

- После успешного Quality Gate `43735489702` на HEAD `53d8e08ff71e4867a1c7f6e682e19645c3065555` добавлена обработка ошибок до публикации shared WAL: если журнал не создан, онлайн-персонажи перечитываются из последнего сохранённого player snapshot; если журнал остался, сначала выполняется WAL recovery. Изменения: `7d975980b23ac6e752cc616225fcfdc2945cef66`, regression test `d712bb218f5ead9f525fd45f85a592a666139b33`.
- Ошибка до WAL в `persistHuntGroups` теперь восстанавливает и roster групп, и онлайн Player snapshots; при наличии durable journal intended in-memory roster сохраняется до recovery. Изменения: `e97703abd42bd7d5c592c8744436878b22cc39bb`, `b972e8c802dedcc5e4763b8790f7de199ca9f454`.
- PvP opponent-list transaction получил reconciliation при ошибке; graceful shutdown rejection теперь обрабатывается явно, lock остаётся удержанным, ошибка логируется. Добавлены source-level/runtime regression assertions. Изменения: `21e3c62ed29ba467a54cb5ed4b3b24b949503647`, `1471a09b939e8d7b1750c64dc2b365c868c25edb`.
- `.gitignore` дополнен runtime saves, backups, transaction journals, temporary files и data-directory lock для default `server/data`: `32efe8215476d1954afa5c39d3e11587b1173ffe`.
- В hunt-group leave удалён второй локальный откат quest state: откат и reconciliation теперь принадлежат WAL-aware `persistHuntGroups`, чтобы handler не отменял intended state при уже опубликованном pending journal. Regression assertion добавлен. Последние commits: `7668f5676263762ae1c55961520a50df04ad42b1`, `2fb88e2d32b7cf3969aefc7a94630fe3c369d6e7`.
- Quality Gate run `43737135910` на точном HEAD `2fb88e2d32b7cf3969aefc7a94630fe3c369d6e7` завершился failure: 3/4 jobs passed (Playwright, client build, data/docs); server job сообщил 403/404 tests passed. Единственный failure — `clanWarRuntime.test.ts:268`: после challenge тест не нашёл запись `war-expired-stale` в `clan_wars.json` (TypeError при чтении `status`). Запущен retry только failed server job; результат retry пока ожидается. Не считать HEAD полностью CI-validated до результата retry.
- Dungeon runtime audit: `dungeon_runs.json` подключён как shared-WAL target и загружается/валидируется при старте; `ACTIVE_DUNGEON_RUNS` строится из этого файла. Но в production `server/src/index.ts` нет вызовов `commitDungeonRunStart`, `commitDungeonRunRound` или `commitDungeonRunFinalization`, нет ни одного `ACTIVE_DUNGEON_RUNS.set/delete`, и нет runtime-записи `dungeonRuns`. На join отправляется recovery view из загруженной map, entry/resurrection проверяют её, однако активные run records текущим gameplay flow не создаются.
- Фактический `dungeonRun` handler всё ещё вызывает legacy `runExpeditionDungeon`: бой целиком рассчитывается синхронно в одном запросе, попытки/итоговые player snapshots сохраняются через shared WAL, результаты отправляются через durable `dungeonOutbox`. Это отдельный работающий legacy flow, но он не является resumable multi-round run и не использует новые durable run lifecycle modules.
- Не подключать новый dungeon lifecycle автоматически в рамках persistence-only фиксов: такая миграция затрагивает последовательность RNG, combat rounds, HP, attempt charging, rewards, drops, idempotency и client protocol. Сначала требуется отдельная интеграционная спецификация и доказательство эквивалентности текущему игровому контракту; существующий flow пока не менять.
- PR #18 остаётся Draft/open, base `stage29/clean-validation-recovery`; merge не выполнять. Текущий branch HEAD на момент записи: `2fb88e2d32b7cf3969aefc7a94630fe3c369d6e7`.
## Уточнение dungeon result delivery — 2026-11-15

- Дополнительно проверен `client/src/dungeonResultDedup.ts`: клиентская дедупликация `combatResult` по `eventId` уже реализована и вызывается до UI side effects в обработчике `combatResult`. Она хранит до 500 ID на игрока в browser storage и дополнительно использует session-level Set. Поэтому прежняя формулировка в `DUNGEON_LIFECYCLE_DESIGN.md` о том, что client deduplication ещё отсутствует, была устаревшей и исправлена.
- Это закрывает повторное отображение одного и того же outbox event в пределах сохранённой истории браузера; серверная доставка остаётся at-least-once по природе (crash между send и ack может повторить событие), а очистка browser storage/другой браузер не дают глобальной exactly-once гарантии.
- Документальная корректировка: commit `40cdb8c6c956f62b3a1a5b80ebc75c1c6e37716a`. Предыдущий Quality Gate `43737899883` на HEAD `e42d92d74e992134798846b10f82c7b8f94ceae1` ещё выполнялся; новый commit требует собственного CI.
## Дополнительный аудит dungeon request identity — 2026-11-15

- Проверен legacy request cache: `prepareDungeonRequestResult()` сохраняет только `{ id, report, text }` в `dungeonRequestHistory` (последние 5 записей) и `dungeonLastRequest`; идентичность dungeon/group/leader/ordered roster не привязана.
- `runExpeditionDungeon()` считает запрос повторным, если любой участник имеет совпадающий ID, и завершает обработку всей группы; старый результат отправляется только тем участникам, у кого он есть. Это не доказывает повторную выдачу наград, но может подавить валидный новый групповой запрос и привести к разному UI у участников при повторном использовании requestId. Более сильный `resolveDungeonRequestRecovery()` проверяет полную identity, но production handler его не вызывает.
- История из пяти записей не является постоянным idempotency ledger: после вытеснения старого ID повторный запрос может рассматриваться как новый. Официальный клиент держит один pending `{id,requestId}` в localStorage и блокирует переключение dungeon до ответа, но это не серверная гарантия для другого устройства/custom client.
- UI показывает восстановленный active run и блокирует новый вход, но не имеет action для продолжения/завершения/отмены раундов. Так как production пока не создаёт durable active run records, это dormant UI; при будущей интеграции run lifecycle resume controls должны быть частью того же этапа.
- Эти ограничения задокументированы в `DUNGEON_LIFECYCLE_DESIGN.md` commit `69af843626e2a02cda88b6461af4724ae638b748`. Не добавлять частичный обход в legacy handler; использовать один authoritative immutable run identity при будущей миграции и покрыть ID reuse, group mismatch, cross-player mismatch и retry после вытеснения истории тестами.
- Quality Gate run `43738211361` (PR) / `43738206845` (push) запущен на HEAD `69af843626e2a02cda88b6461af4724ae638b748`; результаты ожидаются.
## Dungeon resurrection snapshot invariant — 2026-11-15

- Audit of `prepareDungeonRevival()` found a future integration inconsistency: it updated `dungeon_runs.json` participant HP and consumed one scroll from the rescuer, but left the target's `players.json` health unchanged. A reconnect before the next round could restore stale HP.
- Fixed helper to require both rescuer and target player snapshots and write target `health = reviveHealth` alongside the rescuer's updated inventory. Added regression assertions for target HP synchronization, input immutability, serialization, and missing target snapshot rejection. Commits: `303d139411b40328190e27569d0b839925bb7074`, `7f7d89c0d35203e6e94ec3efd6a267368967f02d`; design note commit `0b95a075652fb6f58b58844d69ffea73a25e6d89`.
- The helper remains unintegrated with the live handler; this is a correctness fix to the future transaction-preparation layer, not a claim that in-combat resurrection is enabled.
- Before live wiring, resolve death semantics: both legacy health settlement and durable round resolver clamp HP to at least 1, but the lifecycle design also defines spectator/death transitions. The legacy victory rule requires every participant to survive incoming damage. Define how death/spectator, leader death, party continuation, and resurrection interact; do not silently change combat outcomes while preserving formulas.
- New Quality Gate required for the latest branch HEAD after these commits.
## Разделение полного WAL recovery и player-only recovery — 2026-11-15

- Выявлен важный контрактный дефект: `sharedStateRuntime.transact()` передавал callbacks только `playersRecovered`, хотя dungeon lifecycle helpers трактовали аргумент как признак любого восстановленного WAL. Журнал, содержащий только `dungeonRuns` или `dungeonOutbox`, мог быть успешно replay-нут, но helper видел `false` и мог записать старый заранее загруженный snapshot поверх восстановленного.
- Добавлен `transactWithRecovery()` с `{ recovered, playersRecovered }`; существующий `transact()` сохранён с прежней player-only семантикой, чтобы не менять поведение auth/player mutation callers. `commitDungeonRunStart`, `commitDungeonRunRound`, dungeon finalization, prepared encounter commit/finalization и outbox acknowledgement теперь fail-closed при любом replay и требуют reload/retry.
- `persistHuntGroups()` также переведён на полную recovery metadata, поскольку использует in-memory `HUNT_GROUPS`/`PLAYER_GROUP`; после любого recovery group mutation отклоняется и catch восстанавливает roster с диска.
- Добавлены тесты: `sharedStateRuntime.test.ts` различает outbox-only replay от player snapshot replay; `dungeonResultOutboxRecovery.test.ts` создаёт crash-pending outbox-only journal со статусом delivered и доказывает, что stale pending snapshot не может перезаписать его; `dungeonRunStartWal.test.ts` доказывает, что dungeonRuns-only journal блокирует commit со stale run map. Source regression assertion подтверждает полный recovery gate в `persistHuntGroups`.
- Основные commits: `959457196a780b2d5a992d6064c6df4ae50d8e2b` (runtime API), `197226b877b85fbe51fcfbdef0a4965a43472254`, `f9a320f3b77b787caf1d954018645f3d6f2c6bc3`, `f53c283512958be33a1d08319ccdf939d53dfb38`, `46e3e2544b71e34bbdd2e9c58865ef1b6d16c571`, `13c18cfb1526bf6d773b926677b1dbf3fad565f2` (dungeon helpers); `60be0f1f55e4fd7922806a355e463d984a022793`, `d52d4d8e382cb2371727881ed5bdf4569b3d8fa7`, `8248ab93b9f3db9eb09bfdf0d74e49a3b44c1fd5` (recovery regression tests); `1c8d642d42789d2b82edd35abc98c5d52ae2b9c3`, `7319060f50bc9d9dfd6609f0e120730f3e7f91c5`, `0d5f8620056365379fb86d2e7bd74c154d89fecc` (ack and group integration).
- Current branch HEAD at checkpoint update: `0d5f8620056365379fb86d2e7bd74c154d89fecc`. New full Quality Gate is required; previous run `43738452495` was for earlier HEAD `234be755f9e7bacc4d18e2e85e681f018895e449` and must not be used to validate these changes.


## CI confirmation and transaction routing follow-up — 2026-11-15

- Quality Gate `43739314515` completed successfully on exact HEAD `bcc286b4803db740a870eba5bd46ad7023455940`: all four jobs passed — server transaction recovery/tests and TypeScript build, client TypeScript/Vite build, Playwright browser smoke tests, and data/docs/project structure.
- Follow-up source audit: production auction mutations use `sharedStateRuntime.commitAuction`; clan mutations use `commitClan`. Legacy auction/clan transaction stores are recovery-only. Shared runtime resolves legacy journals before preparing new snapshots, fails closed if both legacy journals are pending simultaneously (ambiguous ordering), and reports player recovery separately from non-player WAL replay. No direct production legacy-store commit invocation was found.
- Mining is represented by Player state/counters in this branch; no separate mining persistence file is configured in the shared WAL, so the generic `mining` key is currently unused here.
- Current validated branch HEAD: `bcc286b4803db740a870eba5bd46ad7023455940`. PR #18 remains Draft/open and unmerged. Do not merge without explicit approval.


## Expedition disconnect and retry audit — 2026-11-15

- `Room.onLeave` first verifies that the leaving client still owns the current room session, recovers pending player WAL, applies health regeneration, and persists affected online group members before releasing online ownership. A stale room/client cannot run this path because of the session-ownership guard.
- If a grouped expedition search/travel is active when any member disconnects, the handler resets the active action for all currently online group members (`state=idle`, clears `endsAt` and `targetZoneId`) and persists their snapshots. It retains the hunt-group roster; the disconnected member is represented as offline and can rejoin. This is cancellation, not resumable progress.
- Solo search/travel state is not reset in `onLeave`, and `onJoin` preserves a solo in-flight timer when the saved `groupId` is empty. The runtime regression test confirms a solo search resumes with its original `endsAt` after reconnect. `onJoin` clears active state only when a stale non-empty group association no longer matches the restored roster.
- `expeditionSearchClaim` validates that all members are online and that their state, group ID, zone, and end timestamp match. On successful resolution it changes the state away from `searching` and persists all participant results together. A repeated claim therefore cannot settle the same search a second time after the first durable commit; a pre-commit crash leaves the prior searching snapshot and no durable rewards.
- `expeditionTravelClaim` similarly requires consistent moving states and a completed timer, then atomically persists the updated participant locations. No autonomous AFK watchdog or scheduled settlement was found in this live expedition path.
- Dungeon-specific AFK rules (leader idle 60 minutes, disconnect distinct from AFK, solo durable run survives reconnect) remain unimplemented because the production dungeon handler still does not create durable active runs. Do not infer that ordinary expedition behavior implements those dungeon rules. No gameplay code changed in this audit.
- Source review only; no local runtime tests were run. The latest GitHub Actions run `43741125657` passed all 4/4 jobs on exact commit `0a10796a78c5467007b1ed4b27915be591725bbd`.


## Auth input-boundary audit — 2026-11-15

- Login previously passed any password string from the HTTP body (up to the 8 KiB request-body cap) directly into synchronous `scryptSync`, while registration limits passwords to 8–128 characters. This created avoidable CPU work for oversized login inputs.
- Added `isPasswordLengthWithinLimit()` and reject passwords longer than 128 characters before `scryptSync`; valid registered passwords and password hashing parameters are unchanged. Added unit coverage for 128, 129, and 8192 characters.
- Changes: `server/src/authPasswordPolicy.ts`, `server/test/authPasswordPolicy.test.ts`, and the `passwordMatches()` guard in `server/src/index.ts`. Awaiting GitHub Actions on the latest branch HEAD; no local tests were run.


## Auth/session lifecycle review — 2026-11-15

- Reviewed `/auth/guest`, `/auth/register`, `/auth/login`, `/auth/check`, `/auth/logout`, session verification, and client auth persistence.
- Server stores SHA-256 digests of opaque random session tokens and guest recovery proofs, not the raw secrets. Sessions expire after 30 days; guest recovery requires either the stored proof or a still-valid guest session. Guest-to-account registration verifies the proof and atomically writes account + replacement session + guest-proof removal, while revoking existing guest sessions for that player.
- Username uniqueness is case-insensitive; account registration password bounds are 8–128 characters. Login now applies the same upper bound before synchronous scrypt (see prior note).
- Client persists session tokens and guest recovery proofs in `localStorage`. This is a known browser security trade-off: any successful same-origin script injection could read them. Do not treat localStorage as an HttpOnly-cookie equivalent; a future public deployment should prioritize strict output escaping, a restrictive Content-Security-Policy, dependency hygiene, and HTTPS/WSS. Changing the current WebSocket auth/session design is out of scope for this audit.
- Client logout currently treats the server revocation call as best-effort and clears local credentials even if the request fails. In that case the server-side token may remain valid until expiry, although the client has discarded it. This should be considered in a future logout UX/security change (e.g. surface revocation failure or preserve a retry path) rather than silently changing current session semantics here.
- No further auth/session code changed in this review. Source inspection only; no local tests run.


## Admin authorization audit — 2026-11-15

- Проверены `MISTY_ADMIN_PLAYER_IDS`, `parseAdminPlayerIds()`, admin message handler, общий `onAuthenticatedMessage()` wrapper и auth guest/register/login flow.
- Админ-команды отключены по умолчанию: пустой/отсутствующий env даёт пустой allowlist. Доступ проверяется по серверному `this.playerId`, а не по полям payload. До обработчика проверяется действующая сессия, совпадение session.playerId с room player ID и текущая принадлежность клиента персонажу.
- Guest player ID генерируется сервером из случайных байтов; повторное использование существующего гостевого ID требует guest recovery proof или действующий guest session. Account ID при обычной регистрации также генерируется сервером. По просмотренному auth flow не найдено клиентского пути самостоятельно назначить себе доверенный ID.
- Найдено устаревшее и опасно вводящее в заблуждение описание в `server/ADMIN_SETUP.md`: оно утверждало, что админ-команды открыты всем аккаунтам. Документ обновлён и теперь описывает серверный env allowlist, точное сравнение ID, отключение по умолчанию, список команд и ограничения тестового режима.
- Текущие unit tests проверяют parsing allowlist, но не выполняют end-to-end проверку авторизации admin message через поднятый Colyseus room. Это остаётся полезным усилением тестового покрытия; подтверждённого обхода авторизации при source review не найдено.
- Кодовую авторизацию не менял. Изменён только `server/ADMIN_SETUP.md` и этот checkpoint. Требуется новый GitHub Actions Quality Gate для нового HEAD; локальные тесты не запускались.

- Дополнительная проверка клиентского UI обнаружила ту же устаревшую формулировку в `client/src/main.ts`: интерфейс утверждал, что админ-панель открыта всем аккаунтам. Текст исправлен: панель может отображаться, но каждое действие авторизуется сервером по allowlist. Само наличие UI не даёт полномочий. Изменение только текста; admin transport/permission logic не менялись. Новый Quality Gate требуется для HEAD после UI-коммита.


- Admin authorization regression coverage: added `server/test/adminAuthorizationRuntime.test.ts`, which starts an isolated real server with a server-side admin allowlist, connects two authenticated Colyseus clients, confirms the non-allowlisted player is denied even when sending forged `playerId`, `isAdmin`, and `role` payload fields, and confirms the allowlisted player's command persists while the regular player's balance remains unchanged. Added the test to `server/package.json` test script. This is test-only coverage; authorization/gameplay code was not changed. Awaiting GitHub Actions for the new HEAD; no local tests were run.


## Client/browser security review — 2026-11-15

- Reviewed `client/index.html`, `client/src/main.ts`, and `tools/Start-Game.ps1`. The launcher serves the browser client through Vite dev server on loopback port 5173 and the game/auth server on port 2567. There is no CSP meta/header in the current client entry document.
- `client/src/main.ts` has four `innerHTML` assignments (auth view, character creation, main view, item tooltip). The inspected player/item/name/description interpolation paths use the shared `esc()` HTML escaping helper; no `eval`, `new Function`, `document.write`, `insertAdjacentHTML`, or `outerHTML` use was found in the file. This is a focused source review, not a proof that every template path is safe.
- The HTTP auth handler currently sends `Access-Control-Allow-Origin: *` and accepts OPTIONS broadly. This does not by itself expose localStorage tokens cross-origin (the app uses body-supplied bearer tokens, not cookies), but it allows arbitrary browser origins to call/read the local auth API and unnecessarily broadens the browser attack surface.
- Auth endpoints already have an in-memory per-IP limiter: 10 requests per 15-minute window for login, registration, and guest creation, with expired-entry cleanup and a 10,000-entry cap. This is process-local and does not coordinate multiple server instances; the current launcher runs one local process.
- No CSP/CORS code was changed in this pass. The correct CSP and exact CORS allowlist depend on the intended production client origin, WebSocket endpoint, and asset/font sources; setting a guessed policy could break Vite HMR, game WebSockets, or a future hosted deployment. Before public launch, define explicit allowed origins, HTTPS/WSS, CSP response headers (including frame-ancestors), and a deployment-specific binding policy for the server listener.
- No confirmed exploitable XSS was identified in the focused source review. The existing localStorage session/recovery secret exposure remains the principal consequence if a same-origin XSS is introduced.
- Source inspection only; no local tests run. Existing GitHub Actions run 43743989279 passed all four jobs on HEAD 7bb26af3f7ce8b1f1b211295291b16b6b43a9907.


## Authenticated gameplay message rate-limit review — 2026-11-15

- Reviewed the shared `Room.onAuthenticatedMessage()` wrapper and representative high-write handlers: `tavernGame`, `openChest`, `daily`, `fountain`, `buyItem`, `craftClaim`, `raceDailyClaim`, and quest rewards.
- The shared wrapper verifies session/room ownership and runs WAL recovery, but it does not apply a general per-player or per-message-type rate limit. The existing `AUTH_RATE_LIMIT` applies only to HTTP authentication attempts, not authenticated Colyseus gameplay messages.
- Several valid gameplay messages can synchronously mutate player state and call `notice()`, which saves the player. Therefore a connected authenticated client can send high volumes of otherwise valid actions (for example repeated tavern bets, purchases, or invalid-action notices), increasing CPU, WAL/file I/O, and outbound message load. Individual gameplay cooldowns/ownership/eligibility checks exist in some handlers, but they do not provide a common ingress budget.
- This is a resource-exhaustion/availability hardening finding, not evidence of reward duplication or a confirmed remote unauthenticated exploit. Impact depends on deployment scale and persistence throughput. No rate-limit code or gameplay behavior was changed in this audit.
- Recommended next step: design a server-side token bucket per authenticated player with a modest global message budget plus stricter buckets for expensive/write-heavy actions; exempt or separately budget legitimate high-frequency state traffic. Return a bounded throttling response, avoid saving on every rejected packet, and add runtime tests for burst rejection, refill, per-player isolation, and reconnect behavior. Choose thresholds only after classifying all inbound message types so normal gameplay is not disrupted.
- Source inspection only; no local tests run. Quality Gate run 43744832354 passed all 4/4 jobs on HEAD 33b9873b9d03f5808716185247192b132f3b8686.


## Authenticated gameplay message classification — 2026-11-15

- Static source review mapped all 74 distinct official-client gameplay event names to matching server `onAuthenticatedMessage` handlers. Two server handlers (`combatHistory`, `rename`) are not present in static client sends.
- Classified handlers by execution cost rather than names. Several list/read-shaped handlers are stateful: `craftQueue` can settle jobs; `clanQuests` maintains quest state; `clanWarList` settles expired wars; `pvpList` runs a shared-state transaction and may persist refreshed offers. `achievements` is conservatively treated as stateful pending a separate proof of read-only behavior.
- Identified stricter-cost classes: auction shared-WAL mutations; clan/war transactions and broadcasts; PvP combat; expedition group combat and multi-player persistence; synchronous dungeon runs. Player writes and `notice()` paths also require mutation budgets because invalid actions can trigger persistence.
- Design constraints and full event grouping are recorded in `GAMEPLAY_MESSAGE_RATE_LIMIT_CLASSIFICATION.md`. Recommended design is server-side per-authenticated-player token buckets with separate general, mutation, and expensive-operation budgets; bounded rejection without persistence; explicit reconnect/session semantics; and runtime tests including proof rejected packets do not write saves/WAL.
- No numerical thresholds selected and no gameplay code changed. Static source review only; no local tests run.
 
## Authenticated gameplay ingress follow-up — 2026-11-15

- Additional review found that every inbound authenticated gameplay message currently runs `verifySession(this.sessionToken)` and then `recoverPlayerStateBeforeMutation()`. `verifySession` itself calls pending-player-WAL recovery and reads session and account JSON data, so a message can trigger repeated recovery checks and disk-backed authentication reads before its handler.
- Limiter placement must account for this: a cheap room/client ownership check can precede a per-player ingress budget, then expensive session/WAL checks and handler execution. However, session revocation semantics must remain intact: logout removes the durable session and closes the matching live client. Do not replace validation with an unchecked cache.
- Current server topology allows one client per room and one online room per player. A process-scoped player bucket would cover reconnects in that process, but resets on process restart and is not coordinated across multiple server instances. Multi-instance deployment needs shared coordination or explicit single-process deployment guarantees.
- No implementation, benchmark, or runtime test was performed. Detailed constraints are in `GAMEPLAY_MESSAGE_RATE_LIMIT_CLASSIFICATION.md`.


## Official client request cadence audit — 2026-11-15

- The official client sends 13 initialization requests after each successful Colyseus connection. `clanList` response handling then repeats `clanQuests` and `clanTerritories`, already included in that initialization batch. This is a confirmed duplicate-request optimization opportunity; no code was changed.
- The one-second interval is local UI countdown rendering, not a one-second network poll. PvP list refresh is a guarded one-shot request at the tracked expiry timestamp.
- Client `guardedActions` prevents some duplicate UI clicks but is not a security/rate-limit boundary: it does not cover all refreshes, has an 8-second timeout, and any notice clears all pending keys. Server-side ingress controls are still required.
- Preserve the legitimate startup burst when designing limits; distinguish bootstrap, read/refresh, mutation, and expensive transaction/combat traffic. Source review only; no benchmark or runtime test; no threshold selected.


## Per-packet recovery duplication finding — 2026-11-15

- `onAuthenticatedMessage` currently calls `verifySession`, then `recoverPlayerStateBeforeMutation`, then the handler. `verifySession` already calls `recoverPendingPlayerState`; the explicit mutation preflight calls it a second time. Thus each authenticated gameplay packet scans shared and legacy auction/clan journals twice, then reads session and account JSON for authoritative token/account validation.
- The duplicate journal scan is a concrete optimization target. Proposed safe direction is one combined ingress gate with a single recovery result, retaining durable session checks and recovery-before-mutation. Do not replace durable revocation validation with `ONLINE_SESSION_HASHES` or room maps; those only establish process-local ownership and do not prove cross-instance revocation.
- Any future pre-auth ingress limiter must be keyed from trusted room-bound player identity and preserve stale-room/logout/recovery behavior. No code changed; no syscall benchmark or runtime test performed.


## Recovery result propagation audit — 2026-11-15

- Duplicate WAL recovery scans also occur during `onJoin`: `verifySession` recovers player state, then `onJoin` calls the recovery helper again.
- `dungeonRun` can perform a third scan after the authenticated wrapper's two scans. Its local guard intends to stop and ask the player to retry when a player snapshot was recovered, but the earlier wrapper has already consumed that recovery result. The boolean is not propagated, so the dungeon-local guard may see `false` and continue. This is a source-level control-flow mismatch; runtime behavior has not yet been tested.
- Safe refactor contract: one combined ingress authentication/recovery result `{ session, recovered, playersRecovered }`; retain durable session/account checks and propagate recovery metadata to handlers that require retry after player snapshot replay. `onJoin` should use one recovery result before loading the player. Keep lifecycle recovery paths (`onLeave`, `onDispose`, periodic/shutdown persistence) separately scoped.
- Regression tests before implementation: one recovery scan per authenticated packet; player-WAL recovery signal reaches dungeon guard and blocks that attempt; auth-only/outbox-only recovery does not trigger player retry; logout revocation and live room closure; stale room rejection; recovered snapshot loaded at join; ambiguous journal fail-closed; no handler after failed recovery. Extend existing real-Colyseus auth tests and sharedStateRuntime unit tests.
- Source inspection only; no code changed, no benchmark or runtime test. Documentation-only HEAD requires CI.


## Auth HTTP recovery call-site follow-up — 2026-11-15

- The authenticated HTTP handler performs an unconditional `recoverPendingPlayerState()` after parsing every `/auth/*` POST body.
- `/auth/check` and `/auth/logout` then call `verifySession()`, which performs another player-recovery scan before reading session/account files. This duplicates the preflight scan on both endpoints.
- `/auth/guest` can call `verifySession()` for legacy-session recovery, causing a second scan on that branch. Guest/session issuance and account registration also enter `sharedStateRuntime.transact()`, which performs its own recovery coordinator pass after the HTTP preflight. Thus the duplication is broader than gameplay WebSocket messages.
- The shared runtime's `transact()` then delegates to the shared store's own transaction wrapper, which performs its own internal recovery check; this is another call boundary to inspect before consolidating. Preserve WAL ordering and fail-closed behavior; do not simply delete preflights without proving transaction callbacks cannot observe stale state.
- Next safe design step: expose one explicit recovery context per request/ingress operation and make transaction APIs accept/consume that context only if their atomicity contract can be preserved. Otherwise keep recovery at transaction boundaries and remove only redundant outer scans after tests prove correctness.
- No code changed; source inspection only. No syscall benchmark or runtime test performed.


## Shared transaction coordinator duplication — 2026-11-15

- Confirmed `createSharedStateRuntime` calls `recoverPendingStateDetails()` before every runtime transaction (`transact`, `transactWithRecovery`, `commitAuction`, `commitClan`), then delegates to `options.shared.transact()`. `createSharedStateTransactionStore.transact()` unconditionally calls its own `recover()` before invoking the prepare callback. Therefore the shared WAL recovery check/replay entry point is invoked twice on these paths. The second call is still valuable for standalone/direct store callers, but is redundant inside this synchronous single-process coordinator after the first successful recovery.
- Existing `sharedStateRuntime.test.ts` explicitly asserts the duplicate sequence (`shared.recover` in coordinator, then `shared.transact` → `shared.recover`). This means a future optimization must update the expected call-count tests and add a direct-store regression proving standalone `shared.transact()` still recovers before snapshot preparation.
- Legacy auction/clan coordination also checks `hasPending()` and then calls `recover()` unconditionally. With no journal, both calls perform filesystem existence checks; with a pending journal, the journal is parsed/replayed only in `recover()`. The shared store similarly calls `hasPendingPlayers()` (which parses and validates a pending shared journal) before `recover()` parses it again. These checks are not equivalent to replay duplication: they support ambiguous-legacy-order rejection and `playersRecovered` classification. A safer API could return validated journal metadata from a single inspect/recover operation rather than dropping the checks.
- Safe refactor candidate: add a coordinator-only `transactAfterRecovery`/recovery-context path in the shared store, while retaining the existing self-recovering `transact()` for standalone callers. Keep the current synchronous single-process + exclusive data-directory lock assumption explicit; do not expose a bypass that can be called without successful coordinator recovery. Test direct-store recovery, coordinator one-pass behavior, pending shared/legacy replay, fail-closed corrupt/ambiguous journals, recovery metadata (`recovered` vs `playersRecovered`), and that callbacks never run after failed recovery.
- Source review also confirmed production auction/clan mutations route through the coordinator (`commitAuction`/`commitClan`); legacy `auctionTransactions.commit` and `clanTransactions.commit` remain recovery-only. No direct production bypass was identified in reviewed call sites.
- No code changed; no benchmark or runtime test performed. The finding is source-level and the current CI validates the unchanged implementation, not a proposed refactor.


## WAL crash-boundary audit — 2026-11-15

- Source review confirms the shared WAL publication barrier: temporary journal contents are fsynced, the journal is renamed into place, and the data directory is synced before any transaction target is applied. Each target uses temp-file write + file fsync + atomic rename + directory sync (directory fsync is intentionally skipped on Windows). Recovery replays the complete validated snapshot and only then removes the journal and syncs the directory.
- On target-write failure, the shared store attempts immediate full replay; if replay still fails, the journal is retained and subsequent writes fail closed. Corrupt/unconfigured journals are retained. Player backups are created and synced before replacing the player snapshot; backup failure blocks the transaction.
- Existing tests cover crash immediately after journal publication, crash after the first shared target (`players`), all three account-linking target boundaries, target-write failure/recovery, corrupt journal fail-closed, and journal-directory-sync failure. Legacy auction/clan tests cover their respective interrupted multi-file paths and fsync ordering.
- Coverage gap: the shared multi-target crash test terminates only after `players`; it does not inject process termination after each remaining shared target key (auction/history/clans/wars/territories/mining/huntGroups/dungeonRuns/dungeonOutbox/accounts/sessions/guestCredentials). The implementation loops in deterministic `SHARED_STATE_KEYS` order, but the rest of the replay matrix is not directly demonstrated. Add a parameterized child-process crash/restart test for each configured target boundary and assert every target equals the complete journal snapshot after restart, journal removal, and a second recovery is a no-op.
- Additional useful boundary: inject a hard process exit after the journal unlink / during the final directory-sync callback. Expected outcome is either journal absent or safely replayable if the directory entry reappears; all targets must already be durable and replay must remain idempotent. Existing legacy tests assert final directory sync ordering, but the shared store lacks an explicit crash-at-journal-removal test.
- No confirmed data-loss defect found in the reviewed shared WAL path. No production code or tests changed; no runtime benchmark or local test execution. This is a coverage recommendation, not a claim that untested paths are broken.


## Player-save backup audit — 2026-11-15

- Production player persistence routes through `sharedStateRuntime` / the shared WAL. `index.ts` obtains `loadPlayers` from `createPlayerSaveStore`; reviewed production writers use `sharedStateRuntime.transact` / `commit*`, which invoke the shared store's backup path. The standalone `createPlayerSaveStore.savePlayers()` helper has tests but is not the persistence path used by the reviewed production call sites; it lacks the shared WAL's fsync guarantees and should not be reintroduced as a production writer without hardening.
- Shared WAL backup behavior: before replacing `players.json`, copy the current file to a uniquely named `.bak`, fsync the backup file, rename it into place, and fsync the data directory. Backup failure aborts target replacement. After a successful target replacement, pruning is best-effort and keeps the newest five lexically sortable backups. Windows intentionally skips directory fsync, while still syncing file contents.
- Loading malformed/unreadable `players.json` fails closed; the loader does not silently replace it from a `.bak`. This avoids choosing an unverified or stale backup, but leaves manual recovery/operator procedure undocumented. Backups are not checksum-validated and there is no automated restore/verification command.
- Confirmed retry-amplification risk in the shared backup flow: backup creation happens before target atomic-write, while pruning happens only after target write succeeds. If backup creation succeeds but target temp write/fsync/rename repeatedly fails, each subsequent WAL recovery retry can create another backup of the same unchanged `players.json`; pruning never runs on those failures. This can grow `.bak` files beyond five and worsen disk-space pressure. No data-loss defect was established. Recommend make backup creation idempotent per pending journal/target (or otherwise avoid duplicating an identical pre-transaction snapshot), and test repeated recovery failures followed by successful recovery, asserting bounded backups and preservation of the original save.
- Additional coverage recommendations: inject target publication failures after backup durability (not only backup-creation failure), verify repeated retries do not grow backups without bound, validate manual restore guidance against corrupt/valid-but-stale backups, and document the Windows directory-sync durability limitation. Keep fail-closed loading; do not auto-restore without an explicit validated operator workflow.
- No production code or tests changed; no local tests executed. Source review only.


## Player-save loading and migration integrity audit — 2026-11-15

- Added source-review report `PLAYER_SAVE_LOAD_VALIDATION_AUDIT.md`. No production code, tests, or player data changed; no local tests executed.
- Player save envelope validation fails closed for unreadable/malformed JSON, invalid roots, and non-object player entries, but it does not validate per-field schemas, nested JSON strings, sizes, enums, identity consistency, or gameplay ranges.
- `applyPlayerSave` performs shallow type matching and ignores unknown/wrong-type/non-finite values, but accepts any finite numeric value, arbitrary strings, and arrays wholesale. `applySaved` only floors level and enforces a minimum of 1; it has no maximum, so a huge finite level can overflow derived `xpNeed(level)` to Infinity. String-backed JSON fields can be malformed and fail later when consumed by `readPlayerArray` / `readPlayerObject`.
- Join-time normalization is limited to profession and legacy city/reputation/visited-key normalization. No general versioned player migration registry or comprehensive validation boundary was found. City normalization mutates the in-memory Player and is persisted by later normal WAL writes.
- Accounts/sessions/guest credentials have basic structural predicates, but no comprehensive duplicate, digest-format, string-bound, safe-integer, or cross-file integrity validation at load. Dungeon run validation is substantially stricter, though safe-integer/string-size/unknown-key hardening remains possible.
- Recommendation: first inventory real legacy-compatible field invariants, then design a pure versioned validator/migration with explicit preserve/quarantine behavior and idempotence fixtures. Do not guess caps or silently clamp/reset inventory, currency, progression, or identity. No production changes made pending compatibility review and approval.
- CI run `43755277331` on exact prior HEAD `9287a1252482007c38eec105c04a063cf779bb51`: client build, data/docs/structure, and Playwright jobs succeeded; server transaction recovery/build job was still in progress at the latest poll. Recheck before considering the prior HEAD fully validated.


## Player field inventory follow-up — 2026-11-15
- Expanded `PLAYER_SAVE_LOAD_VALIDATION_AUDIT.md` with the current PlayerSchema field inventory grouped by identity/location, timing/position, progression/stats, currency/counters, buffs, and serialized JSON collections; distinguished Colyseus synchronized fields from ordinary server-side Player properties.
- Confirmed the current eight race/profession pairs and only one legacy alias (`Воин` → `Рыцарь`). `normalizePlayerProfessionData` applies that alias but does not call `isProfessionAllowedForRace`, so a mismatched or unknown race/profession pair can remain stored. No automatic class correction is recommended; this requires compatibility inventory and quarantine/report semantics.
- Recorded the five legacy city-name mappings and reputation/visited-key migration behavior, plus optional gender compatibility under `collections.characterGender` (missing/invalid remains null). Existing city migration mutates the in-memory Player; later WAL persistence writes it.
- Auth loader predicates were inspected: accounts, sessions, and guest credentials have array/object/primitive checks, but not full uniqueness, bounded-string, digest-format, safe-integer, or cross-file referential validation.
- No field caps, enum coercions, or migration code were added. Need real legacy save corpus and field semantics before selecting constraints. Preserve identity, inventory, currency, progression, gender, and achievements; require idempotence and WAL rollback tests for any future migration.


## Legacy save corpus / Git history evidence — 2026-11-15
- Inspected Git history for PlayerSchema and current static world/equipment catalogs. Each inspected core file has only the initial repository import commit dated 2026-11-08; the repository history cannot reconstruct pre-import schema/catalog variants.
- The tracked repository contains current static catalogs but no representative player-save fixtures. .gitignore explicitly excludes players.json, player backups, .local-data, and runtime account/session/game-state persistence. This is a deliberate privacy boundary, not evidence that no older save formats exist.
- Stage 28 changelog documents the five city-name migration and preservation intent; current profession source documents only Воин → Рыцарь. Neither source proves the complete population of values in deployed legacy saves.
- Updated PLAYER_SAVE_LOAD_VALIDATION_AUDIT.md with evidence classification and the required next step: obtain user-approved, privacy-scrubbed, read-only representative save snapshots/backups; preserve original bytes; exclude credentials/session/guest secrets; build fixtures; inventory historical IDs/enums/keys/timestamps/coordinates; then define idempotent, rollback-safe versioned migrations.
- No player save was accessed, no production code/tests/data changed, and no migration behavior was introduced.
- CI run 43755771841 on HEAD 1593860b: data/docs/structure, client TypeScript/Vite build, and Playwright smoke tests succeeded. Server transaction recovery test remains in progress; compile step has not started. Do not call the full CI green until the server job completes.


## Equipment catalog identity audit — 2026-11-15
- Parsed current tracked equipment_catalog.json: 387 entries; all IDs/names non-empty; no duplicate IDs or names; kinds are 56 weapons, 320 armor, 11 amulets.
- Server source treats the new catalog as authoritative for new equipment, marks the original in-code equipment entries as legacy, and appends new catalog plus expedition drops. Source comment explicitly preserves legacy IDs for existing saves, auctions, and recipes.
- Compatibility rule: never repurpose/rename an item ID without a verified migration plan. Current catalog and history are insufficient to prove the full historical ID population.
- Forgotten Lands signatureDrop values are names; gatekeeper references are IDs. Keep those namespaces distinct.
- No cross-reference against real player saves was possible because runtime saves are gitignored. No IDs, prices, stats, saves, or production code changed.


## Cross-catalog identity / recipe queue audit — 2026-11-15
- Current static snapshot: 149 original in-code item IDs + 387 new equipment IDs + 125 Forgotten Lands drop IDs = 661 unique runtime IDs with no cross-source collisions.
- Verified all 11 static recipe outputs and 27 material references; all resolve. The 40 legendary armor items generate additional runtime recipes; required special materials FLDROP-10-10-A/B exist.
- Forgotten Lands: 100 monsters, 10 zones, 125 drops; all monster drop IDs, drop sourceMonster IDs, monster zone IDs, dungeon boss/resource IDs, and zone gatekeeper IDs resolve. Drop chances are finite in [0,1], no duplicate drops per monster.
- New equipment catalog contains 64 armor sets; each has exactly five required slots, unique slots, consistent profession and setBonus. All legacy set item references resolve.
- Existing auction validation receives the combined runtime item IDs, preserving legacy IDs. New craft jobs persist a materials snapshot, allowing cancellation even when a recipe later becomes hidden because its output is legacy; if old queue entries lack both stored materials and an active recipe fallback, cancellation fails closed.
- Confirmed integrity gap for follow-up: craftClaim only uses catalog lookup to detect unique-amulet conflicts; unknown job.output still reaches claimCraftJob and is appended to inventory. A safe fix must retain the job on rejection and cover legacy queued outputs, retired recipes, unknown IDs and unique amulets. No production change made yet.
- No player saves were available, so historical craftQueue shape remains unverified. No IDs/data/stats/prices/saves changed; static source/data review only.


## Craft queue output identity hardening — 2026-11-15
- Fixed confirmed gap: claimCraftJob now requires a set of known runtime item IDs and rejects unknown output IDs without modifying inventory or removing the queued job.
- Production craftClaim supplies the complete runtime ITEMS ID set, which includes the original legacy item definitions, current equipment catalog and expedition drops. A known legacy output remains claimable even if its old recipe is no longer in the visible recipe catalogue.
- Added regression test for an unknown output attached to a retired recipe; it verifies inventory and queue remain unchanged. Updated existing claim tests to pass the valid output set.
- No old jobs are migrated/deleted/refunded. Unknown historical outputs remain queued for manual review. Awaiting GitHub Actions on the new HEAD; local tests not run.

## Auction integer-boundary hardening (2026-11-15)
- Review of `server/src/auctionOperations.ts` found that seller currency credit and economy counters (`goldSpent`, `itemsSold`) used unchecked JavaScript number addition. A valid transaction near or beyond `Number.MAX_SAFE_INTEGER`, or a malformed persisted counter, could silently lose integer precision or write an invalid counter.
- Added fail-closed safe-integer/nonnegative validation for currency balances and counters, and checked resulting seller balances before completing a purchase. Existing fee formulas, prices, item transfer order, and normal transaction behavior are unchanged.
- Added regression tests for listing-counter overflow, seller balance overflow, and `itemsSold` overflow; rejected transactions leave the supplied snapshot unchanged.
- Commits: `c703ece7a58405a3593892757b8ce392717da191` (guard) and `e1b8cc84678c7400eb002574743a89ea627ecd1c` (regressions).
- Source/test changes committed through GitHub; local tests were not run. Run Quality Gate on the new HEAD before treating the fix as validated. PR #18 remains Draft/open and unmerged.


## Auction lot identity integrity — 2026-11-15
- Reviewed the production auction handlers and transaction path. Both purchase and withdrawal resolve a lot by its string ID; the previous validator accepted duplicate active IDs, making the selected lot ambiguous and potentially allowing the wrong listing to be acted on.
- Listing IDs are generated from player ID, timestamp, and a random suffix, but the listing operation did not enforce uniqueness against persisted lots.
- Added fail-closed validation for duplicate IDs in the loaded auction snapshot and reject a new listing when its supplied ID is empty or already present.
- Added regression tests proving duplicate persisted IDs block purchase, withdrawal, and listing without changing the input snapshot; a repeated new ID is also rejected atomically.
- No existing auction data was migrated, deleted, or rewritten. If a deployed auction file contains duplicate IDs, auction mutations will stop safely until the data is reviewed; do not auto-select or merge ambiguous lots.
- Commits: `393e304987366fce1d9b6bb8e00bfcc0847ab5e2` (source guard), `c6c8034ae785fbb445f7f398ba97aa74a66efe3d` (regression tests).
- Awaiting GitHub Actions for the new HEAD; local tests were not run. PR #18 remains Draft/open and unmerged.


## Inventory ↔ auction consistency review — 2026-11-15
- Quality Gate run `43758046741` for HEAD `807b69d7cc544ea31c25dd0635ae7a82dc0708d3` completed successfully.
- Reviewed `inventoryOperations.ts`, auction transaction operations, the production `auctionSell/auctionCancel/auctionBuy` handlers, and the inventory/equipment mutation paths in the server.
- Confirmed intended duplicate-item behavior: listing/removing one copy preserves an equipped duplicate; removing the final copy clears the corresponding equipment slot. Purchase and withdrawal check unique amulets against both inventory and equipment. The live auction handlers use the shared atomic transaction path and merge online player state before committing.
- No additional confirmed inventory/auction corruption defect was established in this pass. No game data, balance, inventory, or equipment behavior was changed.
- Follow-up review target: read-only auction list/history loading accepts plain objects at the persistence boundary and should be assessed separately for response-field allowlisting and malformed legacy data presentation. Do not tighten persisted-data validation without checking real legacy compatibility.
- Current branch HEAD remains `807b69d7cc544ea31c25dd0635ae7a82dc0708d3`; PR #18 remains Draft/open/unmerged. No local tests were run.


## Auction read-only response hardening — 2026-11-15
- Confirmed issue: `auctionList`, `auctionHistory` and `marketHistory` sent persisted objects directly to clients. Unknown legacy properties were therefore copied into WebSocket payloads; malformed rows could also reach client rendering and market aggregation.
- Added explicit presentation projections for active lots and transaction history. Only the fields required by the current client are emitted; unknown fields are dropped. Malformed rows, invalid prices/currency/timestamps/fees, duplicate active lot IDs, and inconsistent transaction status/type pairs are omitted from read-only views.
- Preserved valid legacy lot compatibility: missing lot status defaults to active, and missing display names fall back to item ID/empty seller name. This is a read-only filter only; source save/history files are never rewritten or pruned.
- Applied projections to initial list/history requests and to list/history payloads sent after sell, cancel, and buy mutations. Personal history remains scoped to the authenticated player's seller/buyer IDs; public market history remains completed sales only.
- Added regression tests for unknown-property stripping, malformed rows, duplicate lot IDs, status validation, and supported legacy records.
- Commits: `32f8dd98d76bfd92ea92cb619d7e660552ae427b` (projection helpers), `c808d98f1aa51913becf6535d518d50e41b66991` (tests), `ae7b25ac34f68c4016c12a3d55b1042c179901d9` (production handlers).
- No player saves, auction files, balances, item IDs, prices, fee formulas, or game rules were changed. Local tests were not run; await Quality Gate on the final HEAD.

- Added `server/test/auctionPresentation.test.ts` to the explicit `server` test command in `server/package.json`; the regression suite will run in Quality Gate rather than merely existing as an uninvoked test file. Commit: `5c1eeef6b2a924c651753d599e41cb79ab71c18a`.

- Privacy refinement: public `marketHistory` only needs aggregate sale facts for the current client. Added a separate projection that omits seller/buyer IDs and participant names from public analytics while retaining those fields in the authenticated player's own auction history. Added regression coverage. Commits: `10d96e9b2eb94c97acf50a078896af20c794a309`, `e95400d362230d5232898a46d482064310d7c6d4`, `a844aba6fd9ba9e2ca544087b6020e2d9a6c91ca`.


## Economy counter and PvP transfer audit — 2026-11-16
- Mapped current `goldEarned`, `goldSpent`, and `itemsSold` call sites. `itemsSold` is currently an auction-sale count. PvP and auction seller proceeds are transfers of existing gold, not newly generated reward gold; they intentionally do not increment `goldEarned`. Buyer gross auction spend and listing fees remain sinks.
- Confirmed PvP transfer helper accepted negative/fractional/unsafe persisted balances and did not check winner-balance overflow, unlike the auction operations. Hardened `resolvePvpOutcome` to require nonnegative safe-integer balances and reject unsafe resulting balances. The production PvP transaction has rollback-on-error around the helper, so rejected operations restore both player snapshots and do not commit.
- Added regression coverage for malformed/negative/fractional/NaN/Infinity/unsafe balances, winner overflow, and conservation of total gold for valid transfers. Existing 20% transfer formula and immunity behavior are unchanged.
- Remaining finding: multiple non-auction gameplay handlers still use direct `goldEarned +=` / `goldSpent +=`; save loading has no global nonnegative safe-integer rule for every economy field. A blanket migration/validation is deferred until representative privacy-scrubbed legacy saves are available; do not coerce or rewrite deployed counters.
- Full mapping and rationale: `ECONOMY_COUNTER_AUDIT.md`.
- Commits: `cee84b00da9bf7aa47d9a13c406c51b300e49760` (PvP guard), `dfaf57f34634f9ad1ac3fae8efd238a7de2f003e` (tests), `96f9314df03a3261848f0ee06f1304c6d63ab905` (audit report).
- Local tests were not run; Quality Gate required on the resulting HEAD.

- Test review correction: adjusted the two overflow fixtures so the participant receiving the 20% transfer is already near `Number.MAX_SAFE_INTEGER`; this exercises the actual recipient-overflow branch rather than a valid transfer. Commit: `14dfafa41ff69a4af52b62cff0555a48800ac3d6`. Latest HEAD requires its own Quality Gate.


## Reward issuance and currency replay audit — 2026-11-16
- Reviewed one-time claim paths for story/faction chapters, faction max rewards, daily/weekly challenges, race daily claims, ordinary quests, and achievements. Claim flags are checked and set synchronously before reward mutation; existing live-server regression coverage exercises duplicate story/faction/daily/weekly/achievement claims. Daily login uses UTC date gating and has a runtime same-day replay test. Return reward uses its availability flag and seven-day timestamp; fountain uses a same-UTC-day timestamp guard.
- Confirmed replay gap: `openChest` accepted missing `itemId` and missing `expectedCount` even though the client already sends both. A stale/replayed inventory index could open an adjacent stacked chest after the first one was consumed. Added `validateInventoryStackAction()` and made `openChest` require exact item ID, valid index, and positive safe-integer displayed stack count matching current inventory before consuming or rolling any reward.
- Added regression tests for missing/mismatched fields, stale stack count, invalid/fractional/unsafe counts, invalid indices, and replay after consuming one chest from a stack. Chest odds, reward table, currency, and item behavior are unchanged.
- Currency review: one-way `exchangeGem` is bounded to 1..100000 gems and checks balance before conversion; no external payment integration exists. Direct economy counter arithmetic in other gameplay reward handlers remains a separate hardening scope; no blanket legacy save coercion applied.
- Detailed report: `REWARD_ISSUANCE_AUDIT.md`.
- Commits: `47cb3966bb90db85b26c2b1ce43715f2f904a9f4` (snapshot validator), `87452f290b829e1961fc11b81e700a47038a62c9` (openChest handler), `b57c96b759ce7004908603ba617e2722b8b1ffc8` (tests), `ef2174e00bf9ac2989a28dfca55e85c56b5f7e16` (audit report).
- Local tests were not run; Quality Gate required on final HEAD.


## Approved player currency caps — 2026-11-16
- User-approved hard balance limits: gold `9,999,999,999`; crystals `50,000`. Any amount above the remaining capacity burns immediately; no overflow storage or deferred credit. Gems have no new cap in this change.
- Added shared `server/src/currencyOperations.ts` with safe-integer validation and capped-credit results (`credited`, `burned`). Added `server/test/currencyOperations.test.ts` and registered it in the server test command.
- Routed every direct player gold/crystal credit in `server/src/index.ts` through the cap: dungeon/expedition, daily/fountain, race/quest/challenge/achievement/return, tavern, chest, crystal rewards, gem exchange, clan-territory crystal reward, and allowlisted admin grants. Authenticated actions lazily clamp existing safe-integer over-cap balances and persist; no bulk save migration.
- PvP retains the 20% transfer rule, clamps legacy balances, and burns any amount the winner cannot receive. Result payload distinguishes gross stolen, credited and burned gold. Added PvP regressions.
- Auction buyer still pays full price; seller's gold/crystal proceeds are capped and excess burns. Fees and prices unchanged. Added auction regressions.
- `goldEarned` remains a lifetime gross-generated counter; it records generated rewards even if balance overflow burns. No reward amounts, fees, conversion rates, or gameplay formulas changed.
- Added live isolated-server regression for daily gold reward and gem-to-crystal conversion at the caps. Local tests not run; GitHub Actions Quality Gate required.
- Detailed specification: `CURRENCY_CAPS.md`.
- Commits in this stage include `2154571` currency helper, `153ce79` helper tests, `5be86be` gameplay credit integration, `2e26829` auction cap, `b466b10` PvP cap, `b8a6dee` combat settlement display, `c78178e` auction notice, `02dd013` legacy balance clamp, `50dcc0d` runtime test, and `a2dac79` cap specification.

- Follow-up boundary refinement: legacy balances are clamped when finite and above the cap even if the stored number is outside JavaScript's safe-integer range; non-finite/negative balances and fractional in-cap balances still fail closed. PvP and auction balance readers use the same normalization. Added regressions for unsafe finite over-cap legacy values. Details updated in `CURRENCY_CAPS.md`.

## Контрольная точка — 2026-11-16 (валютные лимиты / CI correction)

- Утверждённые лимиты: золото 9,999,999,999; кристаллы 50,000. Излишек при начислении сгорает. Самоцветы не ограничены этим изменением.
- CI Quality Gate run 43763284070 на HEAD 94628e7 завершился failure: 434/437 server tests passed; client build, Playwright и data/docs jobs passed.
- Подтверждённые причины трёх ошибок:
  1. PvP legacy-cap tests ожидали 80/120 золота, что не соответствовало утверждённой 20%-ной передаче от проигравшего после нормализации его баланса до лимита. Обновлены только ожидания тестов: проигравший с 10,000,000,000 нормализуется до 9,999,999,999, отдаёт 1,999,999,999, остаток 8,000,000,000; получатель получает эту сумму в рамках своего лимита. Добавлена явная проверка gross/credited/burned значений и аналогичного сценария с unsafe legacy balance.
  2. Auction read projection сохранял первую запись при повторяющемся lot ID, хотя безопасное поведение — исключать все неоднозначные дубликаты. Исправлен projectAuctionLots: предварительный подсчёт ID, все записи с повторяющимся ID исключаются. Существующий regression test покрывает duplicate ID.
- Commits после неуспешного CI:
  - 030f8aae209e69c214f8febcb0bfa1e684e21f56 — исключать все неоднозначные дубликаты из read-only auction projection.
  - 362c136f43069fecb72cde99e9ce4f638ec08b10 — привести PvP legacy-cap test assertions к фактическому правилу 20%-ного перевода после cap.
- Следующий HEAD проверить через PR #18 / branch; запущенный на него Quality Gate обязателен. Локальные тесты не запускались. Не считать исправление подтверждённым до CI.
- PR #18 остаётся Draft/open, merged=false. Не сливать без отдельного разрешения.


## Currency transaction hardening and auction typecheck correction — 2026-11-16

- Quality Gate run 43763965444 on HEAD d7308dc failed at the server TypeScript compile step. All 437 server tests passed; client build, Playwright, and data/docs jobs passed. Compiler identified that validated auction presentation values had widened to `string` rather than the declared literal unions.
- Fixed `projectAuctionLots` and `projectAuctionHistory` to preserve the validated currency/status literal-union types. Commit: `0232d1e688612d3f3c1f5e9c955d75f1a5f01e36`.
- Extended the currency audit beyond credit paths. Confirmed that `exchangeGem` debited gems before validating the crystal balance; because the authenticated message wrapper does not roll back arbitrary in-memory handler mutations on thrown exceptions, a malformed legacy crystal balance could leave a partial debit in the live Player snapshot.
- Added pure `prepareGemExchange`: it validates the gem balance and computes the capped crystal credit before either balance is assigned. The handler now commits both prepared balances only after validation succeeds, and the response reports crystals actually credited plus burned overflow. Exchange rate remains 1 gem → 10 crystals; existing request amount bounds remain unchanged.
- Added `preparePlayerCurrencyBalances` and integrated it into `requireCharacter`. Every character-gated gameplay action now rejects negative, fractional, non-finite, or unsafe in-cap gold/crystal balances and invalid gem balances before entering its handler. Finite over-cap legacy gold/crystal balances are still lazily clamped to the approved caps and saved; no bulk migration or save rewrite was introduced. This also protects direct currency spending paths from malformed legacy snapshots.
- Added regression tests for atomic gem exchange preparation, invalid crystal/gem balances, burned crystal overflow, legacy cap normalization, and malformed balance rejection.
- Commits: `62497c415baed43ad6114fe27c28f5c36d9a1528`, `3f516abf7a601fa9d5a0c9a7f8f91913222c77ec`, `fffdacdeb0ddb3380e9ddae7f89f383242c8e285`, `f7bc3a7cb067a75633355277d1ba42bad12a7b39`, `63b9eea0ce65b82a327097d2bfcd3c2b50a39db7`, `7a26e579aa20873c157e8ec34c5b835e3ed0cba1`.
- Quality Gate runs 43764923020 (push) and 43764921963 (pull_request) are pending/in progress for the evolving branch; final validation must use the final HEAD after all commits. Local tests were not run.
- PR #18 remains Draft/open/unmerged. No changes to `main`, game balance formulas, or existing save files.

- Follow-up type-safety cleanup: changed the gem exchange handler to use a narrowed prepared-result value instead of an evolving `any` variable. Commit: `d6c43c2c3f7ed8eb099801644d520095ec431042`.
- Final branch HEAD for this package: `d6c43c2c3f7ed8eb099801644d520095ec431042`. Quality Gate runs 43764998454 (push) and 43764993063 (pull_request) are queued/pending for this exact HEAD; prior runs were cancelled by subsequent commits and are not validation for the final HEAD.


## Currency handler coverage and gem integer-boundary hardening — 2026-11-16

- Re-audited all authenticated message handlers in `server/src/index.ts` against `requireCharacter`. All handlers that mutate player currency or execute player economy transactions are character-gated and therefore run the shared balance preflight before handler logic.
- The non-gated handlers found in this pass are read-only projections/history/catalog/state endpoints, clan-wide state maintenance that does not debit or credit the player's wallet, and first-time `createCharacter` initialization. No currency-mutating gameplay handler bypass was found in the inspected registry.
- Found one remaining numeric-boundary issue in the privileged admin grant path: gem balances are intentionally uncapped, but `p.gems += amount` could exceed JavaScript's safe-integer range and silently lose integer precision.
- Added pure `prepareGemCredit`: validates the current uncapped gem balance and requested amount as nonnegative safe integers, calculates the result before mutation, and rejects any sum outside the safe-integer range. Admin gem grants now fail closed without changing the balance when the sum is unsafe. No gem cap was introduced.
- Added regression coverage for valid credits, exact `Number.MAX_SAFE_INTEGER` boundary, overflow, invalid balances, and invalid amounts.
- Commits: `7eb7875be7c5c5d89d11a4a3c6ddc8af26d20371` (helper), `c04682de83f038be3e80bd3608a1336c11ee2c83` (tests), `069e0bbb3e1d10509c81303dba88f0b5958afa78` (admin integration).
- Local tests were not run. A fresh full Quality Gate for the final branch HEAD is required before treating this change as validated.
- PR #18 remains Draft/open/unmerged. No main-branch changes, save migration, or balance cap changes.


## Clan treasury transaction hardening — 2026-11-16

- Reviewed clan donation, raid rewards, upgrades, territory capture, clan quest claims and weekly season rewards, plus PvP multi-player settlement.
- PvP settlement is already performed inside the shared player-state transaction: both participants' balances, cooldown/immunity state, counters and combat report are prepared and persisted together; online target state is synchronized only after commit, with rollback/reconciliation on failure.
- Found that clan vault arithmetic used unchecked `+=`, `-=` and numeric coercion. Malformed legacy values or arithmetic beyond JavaScript's safe-integer range could silently corrupt treasury balances or produce imprecise results.
- Added `prepareClanVaultCredit` and `prepareClanVaultDebit`. Clan vaults remain uncapped; all credits/debits now require exact nonnegative safe-integer arithmetic and reject overflow, malformed balances and insufficient funds before durable commit.
- Routed donation, raid proceeds, upgrade purchases, territory capture costs, clan quest rewards and weekly season rewards through the helpers. No reward, cost, cooldown, territory or progression formula changed.
- Added regression tests for exact safe-integer boundaries, uncapped valid balances, invalid legacy values and insufficient funds.
- Commits: `d1a3b560a26d074247da7f1f37bda050e1bae82e` (helpers), `5b7f61cf56093f05a554eff3c886ad81b0a2d6ea` (tests), `e76b2d54dd5b34018b8e8fd9c08262ac7cc8d2a7` (all handler integrations).
- Local tests not run. Fresh full Quality Gate for the final branch HEAD is required.
- PR #18 remains Draft/open/unmerged; no main changes or save migration.


## Clan war settlement and counter overflow audit — 2026-11-16

- Checked the latest CI for previous checkpoint HEAD `aefb3f0dc4ca25f6d087a12f6f8fcec9828e6723`: run `43771535302` was still in progress at audit start.
- Reviewed war challenge, attack, cooldown, expiry settlement, tie handling, disband cancellation, season points, war quest progress, and the clan transaction write-ahead journal.
- Found a remaining bypass of the treasury hardening: `settleExpiredClanWars` credited the winning clan vault with unchecked arithmetic. This could bypass `prepareClanVaultCredit` and silently exceed safe integer precision. Season points and war quest progress were also unchecked.
- Found clan war damage accumulation accepted malformed persisted damage and could exceed safe integer precision.
- Fixed settlement to use the shared safe clan-vault credit helper; season points, war quest progress and accumulated damage now require exact nonnegative safe-integer arithmetic. Calculations happen on cloned settlement state, so a rejected settlement does not partially mutate the source state.
- Added regression tests for treasury overflow during war settlement, malformed/overflowing damage counters, and no source-state mutation after rejected settlement.
- Existing war behavior preserved: 24-hour duration, per-player cooldown, damage formula, winner/tie outcome, reward formula, season +20 and quest progress +1.
- Commits: `56ed72e412fecc9c45ed73c42875eec3b80e3509` (hardening), `9b87fbaf02e59e653de3b0a2ffd0e899bb0e4e8d` (tests).
- Local tests not run. New full Quality Gate required for final HEAD.
- PR #18 remains Draft/open/unmerged; no main changes or save migration.


## Clan war persisted-record validation — 2026-11-16

- Continued review of concurrent attack handling, repeat settlement, clan war runtime behavior, and shared-state journal recovery.
- Confirmed war settlement is guarded by the active-to-finished status transition; subsequent settlement passes do not issue the reward again. Clan mutations are serialized through the synchronous shared-state transaction coordinator in the single-server-process model.
- Found malformed persisted war fields were previously coerced during settlement: invalid/negative/fractional/unsafe damage counters could be treated as zero or influence winner selection; malformed end timestamps could also be coerced.
- Fixed settlement to validate the settlement clock, active-war end timestamp, and both damage counters as nonnegative safe integers before changing cloned war/clan state or issuing rewards. Invalid records now fail closed and leave source objects untouched.
- Added regression tests for malformed damage values, malformed end timestamps, and no partial mutation on rejection.
- Existing war scoring, duration, cooldown, reward formula and replay behavior unchanged.
- Commits: `593c0fdf3f79bb441b60a41eb7bba4f756269165` (validation), `6a21ad8aea6e5964aff2eac5ee0ce1dc3f7739ae` (tests).
- Local tests not run. CI for previous HEAD was in progress during this stage; full Quality Gate for final HEAD is required.
- PR #18 remains Draft/open/unmerged; no main changes or save migration.


## Clan war cooldown and concurrency boundary audit — 2026-11-16

- Rechecked PR #18 and Quality Gate on HEAD `895702223c4f2c52771174c8e860ce8f59d311cb`: run `43771732019` was still in progress when this stage began.
- Traced clan war challenge, attack, list/expiry settlement and disband paths. All production mutations use the synchronous shared-state WAL coordinator. In the current single-server-process architecture, handlers do not interleave inside a synchronous transaction callback; two simultaneous requests are serialized by the event loop and transaction coordinator. This is not a multi-process distributed lock.
- Found cooldown timestamps were coerced with `Number(value || 0)`; malformed persisted values (fractional, negative, string, NaN, unsafe) could be treated as no cooldown and allow an attack.
- Fixed cooldown evaluation and attack recording to require nonnegative safe-integer clocks/durations and positive safe-integer persisted timestamps. Invalid legacy timestamps now fail closed before damage or cooldown state is changed.
- Added regression tests for malformed timestamps, invalid clock/duration, attack bypass prevention, and source-state immutability.
- Existing one-second cooldown and damage/reward formulas unchanged.
- Commits: `7f0008461394ac558f07d8b4cc56eb3437b8f415` (validation), `ee1da5036a9ae7a02330d4b8883fe397f81aac49` (tests).
- Local tests not run. CI must validate final HEAD. PR #18 remains Draft/open/unmerged; no main changes or save migration.


## Clan progression counter hardening — 2026-11-16

- Rechecked PR #18 at HEAD `a05241caede461befd8452fe51c0437f37452b2a`; Quality Gate run `43771841340` was still in progress at the start of this stage.
- Audited all direct production increments of clan XP, season points, donation/raid/territory quest progress and member contribution.
- Found these uncapped persisted counters used unchecked arithmetic. Malformed legacy values or overflow could produce fractional, non-finite or unsafe values and then be committed with clan/player state.
- Added `prepareClanProgressCredit` to validate nonnegative safe-integer balances, increments and sums without introducing a cap.
- Applied validation to clan donations, raid rewards, territory capture, clan quest rewards, and member contribution. Existing progression amounts, level-up formulas, reward amounts and caps are unchanged.
- Added helper regression tests for valid boundaries, malformed balances/increments and overflow.
- Commits: `9191f3d3971b1c290ccf78a3453fefd10fe7de0e`, `3bc94cb89d3f7481fb516ccf9f7bd946d612ea6f`, `502ef80957ff65d8e332eb362404f074ab5dbb86`.
- Local tests not run. Full Quality Gate required on final HEAD. PR #18 remains Draft/open/unmerged; no main changes or save migration.


## Clan and territory save integrity follow-up (2026-11-16)
- Previous HEAD `60cb217f09cbb9e5ee73095bc183a7ae990dd8b7` passed Quality Gate run `43772044264` (all 4/4 jobs successful).
- Added strict, read-only validation for persisted clan records: key/id consistency, nonempty identity, level range, nonnegative safe-integer counters, nonempty unique member roster, leader membership, and upgrade levels 0–5. Duplicate player membership across separate clans is rejected.
- Added territory validation for known territory IDs, unique records, valid counters, and owner references to an existing clan. Corrupt or ambiguous saves now fail closed rather than falling back to defaults or silently losing ownership.
- Optional legacy counters/upgrades may remain absent; no save migration or automatic repair is performed. Existing clan progression, rewards, and formulas are unchanged.
- Added focused regression tests and included them in the server test command.
- Source review found clan leave can still clear an orphaned player clan reference when the clan record itself is missing; that behavior is separate from validated clan/territory store loading and should be reviewed with save reconciliation semantics before changing it.
- Local tests were not run. Full Quality Gate is required for the final HEAD.


## Clan-save validation compatibility correction (2026-11-16)
- Quality Gate run `43773785466` on `eae29d9efb4b63dfd901786973ecfa33162fe7da` failed one existing clan-war runtime test; 452/453 server tests passed, client build and Playwright smoke passed.
- Root cause: strict clan loader rejected a legacy fixture clan without a persisted `leader` field, and strict territory loader rejected the fixture's noncanonical territory ID. This was an integration-compatibility defect in the new validator, not a clan-war combat failure.
- Corrected validation to preserve legacy leaderless clan records while still requiring any present leader to be a member; updated the runtime fixture to use canonical territory `crossroads`; added a leaderless-legacy regression case.
- Latest corrected source HEAD at this note: `5bfc7c98ca275c2893664e6db84c63115773783f`. Quality Gate run `43776634500` is in progress; final result pending. Local tests not run.
- Clan war source review: challenge creation is leader-only; attacks require actual membership and active participation; settlement is idempotent via active-to-finished status. Remaining follow-up: validate persisted war record identities and cross-references before any settlement.


## Clan-war persisted identity and cross-reference validation — 2026-11-16

- Rechecked PR #18: exact pre-stage HEAD `d50ddae98b35a0a960ef4347357dce51cc8956db`, Draft/open/unmerged. Quality Gate run `43776680381` completed successfully on that exact HEAD (4/4 jobs).
- Found that `loadWars()` accepted any array of plain objects. Persisted duplicate/empty war IDs, invalid statuses, same-clan pairings, malformed timestamps/damage/reward fields, invalid cooldown maps, and active wars referencing missing clans could therefore reach challenge, attack, listing, or expiry settlement logic.
- Added `validateClanWarStore` and wired it into the production war loader. It validates unique stable IDs, distinct clan IDs, supported statuses, safe nonnegative timestamps/counters, optional winner/name/reward fields, and cooldown-map timestamps. Active wars must reference two existing clans.
- Compatibility preserved: legacy optional damage/creation/cooldown fields may be absent; finished/cancelled historical wars may retain references to clans that were later disbanded. No save rewrite, migration, automatic repair, or historical deletion.
- Added regression tests for valid and legacy records, duplicate IDs, invalid status/identity, orphaned active references, malformed counters/timestamps/cooldowns, and historical records after clan disband.
- Production game rules, war duration, damage, cooldown, rewards, and settlement behavior are unchanged.
- Changes: `9e65d797b65bd8146a971446ae39d30afa821790` (validator), `443786591a1d9a082c5c7ad234dc9a951bc1b34a` (tests), `e8f55c5a83e87eb4cd6c6d1e99275a1579e95a49` (loader), `0649afb944ee51bd1af8bcf0a42f93a6a2c47026` (import wiring).
- Local tests were not run. Full Quality Gate is required on the final checkpoint/PR HEAD.
- PR #18 remains Draft/open/unmerged. No `main` changes or save migration.


## Player-to-clan roster consistency — 2026-11-16

- Rechecked PR #18 at HEAD `3bdb53254393c5f41eb1938c201a0c495baf1ed0`; PR remains Draft/open/unmerged. CI runs `43778593185` (pending) and `43778589172` (in progress) were still unresolved at the start of this stage.
- Found that clan creation/join checked only the saved `player.clan` field. If it was empty while the player ID remained in an existing clan roster, the same player could create/join another clan and produce a cross-file membership contradiction.
- Added `findPlayerClanMembership` and guarded both clan creation and joining against existing roster membership, independently of `player.clan`. Existing saves are not rewritten or auto-repaired; conflicting records fail closed for new membership actions.
- Added regression coverage for finding roster membership by player ID, including no-match and empty-ID cases.
- Existing clan leave/disband behavior, rewards, progression, and save schema are unchanged. No bulk migration, no main changes, no PR merge.
- Commits: `eb8ec385b8b0615ade90f5aadf9d40851f0ac2e1` (lookup), `8acfdc593f32ee3b1d4c9988d11f649480d99878` (tests), `b7b01c1e3a260c58a409cc55b651992fb8a85332` (handler guards).
- Local tests were not run. Quality Gate must be checked on the final PR HEAD.


## Clan leave recovery for stale player references — 2026-11-16

- Follow-up review found a dead-end introduced by the roster-based duplicate-membership guard: when a player's `clan` field was blank/stale but the player still appeared in a clan roster, create/join correctly blocked duplicate membership, while leave still consulted only `player.clan`.
- Added `resolvePlayerClanForLeave`: the actual clan roster is authoritative when it contains the player; the saved player field remains a fallback for legacy orphan cleanup.
- Updated `clanLeave` to resolve the real roster first, then apply the existing leader restriction, remove the player, and preserve existing last-member disband/war/territory behavior.
- Added tests for blank and mismatched player clan fields, and fallback behavior when the player is not in any roster.
- No leader-transfer/kick endpoint exists in the current server handler set; no new gameplay feature was invented. Existing transaction WAL/recovery behavior unchanged.
- Commits: `ec69db3afb7f8ddaef75763e3ed952ae726e7c4c` (resolver), `cab12c35299810e4787b97391bf616c523a49172` (tests), `fa829b77ca873257dcb37ebf9e9689764f38e21b` (leave handler).
- Local tests not run; final-head CI required. No save migration, no main changes, PR remains unmerged.


## Clan roster authority across gameplay and client UI — 2026-11-16
- Rechecked PR #18 at pre-stage HEAD `0ba6217a73ff892d88fe05f7b3c68314f238371d`; Quality Gate run `43779350476` completed successfully on that exact HEAD (4/4 jobs). PR remains Draft/open/unmerged.
- Extended the roster-authoritative membership rule beyond leave: donations, raids, upgrades, territory capture, clan quest claims, season rewards, war challenges, war attacks, and clan quest-state projection now resolve the acting player's clan from the persisted clan roster instead of trusting a stale `player.clan` pointer.
- Found the corresponding client dead-end: the clan screen selected the player's clan only from `player.clan`, so a stale pointer hid the clan panel and its leave button. The `clanList` response now includes the authenticated player's roster-derived `myClanId`, and the client renders the panel from that value.
- Create/join continue to reject any existing roster membership; leave continues to prioritize roster membership with saved-field fallback only for orphan cleanup. Existing leader permissions and game formulas are unchanged.
- Commits: `29c470b0826f9b08fba9bbfad16596efedcb29cc`, `0710a84301adf82ec81718bbfc3ed73ecf23d351`, `aadb98e10d3e3e7afeb3a1d741789d43ee0e421b`, `084f614f34daf1b59f000da31f334739b79c8140`.
- Existing helper regression tests cover roster lookup and leave resolution. No new dedicated end-to-end stale-pointer runtime test was added in this pass. Local tests were not run; Quality Gate is pending for the evolving final HEAD.
- No save migration, automatic repair, balance change, `main` change, or PR merge.


## Player backup amplification during WAL replay — 2026-11-16
- Rechecked PR #18 exact HEAD `f69153fd0052cfc6647871039397b843c350e8d1`; runs `43780235860` and `43780228849` were both still in progress. PR remains Draft/open/unmerged.
- Fixed a confirmed retry-amplification issue in the shared WAL player backup path: after a transaction had already replaced `players.json` but a later target failed, each recovery retry backed up the already-applied new snapshot again. Repeated failures could grow backups without bound.
- Player backup creation now compares the current JSON snapshot with the journal target and skips creating another backup when that target is already applied. Unreadable existing player bytes are still backed up before replacement. The original pre-transaction snapshot remains preserved.
- Added a regression test that blocks a later target, forces repeated WAL recovery failures, verifies the backup count stays at one, then unblocks recovery and checks the final snapshots and original backup.
- Commits: `85f4ac494ebd97d8e2bd5e282f6da347b2cd0f6b` (implementation), `890e8d0c2f01f4329f62388185e2bfdbe02edf0e` (test).
- Local tests were not run. Full Quality Gate is required on the new final HEAD. No save migration, automatic restore, balance change, `main` change, or PR merge.


## Full shared WAL target-boundary crash matrix — 2026-11-16
- Rechecked PR #18 before work: HEAD `b3a6ad7343e90fe840749f759ea7c79bda7a8344`; runs `43780523990` and `43780518731` were still in progress. PR remains Draft/open/unmerged.
- Added a child-process crash/restart regression for every configured shared WAL target boundary in deterministic apply order: players, auction, auction history, clans, wars, territories, mining, hunt groups, dungeon runs, dungeon outbox, accounts, sessions, and guest credentials.
- Each case terminates the writer immediately after one target is applied, verifies the journal remains, starts a fresh store, replays the complete transaction, checks every configured target against the exact committed snapshot, confirms journal removal, and confirms a second recovery is a no-op.
- Expanded the shared-state test fixture to configure mining and dungeon outbox, which were previously absent from its file map.
- Test-only change; no production logic changed in this stage. The previous stage's WAL backup retry fix remains in place.
- Commit: `23c0c642dcae214485020ed91723d0e68bee8f54`.
- Local tests were not run. Await fresh Quality Gate on the new final HEAD. No save migration, auto-restore, balance change, `main` change, or PR merge.


## WAL finalization crash boundaries — 2026-11-16
- Rechecked PR #18 before work: HEAD `2c93b6c89df46378d6666a3df2d6474ea586edaa`; runs `43780645980` and `43780639461` were both in progress. PR remains Draft/open/unmerged.
- Added test-only hooks for the two finalization boundaries: immediately after journal unlink and immediately after the final data-directory sync.
- Added child-process crash/restart tests at both boundaries. They verify the journal has been removed only after all targets are applied, all representative player/auction/dungeon-outbox/session snapshots are complete, and restart does not replay a removed journal.
- This validates process-crash ordering, not sudden power-loss persistence guarantees on every filesystem/device. Windows continues to skip directory fsync because Node cannot reliably open directory handles there; transaction file contents are still fsynced.
- Commits: `991421cbfdc702e31b64b8b59518ee0bf65e54b3` (test hooks), `7da218deed7f674a33f32a58a846af881892fb9e` (tests).
- Local tests were not run. Fresh Quality Gate required on the new final HEAD. No migration, auto-restore, balance change, `main` change, or PR merge.


## Legacy save migration and WAL finalization follow-up — 2026-11-16
- Rechecked PR #18 at pre-stage HEAD `f50dc4ef1337fa8dd8d71fead02b4a350eb06b0a`; PR remains Draft/open/unmerged. Quality Gate run `43780783664` failed the server suite (459/461): the backup-amplification test used an over-escaped regex and the clan-war runtime test intermittently timed out waiting for the first nonmember rejection. Client build, browser smoke and data/docs jobs passed. The second failure is retained as a flaky-runtime item pending rerun; no gameplay behavior was changed to hide it.
- Audited the actual join-time legacy city migration. Reputation migration previously coerced arbitrary values through `Number(value || 0)` and deleted the legacy key; malformed strings could become `NaN` and then JSON `null`, while negative/ambiguous values were normalized without evidence. Visited-city migration treated any truthy value, including string `"false"`, as a confirmed visit.
- Added pure loss-preserving transforms in `server/src/playerSaveMigrations.ts`: only finite nonnegative numeric reputation values migrate; malformed/negative values remain in place; visited flags migrate only when exactly boolean `true`; input snapshots are not mutated. Wired into the existing join-time normalizer and added regression tests to the server test script. Supported city aliases and valid migration behavior remain unchanged.
- No broad player schema versioning, range caps, race/profession coercion, or automatic repair was added. Repository history and tracked files still do not contain representative deployed player saves; runtime save files are gitignored. Broad migrations remain blocked on a privacy-scrubbed legacy-save corpus and explicit compatibility evidence.
- Fixed WAL transaction error handling: after journal unlink, failure of the final data-directory fsync previously could be swallowed because recovery saw no journal and returned `false`. The transaction now throws an explicit durability-uncertain error if journal removal occurred but the final directory sync did not complete. Added a regression test for that exact failure boundary.
- Corrected the over-escaped backup filename regex in the existing WAL backup-retry regression test.
- Commits in this stage: `a0300f038aad02cd604c4dcf5d9fd7c43b6aeb62` (WAL durability error), `fd331633dfed9ee192505dc64cd78a556f59fb28` (WAL regression + regex correction), `7fdffb5ecf251d8aed38250d72a97e698a715405` (migration helpers), `be6ff51877c47d42457a91cb682512368d9a1091` (migration tests), `fd6c5ed94ed763aed56a17a1069825426392640b` (join wiring), `f50dc4ef1337fa8dd8d71fead02b4a350eb06b0a` (test script).
- Local tests not run. Fresh Quality Gate required on the new exact HEAD. No main changes, no PR merge, and no changes to live save files.


## Legacy inventory and progression reference preservation — 2026-11-16
- Audited player hydration, schema fields, profession normalization, inventory/equipment operations, and craft claim behavior. Generic save hydration preserves serialized inventory, equipment, craft queue, achievements, and profession labels; it does not filter unknown item/recipe IDs against the current catalog.
- Unknown/retired inventory IDs and queued craft outputs therefore remain in the save. Current handlers may not expose normal actions for an unknown item; craft claim explicitly rejects unknown outputs and retains the job for manual review. This is preferable to silent deletion. No automatic item aliasing/deletion policy was added.
- Added a regression in `server/test/playerSaves.test.ts` proving unknown inventory IDs, queued outputs, achievement keys, and historical profession labels survive hydration unchanged.
- Only the documented legacy profession alias `Воин` maps to `Рыцарь`; other historical labels are preserved rather than coerced based on race. Broad race/profession repair requires sanitized deployed-save examples and explicit compatibility rules.
- Quality Gate `43783068961` failed on prior exact HEAD `5e1acb310b1860f36a29ca448a8664549058013c`: 464/465 server tests passed. Sole failure: intermittent clan-war runtime test timeout waiting for nonmember rejection of `clanDonate`. The latest WAL and migration regressions passed in that run; client build, Playwright smoke, and data/docs jobs passed. No behavior was changed to hide the intermittent failure.
- New regression commit: `a63e67718c88cfb70832d4a3705f3ac6bc6ac549`. Local tests not run; fresh CI required for the current HEAD. PR #18 remains Draft/open/unmerged; no main changes.


## Equipment slot integrity audit — 2026-11-16
- Rechecked PR #18 exact HEAD `d164e6fabf35472823b11c55d340f51852ea3ec9`; Quality Gate `43783700326` failed the server suite on the known intermittent `clanWarRuntime.test.ts` timeout waiting for nonmember `clanDonate` rejection. Client build, browser smoke (3/3), and data/docs validation passed. Server build was skipped after the test failure.
- Audited `equipment` save hydration, catalog assignments, equip/unequip/enhancement handlers, and combat equipment lookup. The serialized equipment field is preserved as a string during generic save hydration; no migration or catalog-based filtering is performed on join.
- The current 387-entry equipment catalog has canonical slots only: weapon, five armor slots, and amulet. Found that `equipItem` trusted arbitrary `item.slot` values and wrote them directly into the equipment object. Added `server/src/equipmentIntegrity.ts` to strictly resolve allowed slots by item kind; malformed catalog entries are rejected before mutating player state.
- Added tests in `server/test/inventoryOperations.test.ts` for canonical slots, legacy armor fallback, mismatches, unknown/prototype-sensitive slots, and preservation of an existing legacy equipment snapshot.
- Existing saved equipment is not repaired or stripped. Unknown/retired IDs remain in the save; no claim is made that retired item stats can still be calculated if their definitions are absent from the current catalog.
- No balance/catalog/save migration changes. Local tests not run. PR #18 remains Draft/open/unmerged; `main` untouched.


## Race/profession equipment compatibility — 2026-11-16
- On previous HEAD `85f17f0c950bb73382a4109de1ee2b811b129002`, Quality Gate `43784964594` had client build, Playwright smoke and data/docs jobs passed; server transaction tests/build remained in progress at audit time.
- Reviewed `equipItem`, `buyItem`, `shopCatalogForPlayer`, profession profiles, and the full 387-entry equipment catalog. All 41 explicitly race-bound catalog items correctly map Bird Assassin gear to the Bird race; 287 profession-bound items omit a race field and depend on player race/profession validation.
- Found that shop/purchase/equip checks matched the required profession string but did not independently confirm that the profession is available to the player's race. Added `canEquipProfessionItem()` using the canonical race-profession map; wired into shop visibility, buying, and equipping. Historical `Воин` normalizes to `Рыцарь`; Bird Assassin remains a distinct allowed profession.
- Added tests for valid race/class pairs, active subclass, cross-race mismatch, unknown profession, unrestricted gear and legacy alias. Existing saved equipment remains untouched and no automatic retroactive compatibility stripping was added.
- No game balance or catalog changes. Local tests not run. New final HEAD requires complete Quality Gate.


## Equipment combat and set-bonus audit — 2026-11-16
- Rechecked PR #18 at exact HEAD `6cadf0677c19f9e0eebc5b01e34217e955784755`. Quality Gate run `43785383974` completed with failure: server suite 468/469, one failure in `clanWarRuntime.test.ts` waiting for the nonmember `clanDonate` rejection. Client build, data/docs/structure, and Playwright passed; server compile was skipped after test failure. This is the same recurring timeout seen in earlier runs, not an equipment/PvP test failure.
- Audited `resolvePlayerMonsterStats()`, the live PvP handler, ordinary expedition/hunt, synchronous dungeon, `pvpCombat.ts`, `monsterCombatStats.ts`, `monsterBattle.ts`, and the associated regression tests.
- PvP formula is intentionally a separate legacy rating calculation. It reads weapon/armor base attack/defense, their enhancement levels, slot-specific rare attack/defense/crit properties, the three-slot legacy set resolver, profession coefficients, buffs and random rolls. Existing tests explicitly assert that the five armor slots, catalog-only attributes/combatStats, and amulet effects do not alter PvP rating. These constraints were preserved.
- The current armor catalog has 64 five-piece sets. Structural tests validate five distinct armor slots, profession consistency, descriptions and item identity. Runtime tier descriptions are converted into typed combat effects. The newer `resolveMonsterBattle()` engine supports these typed channels, but production `server/src/index.ts` does not call that engine; legacy expedition and dungeon still use their separate attack/defense simulation and selectively consume typed channels such as accuracy, evasion, healing, loot and lifesteal.
- Found an integration boundary worth tracking: `applyFivePieceSetBonus` is passed as a resolver option (true for ordinary expedition, false for dungeon) but is not read by `calculatePlayerMonsterCombatStats()`. Also, typed set effects do not automatically rewrite the legacy attack/defense totals. I did not change this: wiring those modifiers into live damage/defense or replacing the legacy resolver would alter combat balance and requires an explicit design decision. The option name must not be treated as proof of an active behavioral difference.
- No production combat code, coefficients, RNG order, item stats, set descriptions, or reward rules changed. Local tests not run. PR #18 remains Draft/open/unmerged; `main` untouched.
- Next design task, not an autonomous balance change: decide the authoritative combat engine and the exact mapping of each equipment/set channel into hunt, dungeon and PvP. Keep legacy compatibility until that decision is approved.


## Equipment effect-channel coverage audit — 2026-11-16
- Rechecked PR #18 at code HEAD `690e47b3eb300337652fbeef904c791fb307c1b1`. Quality Gate `43791615786` had client build, Playwright and data/docs completed successfully; server transaction tests were still running at audit time. Do not call the run green until the server job completes.
- Catalog snapshot: 387 items; 376 have a non-empty `effects` field, 336 have structured `combatStats`; 239 descriptions are meaningful rather than `Нет`. Of those 239, 199 also have structured combatStats; 40 are legacy armor entries with effect descriptions but no combatStats. Their effects are routed through the armor description parser in the legacy player-stat resolver.
- Parser coverage is intentionally conservative: known descriptions map to typed targets (e.g. magic/physical damage, HP, crit, accuracy, evasion, resistance, healing, loot, production, gold). Several legitimate-looking legacy descriptions currently have no typed target: energy regeneration, astral effect strength, single-target damage, boss resilience, ally recovery, group effect strength, ranged damage, rare-monster damage, and mine efficiency. Semicolon-compound descriptions are rejected as a whole by the parser rather than partially guessed. Some are non-combat/economy effects; the remainder require explicit design mapping before implementation.
- Structured `combatStats` coverage does not imply every channel is consumed by every live combat mode. Legacy hunt/dungeon handlers select only a subset of typed modifiers, while the newer typed engine is not called from production `index.ts`. PvP remains a separately characterized formula. No new damage/defense behavior was introduced.
- No code/catalog/balance changes in this stage. No local tests run. Follow-up: approve a canonical target/mode mapping for the currently unmapped legacy descriptions, then add parser and runtime tests before wiring any new combat behavior.


## Equipment stat runtime coverage — 2026-11-16
- Latest exact code HEAD reviewed: `ce11e8a4e8e1da4bf9d067ea9c1d9565431d3ded`; PR #18 remains Draft/open/unmerged, base `stage29/clean-validation-recovery`, branch `staging/local-isolated-launcher`; `main` untouched.
- Runtime trace confirms the new typed monster engine is not used by production `index.ts`. Legacy hunt/dungeon currently consume a selected subset (accuracy, evasion, healing, loot, lifesteal) alongside legacy attack/defense and profession/passive rules. Crit, crit damage, item resistance/control resistance, typed damage channels, attack speed and boss damage are not generally wired into these legacy paths. Arena PvP intentionally retains its separate legacy rating contract.
- Concrete unimplemented advertised modifier: `LEG-МАГ-2` and `LEG-ВОИ-1` describe +10% max HP; parser recognizes the percentage as typed health, but `effectiveMaxHealth()` does not consume parsed description health. Current calculation uses flat armor health, structured `combatStats.health`, and pendant health. Do not activate until intended stacking with those existing values is confirmed; changing it affects HP and balance.
- No code or balance change in this stage. Preserve current legacy saves and combat behavior until the canonical mode/channel mapping is approved. CI run `43791927657`: 468/469 server tests; recurring nonmember `clanDonate` timeout in `clanWarRuntime.test.ts`; client, Playwright, data/docs passed; gate failed.


## Current work log / continuation point — 2026-11-16
- Task: investigate repeated `clanWarRuntime.test.ts` timeout and keep the project audit journal current.
- Exact starting HEAD: `e3dec2679a7cd8c149a182e3adfa796ccb2f974b`; Quality Gate `43797490206` had one failed server job (468/469 tests), other three jobs passed.
- Root cause: stale assertion in `server/test/clanWarRuntime.test.ts`. The deliberately non-rostered player still has a legacy `player.clan` pointer. Roster-authoritative membership lookup correctly treats them as a nonmember and `clanDonate` responds `Сначала вступи в клан.`; test expected obsolete `Персонаж не состоит в этом клане.` and timed out.
- Changed only `server/test/clanWarRuntime.test.ts`: nonmember action loop accepts either established rejection text and still requires a new notice per action. Existing disk assertions continue to prove no player currency or clan treasury/reward mutation. No production code, save schema, balance or `main` changes.
- Test commit: `4fd4b96fd1807a8b80a101adda85a1d726dd5352`. No local tests run. PR #18 remains Draft/open/unmerged.
- Next action: check Quality Gate on the latest docs-updated HEAD. If the server suite passes, continue the combat stat runtime coverage audit; if it fails, inspect exact logs and correct only confirmed regressions.

- Precision follow-up: tightened the regression to assert the single canonical response `Сначала вступи в клан.` for this fixture, rather than accepting either message. This locks the roster-authoritative contract instead of broadening the assertion. Commit `88e5b3ee367c8da9176ec73790c5e6a5a7997cad`.
- Current continuation: run/inspect CI for the exact latest documentation HEAD, then proceed with the equipment combat runtime-channel audit.


## Current work log / continuation point — 2026-11-16 (CI re-investigation)
- Starting/verified PR #18 HEAD: `e3dec2679a7cd8c149a182e3adfa796ccb2f974b`; PR remains Draft/open/unmerged; base `stage29/clean-validation-recovery`, branch `staging/local-isolated-launcher`; `main` untouched.
- Quality Gate `43797490206` completed: 3 jobs passed (client build, Playwright, data/docs); server failed 468/469 at `clanWarRuntime.test.ts` waiting 10.45s for the nonmember `clanDonate` notice.
- Correction to the previous checkpoint: the test at this HEAD already accepts both known nonmember rejection texts. Thus stale message wording alone does not explain the failure; previous claim that the test-only fix resolved the issue was premature/incorrect. Do not repeat that conclusion.
- Source confirms roster-authoritative lookup is correct and should remain. `clanDonate` routes through `transactClanMutation`; an exception in shared transaction preparation/recovery could escape before the handler sends its notice. Exact exception has not yet been captured.
- No code changes in this stage. Next: inspect `sharedStateRuntime.commitClan`, underlying WAL commit and test fixture/server stderr; establish why this specific request does not produce a notice. Then fix only the proven cause and run CI on exact new HEAD.


## Current work log / continuation point — 2026-11-16 (diagnostic instrumentation)
- PR #18 working branch `staging/local-isolated-launcher`, base `stage29/clean-validation-recovery`, still Draft/open/unmerged; `main` untouched.
- Latest code HEAD: `3e20af22db7a03b71733af2d83d13b6fc09d8edc`.
- Confirmed the clan runtime test's current expected message is exactly `Сначала вступи в клан.`; commit `88e5b3e` intentionally tightened it. Production `clanDonate` returns that exact message for a roster nonmember. The earlier suggestion that this was merely a stale wording assertion is invalid.
- Request path includes a notable response-loss possibility: `this.notice()` persists the player before sending the notice. A failure in that save could suppress the notice. This is only a hypothesis until stderr is captured.
- Test-only diagnostic commit `3e20af2`: pipe isolated server stderr and include the latest 6,000 characters in the nonmember timeout error. No production logic changed.
- Quality Gate `43798030467` still running at last check (client, Playwright, docs/data jobs passed; server transaction test step still in progress). The diagnostic commit has not yet reported a run.
- Combat coverage review: `monsterCombat.test.ts` has broad typed-engine unit coverage; `pvpCombat.test.ts` locks down legacy PvP boundaries. Remaining gap is live integration, not missing typed-engine unit tests. No balance or combat runtime changes.
- Next action: inspect exact CI result and captured stderr; trace any persistence failure to its first throw site. Do not relax the canonical membership assertion or wire typed combat effects without approved mapping.


## Continuation — clan test root cause confirmed — 2026-11-16
- CI run `43798297230` on previous HEAD `69495d3a0a0ab260185d8dc5a33c45dbf752e7db`: client build, Playwright and data/docs jobs passed; server job failed at the unauthorized `clanRaid` check. Captured server stderr was empty.
- Confirmed exact cause: test loop used one shared expected message for every clan action. `clanRaid` production handler correctly returns `Для кланового похода нужен клан.`, unlike the other actions' `Сначала вступи в клан.`. This is a test assertion bug, not a persistence or handler defect.
- Fixed action-specific expected responses in `server/test/clanWarRuntime.test.ts`; no production code changed. Commit `a77f5e62321c3f19aae808bf9c02d9e9c49b008b`.
- Audit log updated in `40457f6d43ec38ef4e6c7dc29c414a82da4a2dfc`.
- Next: verify Quality Gate on the exact final documentation HEAD. If green, continue the equipment/combat live integration audit; do not wire typed effects or alter balance without design approval.
- PR #18 remains Draft/open/unmerged; `main` untouched.


## Clan runtime test fixed and full Quality Gate passed — 2026-11-16
- Rechecked previous failing Quality Gate `43798297230`: server test failure was at `clanRaid`, not `clanDonate`; isolated-server stderr was empty. The test incorrectly expected the same response from every unauthorized clan action although the production raid handler has its own established message.
- Fixed the assertion with action-specific expected messages in `server/test/clanWarRuntime.test.ts` (commit `a77f5e62321c3f19aae808bf9c02d9e9c49b008b`). No production gameplay code changed.
- Verified latest HEAD `41c86c954cced41a1c358d16fee403e95fcf6b73`: Quality Gate run `43832528775` completed all four jobs successfully: server test suite + TypeScript build, client TypeScript/Vite build, Playwright browser smoke tests, and data/docs/project structure. A second run `43832537305` also completed all four jobs successfully on the same HEAD.
- Equipment/combat integration recheck: production `index.ts` imports and calls `calculatePlayerMonsterCombatStats()`, but does not import/call `buildPlayerCombatantForMonsterBattle()` or `resolveMonsterBattle()`. The synchronous live dungeon path `runExpeditionDungeon()` still builds a legacy `calculateDungeonCombatPlan()` from selected resolved totals/channels. This confirms the newer typed battle engine remains unit-tested but is not the live combat engine.
- Do not wire it automatically: damage type, critical chance/multiplier, accuracy scale, initiative, healing-action selection, status effects, HP/death semantics, RNG sequence and reward/report behavior need a canonical compatibility mapping and regression matrix first. No combat coefficients, game balance, items, or PvP formula changed.
- PR #18 remains Draft/open/unmerged; `main` untouched.
