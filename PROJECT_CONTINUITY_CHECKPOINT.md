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

## PR

PR #15 остаётся Draft/open и не объединён. Слияние без отдельного разрешения пользователя запрещено.
