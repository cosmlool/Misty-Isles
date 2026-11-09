# Misty Isles — Playwright eyes

This is the first lightweight browser QA layer. It launches the game client and
server, drives a real browser, checks the guest entry flow, and captures
screenshots and diagnostics.

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
3. The game reaches character creation and displays all four races.
4. The page has no uncaught JavaScript errors during this flow.
5. The login page does not overflow a narrow mobile viewport.

A screenshot is saved for the character-creation screen. Failed tests also
retain screenshots, video, and a Playwright trace in `test-results`.

## Data safety

The test server copies only the three static catalogs it needs into a fresh
temporary directory. All generated accounts, sessions, and player saves stay
inside that directory, which is deleted when the test server stops. The tests
never point at `server/data` for runtime saves and never use real player
accounts.

The test run starts its own server on port 2567 and Vite on port 5173. Stop any
manually running Misty Isles server before starting the browser tests.
