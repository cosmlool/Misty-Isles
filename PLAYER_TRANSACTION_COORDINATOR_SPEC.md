# Единый координатор сохранения игроков

Статус: shared transaction engine реализован и покрыт unit-тестами; production writers ещё не мигрированы.  
Дата аудита: 12.11.2026.  
Базовый commit: `f92f28b4907e369ef60a95e65a2e03d820fbe090`.

## 1. Почему это необходимо

На проверенном head несколько подсистем независимо записывают один и тот же `players.json`:

- `playerSaves.ts` предоставляет прямой `savePlayers()`, который атомарно заменяет файл и создаёт backup, но не проверяет журналы других подсистем.
- `auctionTransactions.ts` использует `auction_transaction.json` и при commit/recovery переписывает `players.json`, `auction.json`, `auction_history.json`.
- `clanTransactions.ts` использует `clan_transaction.json` и переписывает `players.json`, `clans.json`, `clan_wars.json`, `clan_territories.json`.
- В `index.ts` startup выполняет recovery аукциона, затем кланов; это последовательность двух независимых журналов, а не общий recovery gate.
- Обычные сохранения из `GameRoom.save()`, `persistPlayers()`, autosave и отдельные игровые обработчики вызывают `savePlayers()` напрямую.
- В `index.ts` обнаружено 4 прямых вызова `savePlayers()`, 12 вызовов `persistPlayers()`, 3 вызова `auctionTransactions.commit()` и один централизованный `clanTransactions.commit()` helper.

Атомарная замена одного файла не делает атомарной группу файлов и не координирует независимые WAL. Если журнал одной подсистемы остался после неудачного recovery, другой writer может записать более старый player snapshot поверх уже применённой части транзакции.

## 2. Требуемый принцип

До реализации шахты все операции, которые затрагивают player state, должны подчиняться одному владельцу записи и одному recovery gate.

Предпочтительное направление — единый `PlayerPersistenceCoordinator` с одним журналом транзакций. Он должен владеть записью player snapshot и всех связанных файловых снимков в рамках одной операции.

### Обязательные свойства

1. **Один WAL.** Не должно быть независимых auction/clan/mining журналов, каждый из которых самостоятельно переписывает `players.json`.
2. **Recovery до чтения/подготовки snapshot.** Нельзя сначала собрать потенциально устаревший snapshot, затем восстановить чужой WAL и поверх него записать старые данные.
3. **Один API записи.** Обычный save/autosave, аукцион, клан, война, будущая шахта и другие player-mutating системы используют один coordinator.
4. **Закрытие при ошибке.** Если журнал повреждён или recovery не завершился, все writers должны fail closed. Нельзя разрешать fallback на прямой `savePlayers()`.
5. **Согласование памяти и диска.** После восстановления нельзя продолжать сохранять устаревшие online Player objects поверх восстановленного snapshot. До возобновления записи состояние online-игроков должно быть согласовано с recovered state либо процесс должен безопасно остановить запись и потребовать restart.
6. **Идемпотентное восстановление.** Повторное применение журнала после падения между любыми двумя target-файлами должно приводить к одному и тому же итоговому состоянию.
7. **Проверка целостности.** Формат журнала, список разрешённых target-файлов, версии и JSON-структуры проверяются до применения. Неизвестный target запрещён.
8. **Backup policy.** Существующая политика backup для `players.json` сохраняется; backup не должен удаляться до подтверждённого commit.
9. **Нет клиентского источника истины.** Секретные идентификаторы mining job, claim nonce и результаты не помещаются в Colyseus PlayerSchema или синхронизируемый `quests`.
10. **Обратная совместимость.** Существующие `players.json`, auction/clan JSON и старые сохранения продолжают загружаться без принудительной миграции игровых данных.

## 3. Предлагаемый формат транзакции

Один журнал содержит версию, transaction ID и полный список заменяемых файлов с подготовленными JSON-снимками. Набор target-файлов ограничен серверным allowlist: `players.json`, `auction.json`, `auction_history.json`, `clans.json`, `clan_wars.json`, `clan_territories.json`; в будущем — отдельное серверное хранилище шахты.

Протокол:
1. Проверить, что coordinator не заблокирован.
2. Выполнить recovery всех незавершённых операций до формирования нового snapshot.
3. Подготовить и валидировать согласованный snapshot после recovery.
4. Атомарно записать WAL.
5. Применить все target-файлы атомарной заменой в детерминированном порядке.
6. Удалить WAL только после успешной записи всех targets.
7. При ошибке оставить WAL и заблокировать дальнейшие записи, пока восстановление и согласование runtime state не завершатся.

Синхронные операции одного Node.js процесса не вклиниваются друг в друга в середине JS-вызова, но это не решает stale snapshot, независимые журналы и потенциальные дополнительные процессы. Поддержка нескольких серверных процессов на одном DATA_DIR должна быть либо отдельно обеспечена межпроцессной блокировкой, либо явно запрещена проверкой единственного владельца хранилища.

## 4. Карта миграции текущих writers

| Writer | Текущее состояние | Требуемое изменение |
|---|---|---|
| `GameRoom.save()` | Прямой `savePlayers()` | Перевести на coordinator |
| `persistPlayers()` / `persistPlayer()` | Прямой `savePlayers()` | Перевести на coordinator |
| 30-секундный autosave | Вызывает `persistPlayers()` | Только через coordinator |
| PvP и другие одиночные обработчики | Есть прямые вызовы `savePlayers()` | Убрать обход coordinator |
| Auction list/buy/cancel | Независимый auction WAL | Перенести targets в общий transaction API |
| Clan / war / territory | Независимый clan WAL | Перенести targets в общий transaction API |
| Mining (будущее) | Не реализовано | Добавлять только после общего coordinator |

## 5. Обязательные fault-injection тесты

1. Незавершённый auction WAL + попытка обычного autosave: устаревшее состояние не должно перезаписать восстановленный snapshot.
2. Незавершённый clan WAL + попытка обычного autosave.
3. Незавершённый auction WAL + начало clan transaction.
4. Незавершённый clan WAL + начало auction transaction.
5. Повреждённый общий WAL: все writers блокируются; журнал и исходные файлы сохраняются для ручного восстановления.
6. Аварийное завершение после каждого target write: restart повторяет recovery без дублирования/потери данных.
7. Повторный recovery одного и того же WAL даёт идентичный результат.
8. Ошибка storage во время commit: WAL остаётся, новые записи не обходят блокировку.
9. Проверка online Player objects: recovered данные не перезаписываются старым объектом из памяти.
10. Backup/rotation: резервная копия предыдущего `players.json` остаётся доступной при неудачном commit.
11. Проверка, что все существующие игровые пути сохранения проходят через coordinator (поиск прямых вызовов и тестовый guard).
12. Проверка старых форматов сохранений и отсутствия изменений игровых числовых коэффициентов.

## 6. Условия завершения этапа

- В production-коде нет обходного writer для `players.json`.
- Auction, clan, обычные saves и autosave используют общий transaction/recovery механизм.
- Все fault-injection тесты выше проходят.
- Runtime-тесты используют только временный DATA_DIR и синтетических игроков.
- CI Quality Gate проходит на новом head.
- Только после этого разрешается проектировать и реализовывать persisted mining jobs и claim.

## 7. Что запрещено делать до завершения

- Не добавлять третий независимый WAL для шахты.
- Не записывать player state напрямую из нового кода в обход coordinator.
- Не считать клиентский 8-секундный pendingActions защитой от replay.
- Не добавлять mining job в PlayerSchema: на проверенном head 64 декорированных поля.
- Не менять цены, шансы, XP, PvP таймеры и прочие игровые коэффициенты в рамках этой технической задачи.


## 8. Уточнение после аудита call sites (12.11.2026)

### 8.1 Обнаружены дополнительные обходные записи

В `server/src/index.ts` есть прямые вызовы `saveClans(clans)` из игровых обработчиков и рассылки:

- `clanQuests` вызывает `saveClans()` после `ensureClanQuests()`.
- `clanUpgrade` сохраняет казну/уровень улучшения напрямую.
- `clanTerritoryCapture` имеет ветки прямого сохранения кланов.
- `clanQuestClaim` сохраняет награду и флаг claimed напрямую.
- `clanSeasonReward` сохраняет сезонную награду напрямую.
- `broadcastClanQuests()` также вызывает `saveClans()` после формирования рассылки.

Последний случай особенно важен: функция рассылки не должна сама сохранять данные. Нужно разделить чистую подготовку/рассылку payload и явную транзакционную запись.

Вспомогательные `saveTerritories()`, `saveAuction()`, `saveAuctionHistory()`, `saveWars()` тоже требуют проверки использования и удаления/изоляции, если они не нужны. `loadTerritories()` сейчас создаёт файл по умолчанию через прямую запись; инициализацию defaults следует выполнить до запуска обычных writers под контролем persistence bootstrap.

### 8.2 Recovery должен происходить ДО подготовки snapshot

Критическое уточнение к API координатора: нельзя принимать уже собранный snapshot, а затем внутри `commit(snapshot)` вызывать recovery.

Текущий порядок потенциально опасен:
1. Игровой обработчик читает данные и строит новый snapshot в памяти.
2. Внутри transaction `commit(snapshot)` обнаруживается и применяется незавершённый WAL.
3. Затем ранее подготовленный snapshot записывается поверх recovered state.

Даже общий WAL не исправит это, если snapshot был подготовлен до recovery. Поэтому публичный API должен принимать подготовщик, например `transact(prepareAfterRecovery)`, либо выполнять recovery на отдельном bootstrap/read gate до того, как игровые обработчики получат доступ к данным. Подготовка должна происходить только после recovery и синхронизации runtime Player objects с восстановленными данными.

### 8.3 Дополнительные требования к архитектуре

- Разделить `broadcastClanQuests()` на pure payload generation / broadcast; никаких дисковых writes из broadcast helper.
- Удалить либо сделать недоступными внутренние прямые writers для auction/clan/war/territory после миграции.
- Добавить тест, доказывающий, что подготовленный до recovery snapshot не может перезаписать более новую транзакцию.
- Добавить тест, что простое чтение/открытие экрана клановых заданий не создаёт несогласованную запись поверх транзакции.
- Bootstrap обязан завершить общий recovery до загрузки online Player objects, и только после этого запускать комнаты/autosave.
- Проверить все call sites функций save* по всему серверному каталогу, а не только определения и прямые вызовы в `index.ts`.


## 9. Повторная проверка реализации на commit 6092bc9 (12.11.2026)

### 9.1 Что уже существует

- `server/src/sharedStateTransactions.ts` реализует единый WAL и callback API `transact(prepareAfterRecovery)`.
- Callback подготовки вызывается только после `recover()`, поэтому snapshot можно собирать из актуальных файлов.
- Есть allowlist targets, atomic replace, backup `players.json`, fail-closed при ошибке recovery и fault-injection hooks.
- `server/test/sharedStateTransactions.test.ts` покрывает общий commit, подготовку после recovery, crash между target writes, legacy recovery order, повреждённый WAL, fail-closed, backup и rotation.

### 9.2 Production integration всё ещё отсутствует

Проверено в `server/src/index.ts`:

- Startup по-прежнему восстанавливает legacy auction и clan WAL, затем shared WAL. Этот порядок сохраняет совместимость с переходным периодом.
- `GameRoom.save()` всё ещё вызывает прямой `savePlayers(all)`.
- `pvpList` всё ещё вызывает прямой `savePlayers(all)` при обновлении списка соперников.
- `pvpChallenge` всё ещё вызывает прямой `savePlayers(all)` после боя.
- `persistPlayers()` всё ещё вызывает прямой `savePlayers(all)`; через него проходит 30-секундный autosave и другие игровые сохранения.
- `auctionSell`, `auctionCancel`, `auctionBuy` всё ещё вызывают `auctionTransactions.commit()`.
- `commitClanState()` всё ещё вызывает `clanTransactions.commit()`.
- Вызовы `loadPlayersWithOnline()` и `loadPlayersForAuction()` формируют online snapshot до общей транзакции; после recovery нужно синхронизировать уже загруженные объекты `ONLINE_PLAYERS` с восстановленным player snapshot до включения их в новый snapshot.
- `loadTerritories()` может создавать defaults прямой записью через `saveTerritories()`; это bootstrap-путь, который нужно перенести под контролируемую инициализацию до запуска игровых writers.
- 30-секундный autosave оставляется без изменений.

### 9.3 Обязательный порядок следующей миграции

1. На старте выполнить recovery legacy auction WAL, затем legacy clan WAL, затем shared WAL — до загрузки/создания online Player objects и запуска autosave.
2. Сделать единый helper подготовки player snapshot, который вызывается только внутри `sharedStateTransactions.transact()`; после recovery он перечитывает disk state и синхронизирует online Player objects перед merge.
3. Перевести `GameRoom.save()`, `persistPlayers()`, `pvpList` и `pvpChallenge` на shared transaction callback.
4. Перевести auction sell/cancel/buy на shared transaction; их бизнес-операции должны вычислять snapshot внутри callback, а не до него.
5. Перевести все clan/war/territory writers на shared transaction; `commitClanState` не должен использовать legacy WAL.
6. Запретить прямые runtime writes для players, auction, auction history, clans, wars и territories; сохранить только строго контролируемую bootstrap-инициализацию defaults.
7. Добавить runtime fault tests для stale online Player object, каждой legacy WAL + обычного save, auction + clan cross-write, и всех существующих write call sites.
8. Только после миграции всех writers удалить legacy transaction stores и их startup recovery. Не удалять их раньше.

**Важно:** наличие и unit-тесты shared transaction engine не означают, что production runtime уже защищён общим WAL. До завершения пунктов выше архитектура остаётся переходной и не готова к persistent mining jobs.
