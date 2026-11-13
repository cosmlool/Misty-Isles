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
