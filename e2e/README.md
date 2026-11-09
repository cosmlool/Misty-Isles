# Misty Isles — Playwright eyes

This is the lightweight browser QA layer. It launches the game client and
server, drives a real browser, checks the guest entry, character lifecycle,
expedition hunting, shop/equipment transactions, save recovery, and all primary game
sections, and captures screenshots and diagnostics.

## Requirements

- Node.js 20.11 or newer.
- The project dependencies installed in `client` and `server`.
- Google Chrome installed on the computer.
- Ports `5173` and `2567` available.

## First run

From the repository root:

```bat
cd e2e
npm install
npm test
```

To watch the browser while the checks run:

```bat
npm run test:headed
```

To open the HTML report from the last run:

```bat
npm run report
```

## What is checked now

1. The login page opens.
2. A new synthetic guest can authenticate against the test server.
3. Character creation displays all four races.
4. Selecting a race creates a level-one character in the correct home city.
5. The new character receives the expected starting gold and two starter items.
6. Reloading reconnects the guest and restores the same character and inventory.
7. The guest starts an expedition hunt through the game UI and claims the encounter.
8. A victory increases gold and the resulting inventory remains valid.
9. The guest buys a level-one weapon through the shop; exactly 130 gold is charged and the item is added to inventory.
10. The guest equips the purchased weapon and the equipment slot updates.
11. Gold, inventory, and equipped gear are restored after another page reload.
13. All 17 main game sections render at a narrow mobile width without horizontal overflow.
14. The isolated test admin screen renders without changing the character.
15. The tested pages have no uncaught JavaScript errors.
16. The login page does not overflow a narrow mobile viewport.

The isolated test server changes `searchSeconds` to one second only in its
temporary copy of `forgotten_lands.json`. The real game data and normal
15-minute expedition timer are not modified.

Screenshots are saved for character creation, the first in-world character
screen, and the hunt victory. Failed tests retain screenshots, video, and a
Playwright trace in `test-results`.

## Data safety

The test server copies only the three static catalogs it needs into a fresh
temporary directory. All generated accounts, sessions, and player saves stay
inside that directory, which is deleted when the test server stops. The tests
never point at `server/data` for runtime saves and never use real player
accounts.

The test run starts its own server on port 2567 and Vite on port 5173. Stop any
manually running Misty Isles server before starting the browser tests.
