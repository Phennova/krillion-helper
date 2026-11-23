# Krillion Helper

A browser extension for [Krillion](https://krillion.io) that reads the current
question off the page and shows a list of answers in a floating panel, easiest
to type first. It works in the solo modes and in Puffer Party.

Answers come from Claude (Haiku by default) through a small local server that
calls the [Claude Code](https://claude.com/claude-code) CLI, so it uses your
existing Claude Code login and needs no API key.

Unofficial fan project. Not affiliated with Krillion or its developer.

## What it does

- **Finds the question.** Reads the prompt from the page's HTML and refreshes
  the list whenever it changes.
- **Sorts by typing effort.** Shortest, plainest answers first. A button
  switches to rarest first, since Krillion scores rarer answers higher.
- **Never steals focus.** The panel floats on top of the game and you keep
  typing in the answer box, even if you click the panel.
- **Tracks answers already said.** In Puffer Party, answers other players have
  given are struck through and skipped.
- **Types for you (optional).** `type answer ▶` types and submits the top
  unused answer. `try again ↻` deletes it and types the next one. `worked ✓`
  locks it in.
- **Auto-play (optional, Puffer Party).** The `auto` button makes it answer by
  itself whenever the puffer lands on you, retrying until one is accepted and
  the turn passes.
- **Learns as you play.** Answers Krillion accepts (from anyone at the table)
  are saved with their real rarity tier and shown first with a ✓ the next time
  that question comes up. Answers it rejects are dropped.

## Requirements

- [Node.js](https://nodejs.org) 18 or newer
- [Claude Code](https://claude.com/claude-code) installed and signed in
  (`claude` must work in your terminal)
- Firefox or a Chromium browser (Chrome, Edge, Brave, Arc)

## Setup

### 1. Start the local server

```sh
git clone https://github.com/Phennova/krillion-helper.git
cd krillion-helper
node server/server.js
```

Leave it running while you play. To use Sonnet instead of Haiku (slower, more
accurate):

```sh
KRILLION_MODEL=sonnet node server/server.js
```

### 2. Load the extension

**Firefox**

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and choose `extension/manifest.json`.

Firefox removes temporary add-ons when it closes, so repeat this each session.

**Chrome / Edge / Brave / Arc**

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `extension-chrome` folder.

### 3. Play

Open [krillion.io](https://krillion.io) and start a game. The panel appears on
the right. The buttons in its header switch the sort order, move it to the
other side, and collapse it.

## How it works

```
krillion.io page ──▶ content script ──▶ background script ──▶ local server ──▶ claude CLI
   (question)          (panel)            (relay)            127.0.0.1:8765     (Haiku)
```

- `extension/content.js` watches the page for the prompt (`.ds-card .prompt`),
  draws the panel, and reads the game's accept/reject feedback.
- `extension/background.js` relays requests to the local server.
- `server/server.js` asks Claude for answers, caches them in
  `server/answers-cache.json`, and stores what Krillion accepted or rejected in
  `server/learned.json`.

The server only listens on `127.0.0.1` and refuses requests that don't come
from a browser extension. Claude runs with all tools disabled.

## Things to know

- **Speed.** A new question takes about 4 seconds, mostly the Claude CLI
  starting up. Repeat questions are instant.
- **Not every answer is right.** Claude's answers are guesses until Krillion
  has accepted them. The ✓ marks the proven ones.
- **Selectors can break.** The extension relies on Krillion's current page
  structure. If the panel stops finding questions after a site update, the
  selectors at the top of `content.js` need updating.

## Development

The Firefox and Chrome builds share the same two scripts. Edit them in
`extension/`, then run `./sync-chrome.sh` to copy them into
`extension-chrome/`. Only the `manifest.json` files differ.
