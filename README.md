# BitRouge

BitRouge is an interactive idle game about building a computer that can survive an escalating workload. Process jobs, keep power and heat under control, finish research, push from Hz to GHz, and hold each run long enough to earn permanent architecture upgrades.

The project uses Vite, React 19, strict TypeScript, and Phaser 4 for a renderer diagnostics page. The pure deterministic simulation lives in `src/game` and has no framework imports.

## Develop

```sh
npm install
npm run dev        # http://127.0.0.1:6174
npm run verify     # tests + typecheck + build
```

See [the game spec](docs/game-spec.md) for the current loop and progression. Contributor rules are in [AGENTS.md](AGENTS.md).

## Deploy

Pushes to `main` build with `GITHUB_PAGES=true` and publish `dist/` to GitHub Pages at `/BitRouge/`.
