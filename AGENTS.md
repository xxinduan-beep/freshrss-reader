# FreshRSS Reader

## Overview

FreshRSS Reader is a **FreshRSS-specific desktop RSS client** forked from **Fluent Reader**, built with **Electron + React + Redux + TypeScript**. It targets Linux (AppImage), Windows (NSIS), and macOS (dmg). The UI uses Microsoft's **Fluent UI (v7)** component library. Subscriptions and article state are synced via the **Google Reader API** (as implemented by FreshRSS at `/api/greader.php`); articles are cached locally using **Lovefield** (SQL-like browser DB). Settings are persisted with **electron-store**.

Local RSS fetching, the rules engine, full-content scraping, auto-update, and all non-FreshRSS service backends (Fever, Feedbin, Inoreader, Miniflux, Nextcloud) have been removed relative to upstream Fluent Reader.

The repository is ~80 TypeScript/TSX source files under `src/`. There is no ESLint — formatting is handled solely by **Prettier**.

## Build & Validate

Always run commands from the repository root.

### Install dependencies

```bash
npm install
```

Run this **before every build**. The lockfile (`package-lock.json`) is gitignored (`.lock` in `.gitignore`), so `npm install` resolves from `package.json` each time.

### Build (compile TypeScript via Webpack)

```bash
npm run build
```

This runs `webpack --config ./webpack.config.js`, which produces three bundles in `dist/`:
- `electron.js` — Electron main process (from `src/electron.ts`)
- `preload.js` — Preload script (from `src/preload.ts`)
- `index.js` + `index.html` — Renderer/React app (from `src/index.tsx`)

Build takes ~30 seconds. A successful build ends with three "compiled successfully" lines — one per webpack config entry.

### Run the app

```bash
npm run electron
```

Or combined install + build + run:

```bash
npm run start
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

- Windows: `npm run package-win`
- macOS: `npm run package-mac`
- Linux: `npm run package-linux`

## Project Layout

### Root files
| File | Purpose |
|---|---|
| `package.json` | Dependencies, scripts, metadata (v1.0.0) |
| `webpack.config.js` | Three webpack configs: main, preload, renderer |
| `tsconfig.json` | TypeScript: JSX=react, target=ESNext, skipLibCheck |
| `electron-builder.yml` | Electron Builder config for Win/Mac/Linux distribution |
| `.prettierrc.yml` | Prettier formatting rules |
| `.prettierignore` | Files excluded from Prettier |
| `patch-griffel.js` | postinstall patch for @griffel/webpack-plugin on Windows |

### `src/` — All source code

| Path | Description |
|---|---|
| `electron.ts` | **Electron main process** entry. Creates app menu, initializes `WindowManager`. |
| `preload.ts` | **Preload script**. Exposes `settingsBridge` and `utilsBridge` via `contextBridge`. |
| `index.tsx` | **Renderer entry**. Mounts React `<Root>` with Redux `<Provider>`. |
| `schema-types.ts` | Shared TypeScript enums and types (ViewType, SyncService, etc.). |
| `bridges/` | IPC bridges between renderer and main process (`settings.ts`, `utils.ts`). |
| `main/` | Electron main-process modules: `window.ts` (BrowserWindow), `settings.ts` (electron-store + IPC handlers), `utils.ts` (IPC utilities), `touchbar.ts`. |
| `scripts/` | Renderer-side logic (runs in browser context). |
| `scripts/reducer.ts` | Root Redux store — combines: sources, items, feeds, groups, page, service, app. |
| `scripts/settings.ts` | Theme management, locale setup, Fluent UI theming, backup import/export. |
| `scripts/db.ts` | Lovefield database schema definitions (sources, items; `serviceRef` columns power service diffing). |
| `scripts/utils.ts` | Shared utilities and type helpers. |
| `scripts/models/` | Redux slices: `app.ts`, `feed.ts`, `group.ts`, `item.ts`, `page.ts`, `service.ts`, `source.ts`, plus `services/freshrss.ts` — the Google Reader API client for FreshRSS (ClientLogin auth, subscription/list, stream/items/ids, stream/contents, edit-tag, mark-all-as-read). |
| `scripts/i18n/` | Internationalization. `_locales.ts` maps locale codes to JSON files. 19 languages. Translations are JSON files (e.g., `en-US.json`). Uses `react-intl-universal`. |
| `components/` | React UI components. `root.tsx` is the top-level layout. Sub-dirs: `cards/` (article card variants), `feeds/` (feed list views), `settings/` (settings panels; `settings/services/freshrss.tsx` is the FreshRSS login form), `utils/` (shared UI helpers). |
| `containers/` | Redux-connected container components that map state/dispatch to component props. |

### `dist/` — Build output + static assets

The `dist/` directory contains **both webpack output and checked-in static assets**. Files like `dist/icons/`, `dist/article/`, `dist/styles/`, `dist/index.css`, `dist/fonts.vbs`, and `dist/fontlist` are static and tracked in git. The webpack-generated files (`*.js`, `*.js.map`, `*.html`, `*.LICENSE.txt`) are gitignored.

### `build/` — Packaging resources

Contains app icons (`build/icons/`) and the macOS entitlements plist.

## Architecture Notes

- **IPC pattern**: The renderer never imports Electron directly. All Electron APIs are accessed through `src/bridges/` which are exposed via `contextBridge` in `preload.ts`. Settings state flows: renderer → bridge (ipcRenderer) → main/settings.ts (ipcMain handlers) → electron-store.
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
