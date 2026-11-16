# Misty-Isles

Misty-Isles — MMORPG в разработке. Основная рабочая ветка проекта — `main`.

## Быстрый старт

Требования: Node.js 22 (как в CI) и npm.

1. Установить зависимости клиента: `cd client && npm ci`.
2. Установить зависимости сервера: `cd server && npm ci`.
3. Запустить сервер: `cd server && npm run dev`.
4. В отдельном терминале запустить клиент: `cd client && npm run dev`.
5. Открыть адрес Vite, который выведет клиентский dev-сервер (обычно `http://localhost:5173`).

Для Windows также доступны `Запустить игру.bat`, `Остановить игру.bat` и `Проверить игру.bat`. Инструкция: [README_LAUNCHER.md](README_LAUNCHER.md).

## Проверки

Из корня проекта:

- `node tools/qa-audit.mjs` — аудит структуры и данных.
- `cd client && npm ci && npm run verify:project` — проверка ресурсов, TypeScript и production-сборка клиента.
- `cd server && npm ci && npm test && npm run build` — тесты и сборка сервера.
- `cd e2e && npm ci && npx playwright install chrome && npm test` — браузерные smoke-тесты.

GitHub Actions запускает основные проверки автоматически при push и pull request в `main`. Каноническая конфигурация CI находится в `.github/workflows/quality.yml`.

## Структура

- `client/` — клиентская часть и статические игровые ресурсы.
- `server/` — игровой сервер, runtime-системы и тесты.
- `e2e/` — изолированные браузерные smoke-тесты.
- `tools/` — локальные проверки и Windows launcher scripts.
- `assets/` — исходные/концептуальные материалы.
- `.github/` — шаблоны GitHub и CI.

## Сохранения и безопасность

- Не удаляйте и не заменяйте `server/data`: там находятся runtime-сохранения и данные игроков. Перед любыми ручными операциями делайте резервную копию.
- Не запускайте тесты на реальных пользовательских сохранениях. Тесты должны использовать изолированные временные каталоги и synthetic data.
- Серверная конфигурация пока не считается готовой к публичному запуску. До публичного развертывания необходимо закрыть отмеченные в `PROJECT_AUDIT_STATUS.md` вопросы CORS/origin policy, TLS/WSS, rate limiting, payload limits и security headers.

## Техническая документация и контрольные точки

- [Технический паспорт](PROJECT_TECHNICAL_PASSPORT.md)
- [Текущий статус аудита](PROJECT_AUDIT_STATUS.md)
- [Журнал непрерывности и последняя контрольная точка](PROJECT_CONTINUITY_CHECKPOINT.md)
- [Аудит жизненного цикла подземелий](DUNGEON_LIFECYCLE_DESIGN.md)
- [Контракт live-интеграции подземелий](DUNGEON_LIVE_HANDLER_INTEGRATION.md)
- [Аудит безопасности запуска](GAMEPLAY_MESSAGE_RATE_LIMIT_CLASSIFICATION.md)

Исторические заметки и stage-документы сохранены как архив развития проекта; они не являются инструкцией по текущему запуску. При расхождении исторических заметок с кодом, тестами и текущими журналами приоритет имеют код, CI и актуальные контрольные документы.
