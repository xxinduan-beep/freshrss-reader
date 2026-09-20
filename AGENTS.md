# FreshRSS Reader

## Overview

FreshRSS Reader is a **FreshRSS-specific desktop RSS client** forked from **Fluent Reader**, built with **Go + Wails v3 + React + Redux + TypeScript** (migrated from Electron; see the `wails-migration` branch). It targets Linux first. The UI uses Microsoft's **Fluent UI (v7)** component library. Subscriptions and article state are synced via the **Google Reader API** (as implemented by FreshRSS at `/api/greader.php`); articles are cached locally using **Lovefield** (SQL-like browser DB). Settings are persisted by the Go backend as JSON at `~/.config/freshrss-reader/settings.json` (migrates a legacy electron-store `config.json` when present).

Local RSS fetching, the rules engine, full-content scraping, auto-update, and all non-FreshRSS service backends (Fever, Feedbin, Inoreader, Miniflux, Nextcloud) have been removed relative to upstream Fluent Reader.

**Architecture (Wails v3, beta.20):**
- `main.go` + `internal/` (Go): window management, settings store, HTTP forwarding (`internal/httpclient`, avoids webview CORS for FreshRSS API), dialogs, clipboard, fonts (`internal/platforminfo`), theme detection (`internal/theme`), renderer-facing HTTP API at `/api/desktop/*` served same-origin through the Wails AssetServer middleware (`internal/server/api.go`).
- `src/bridges/wails/index.ts`: the only native-capability layer in the renderer. It implements the legacy `window.settings` / `window.utils` bridge facades with identical signatures (sync getters read a boot snapshot fetched via blocking XHR at `/api/desktop/boot`; setters POST to the Go API). Window/theme events arrive via `@wailsio/runtime` Events using the old Electron channel names (`theme-updated`, `maximized`, `window-focus`, ...).
- Article bodies render in a **same-origin sandboxed iframe** loading `dist/article/article.html` (the Electron `<webview>` tag has no Wails equivalent). The iframe posts key events to the parent (`frss-webview-keydown` messages); "load webpage" mode opens the system browser.

The repository is ~80 TypeScript/TSX source files under `src/`. There is no ESLint — formatting is handled solely by **Prettier**.

## Build & Validate

Always run commands from the repository root.

### Install dependencies

```bash
npm install
```

Run this **before every build**. The lockfile (`package-lock.json`) is gitignored (`.lock` in `.gitignore`), so `npm install` resolves from `package.json` each time.

### Build (renderer + Go shell)

```bash
npm run build        # webpack renderer bundle into dist/
./build.sh [out]     # renderer + Go binary (default bin/freshrss-reader)
```

Building the Go shell requires gcc, Go >= 1.24 and GTK3/WebKit2GTK dev packages. On machines without root, `build.sh` uses a local GTK/WebKit prefix extracted under `~/.local/wails-root` (see script comments) and passes `-tags gtk3` to `go build`.

### Run the app

```bash
./run.sh bin/freshrss-reader
```

`run.sh` launch­es the binary inside a user namespace that overlays the local WebKit runtime over `/usr/lib/x86_64-linux-gnu` (needed because WebKit helper processes use a compiled-in absolute path).

### Build (compile TypeScript via Webpack)

```bash
npm run build
```

This runs `webpack --config ./webpack.config.js`, which produces the renderer bundle in `dist/`:
- `index.js` + `index.html` — Renderer/React app (from `src/index.tsx`)

Build takes ~30 seconds. The desktop shell is built by `./build.sh`, which runs webpack then `go build -tags gtk3`.

### Run the app

```bash
./run.sh bin/freshrss-reader
```

### Format check (Prettier)

```bash
npx prettier --check .
```

To auto-fix formatting:

```bash
npm run format
```

**Always run `npx prettier --check .` after making changes** to ensure code style compliance. The Prettier config is in `.prettierrc.yml`: 4-space tabs, no semicolons, JSX bracket on same line, arrow parens avoided, consistent quote props. `.prettierignore` excludes `dist/`, `bin/`, `node_modules/`, HTML, Markdown, and most JSON (except `src/**/*.json`).

### Typecheck

```bash
npx tsc --noEmit
```

`tsconfig.json` sets `skipLibCheck: true` so this checks `src/` only.

### Packaging

- Linux: `./build.sh` produces `bin/freshrss-reader`; AppImage/deb packaging is not set up yet.

## Project Layout

### Root files
| File | Purpose |
|---|---|
| `package.json` | Dependencies, scripts, metadata (v1.0.0) |
| `webpack.config.js` | Renderer-only webpack config |
| `tsconfig.json` | TypeScript: JSX=react, target=ESNext, skipLibCheck |
| `main.go` | Wails v3 application entry (window, asset server middleware, event hooks) |
| `go.mod` / `go.sum` | Go module (Wails v3 beta.20) |
| `internal/` | Go backend packages: `settings` (JSON store), `server` (`/api/desktop/*`), `httpclient` (proxy-aware forwarding), `platforminfo` (fonts), `theme` (dark-mode detection) |
| `wails.json` | Wails v3 CLI config (gtk3 build tag) |
| `build.sh` / `run.sh` | Build and run helpers (local GTK/WebKit prefix, user-namespace overlay) |
| `.prettierrc.yml` | Prettier formatting rules |
| `.prettierignore` | Files excluded from Prettier |

### `src/` — All source code

| Path | Description |
|---|---|
| `index.tsx` | **Renderer entry**. Imports the Wails bridge shim first, mounts React `<Root>` with Redux `<Provider>`. |
| `schema-types.ts` | Shared TypeScript enums and types (ViewType, SyncService, etc.). |
| `bridges/wails/index.ts` | Native-capability shim implementing `window.settings` / `window.utils` over the Go HTTP API and `@wailsio/runtime` events. |
| `scripts/` | Renderer-side logic (runs in browser context). |
| `scripts/reducer.ts` | Root Redux store — combines: sources, items, feeds, groups, page, service, app. |
| `scripts/settings.ts` | Theme management, locale setup, Fluent UI theming, backup import/export. |
| `scripts/db.ts` | Lovefield database schema definitions (sources, items; `serviceRef` columns power service diffing). |
| `scripts/utils.ts` | Shared utilities and type helpers. |
| `scripts/models/` | Redux slices: `app.ts`, `feed.ts`, `group.ts`, `item.ts`, `page.ts`, `service.ts`, `source.ts`, plus `services/freshrss.ts` — the Google Reader API client for FreshRSS (ClientLogin auth, subscription/list, stream/items/ids, stream/contents, edit-tag, mark-all-as-read). API requests are forwarded through the Go backend (`window.utils.request`) to avoid webview CORS. |
| `scripts/i18n/` | Internationalization. `_locales.ts` maps locale codes to JSON files. 19 languages. Translations are JSON files (e.g., `en-US.json`). Uses `react-intl-universal`. |
| `components/` | React UI components. `root.tsx` is the top-level layout. Sub-dirs: `cards/` (article card variants), `feeds/` (feed list views), `settings/` (settings panels; `settings/services/freshrss.tsx` is the FreshRSS login form), `utils/` (shared UI helpers). |
| `containers/` | Redux-connected container components that map state/dispatch to component props. |

### `dist/` — Build output + static assets

The `dist/` directory contains **both webpack output and checked-in static assets**. Files like `dist/icons/`, `dist/article/`, `dist/styles/`, `dist/index.css`, `dist/fonts.vbs`, and `dist/fontlist` are static and tracked in git. The webpack-generated files (`*.js`, `*.js.map`, `*.html`, `*.LICENSE.txt`) are gitignored.

## Architecture Notes

- **Native-capability pattern**: The renderer never touches Wails or Go directly except through `window.settings` / `window.utils` (`src/bridges/wails/index.ts`). Settings state flows: renderer → shim → HTTP `/api/desktop/settings/*` → `internal/server` → `internal/settings` JSON store.
- **State management**: Redux with `redux-thunk` for async actions. The store shape is defined by `RootState` in `scripts/reducer.ts`. Each model file in `scripts/models/` exports its own reducer, action types, and thunk action creators.
- **Service sync**: `syncWithService()` in `scripts/models/service.ts` orchestrates reauthenticate → updateSources → syncItems → fetchItems. Item construction happens directly in `services/freshrss.ts` (no local RSS parsing path exists).
- **i18n**: To add or modify translations, edit JSON files in `src/scripts/i18n/`. Register new locales in `_locales.ts`.
- **Local DB**: All sources carry a `serviceRef` (server id); lovefield `serviceRef` columns drive read/star diffing in `syncItems` and date-based mark-all-read.

## Key Conventions

- All source is TypeScript (`.ts`/`.tsx`). No plain JavaScript in `src/`.
- No semicolons. 4-space indentation. See `.prettierrc.yml`.
- Enums use `const enum` pattern in `schema-types.ts`.
- Components use both class components and function components (no strict rule).
- Redux containers in `containers/` use `connect()` from react-redux.
- **Griffel styling**: Use `makeStyles` from `@griffel/react` for component-scoped styles. Import `mergeClasses` for combining classes. Prefer Griffel over adding new CSS rules to `dist/styles/`.
- **`styleClass` prop convention**: Reusable components expose a `styleClass?: string` prop applied to the component's main element, allowing parents to pass Griffel-generated class overrides. If a component has multiple customizable elements, use element-specific prop names (e.g., `buttonStyleClass?: string`). Combine base and override classes with `mergeClasses`.
- **Flat button components**: `FlatButton`, `FlatButtonGroup`, and `FlatButtonSeparator` in `src/components/utils/` implement the Griffel + `styleClass` pattern. Use these instead of raw `<button>`/`<div>` with CSS class names for toolbar-style buttons.

## Validation Checklist

After any code change, always run:
```bash
npm install && npm run build && npx prettier --check .
```
All three must succeed. Also run `npx tsc --noEmit` to typecheck `src/`. If the build fails, fix TypeScript errors. If prettier fails, run `npm run format` then verify.

Trust these instructions. Only search the codebase if information here is incomplete or found to be incorrect.
