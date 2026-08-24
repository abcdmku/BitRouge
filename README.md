# BitRouge

A pixel-art roguelike built on IdleBit's idle compute mechanics. A hero process auto-explores a corrupted data-center stack in real time; you can take over turn-by-turn whenever you like. Runs are the prestige layer: die, bank the Credits, buy faster hardware, redeploy.

Vite + React 19 + TypeScript (strict) + Phaser 4 for the dungeon view. Pure simulation lives in `src/game` and has no framework imports.

## Develop

```
npm install
npm run dev        # http://127.0.0.1:6174
npm run verify     # tests + typecheck + build
```

Design spec: `docs/game-spec.md`. Contributor rules: `AGENTS.md`.

## Deploy

Pushes to `main` build with `GITHUB_PAGES=true` and publish `dist/` to GitHub Pages at `/BitRouge/`.
