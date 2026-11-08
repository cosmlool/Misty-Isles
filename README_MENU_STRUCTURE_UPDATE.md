# Menu structure update — Misty Isles

This update reorganizes the left sidebar into the nine requested top-level entries, in order:
1. Персонаж
2. Почта
3. Карта мира
4. Боевая гильдия
5. Город
6. Приключения
7. Арена
8. Клан
9. Админ-панель

Related destinations are nested directly below their thematic parent. The left sidebar label is `Почта`; the existing event/history functionality remains on that page. No server code or game rules were changed in this update.

Build note: the source archive does not include installed `node_modules`, so a full client build must be run after installing dependencies (`npm ci`) in `client`.
