# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Yep Anywhere is a self-hosted, mobile-first supervisor for local AI agent sessions. The server owns long-running agent processes so browser/mobile clients can disconnect without interrupting work. The UI supports multiple providers such as Claude Code, Claude + Ollama, Codex, Codex OSS, Gemini, OpenCode, and the relay-based remote access flow.

## Common Commands

```bash
pnpm install       # Install all workspace dependencies
pnpm setup:core    # Install root + shared + server + client, skipping relay workspace
pnpm dev           # Start server and client dev servers
pnpm dev --watch   # Start dev mode with backend auto-reload
pnpm build         # Build all workspaces
pnpm start         # Run built production server
pnpm lint          # Run Biome checks
pnpm typecheck     # Build shared, then run TypeScript no-emit checks
pnpm test          # Run workspace unit tests
pnpm test:e2e      # Run client Playwright E2E tests
pnpm build:bundle  # Build npm bundle
pnpm build:windows # Build Windows double-click distribution
```

Run a single package or test with pnpm filters and Vitest path arguments:

```bash
pnpm --filter server test
pnpm --filter client test
pnpm --filter shared test
pnpm --filter relay test
pnpm --filter client test -- src/lib/__tests__/mergeMessages.test.ts
pnpm --filter server test:e2e
pnpm --filter server test:e2e:real
```

For site changes under `site/`:

```bash
pnpm site:build
```

## Development Runtime

`pnpm dev` runs `scripts/dev.js`, which starts both:

- `pnpm --filter server dev` for the Hono API/WebSocket server.
- `pnpm --filter client dev` for the Vite React dev server.

Ports derive from `PORT` (default `7777`):

| Port | Purpose |
| --- | --- |
| `PORT` | Main server and browser entrypoint |
| `PORT + 1` | Maintenance diagnostics server |
| `PORT + 2` | Vite dev server for frontend assets and HMR |

Open the app at `http://localhost:7777` by default; the Vite port is internal to development. Use `PORT=4000 pnpm dev` to shift all three ports. `MAINTENANCE_PORT` and `VITE_PORT` can override individual ports when needed.

Useful runtime flags and environment variables:

```bash
ENABLED_PROVIDERS=claude pnpm dev        # Expose only selected providers
VOICE_INPUT=false pnpm dev               # Disable voice input server-side
YEP_ANYWHERE_PROFILE=dev PORT=4000 pnpm dev
YEP_ANYWHERE_DATA_DIR=/path/to/data pnpm start
CLAUDE_CONFIG_DIR=/path/to/claude-config pnpm dev
```

Server state defaults to `~/.yep-anywhere/`; profile mode creates `~/.yep-anywhere-{profile}/`. By default sessions are scanned from `{CLAUDE_CONFIG_DIR}/projects/`, where `CLAUDE_CONFIG_DIR` defaults to `~/.claude`.

## Workspace Architecture

This is a pnpm workspace with packages under `packages/*`:

- `packages/server`: Hono-based Node server. `src/index.ts` wires config, logging, HTTP/HTTPS servers, WebSocket upgrades, static/proxy frontend serving, maintenance server, service instances, and graceful shutdown. `src/app.ts` builds the Hono app, security middleware, REST routes, WebSocket routes, provider scanners/readers, and the `Supervisor` that owns running agent processes.
- `packages/client`: React 19 + Vite frontend. `src/App.tsx` provides global contexts for auth, inbox, i18n, toast, schema validation, reload notifications, activity connection, and onboarding. Client code is organized around components, pages, hooks, API helpers, diagnostics, connection handling, and renderers for agent messages/tool calls.
- `packages/shared`: Cross-package schemas, types, protocol definitions, crypto helpers, session models, provider schemas, DAG ordering, upload types, and file path detection. Zod schemas in `src/claude-sdk-schema/` are the source of truth for Claude SDK/session JSONL data.
- `packages/relay`: Optional Hono/WebSocket relay server for remote access. It authenticates with SRP and relays only end-to-end encrypted NaCl ciphertext.
- `packages/desktop` and `packages/mobile`: Platform-specific wrappers/clients built around the same server/client concepts.

The server supports two connection modes: direct LAN/Tailscale WebSocket access and relay access. Relay mode uses SRP-6a for authentication and XSalsa20-Poly1305 via TweetNaCl for end-to-end encryption, so the relay sees opaque ciphertext only.

## Server Data, Logs, and Diagnostics

Important data files under `{dataDir}` include logs, indexes, uploads, session metadata, notifications, push subscriptions, VAPID keys, and auth state.

Logs are written under `{dataDir}/logs/` when file logging is enabled. Common diagnostics:

```bash
tail -f ~/.yep-anywhere/logs/server.log
curl http://localhost:7778/status
curl -X PUT http://localhost:7778/proxy/debug -d '{"enabled": true}'
curl -X PUT http://localhost:7778/log/level -d '{"console": "debug"}'
curl -X POST http://localhost:7778/inspector/open
curl -X POST http://localhost:7778/reload
```

Client-side browser console collection can be enabled from Developer Mode settings. It writes JSONL files to `{dataDir}/logs/client-logs/`. The implementation lives in `packages/client/src/lib/diagnostics/ClientLogCollector.ts` and `packages/server/src/routes/client-logs.ts`.

## Schema and Session Validation

Use these scripts after schema changes or when debugging raw SDK/tool data:

```bash
npx tsx scripts/validate-jsonl.ts
npx tsx scripts/validate-jsonl.ts /path/to/session.jsonl
npx tsx scripts/validate-tool-results.ts
npx tsx scripts/validate-tool-results.ts --summary
npx tsx scripts/validate-tool-results.ts --tool=Edit
```

Type-system conventions:

- Message identification should use `getMessageId(m)` (`uuid ?? id`).
- Prefer `message.content` over top-level `content`.
- Discriminate message shapes with the `type` field (`user`, `assistant`, `system`, `summary`).

## Testing Notes

After TypeScript or source changes, run the narrowest relevant checks first, then broader checks before declaring completion. For UI changes, use browser-based testing when possible. When an Android emulator is available, check with `source ~/.profile && adb devices` and deploy/test on the emulator for Android-related changes.

For local browser UI testing, use the claw-starter Playwright browser control from `~/code/claw-starter`:

```bash
cd ~/code/claw-starter && npx tsx lib/browser/server.ts &
npx tsx lib/browser-cli.ts open http://localhost:7777
npx tsx lib/browser-cli.ts snapshot --efficient
```

For Chromebook testing, use `~/code/chromeos-testbed/bin/chromeos`, not the local browser control tool.

## Server Architecture

`packages/server` uses a factory pattern: `createApp(options: AppOptions)` in `src/app.ts` builds the Hono app and returns `{ app, supervisor, scanner, readerFactory }`. All services are injected via `AppOptions`, making the server testable (tests provide `options.useMockSdk` or mock services).

### Route organization

Each route module in `src/routes/` exports a `createXxxRoutes(deps)` factory function—routes are never created at module scope. Dependencies are passed as a single object containing `readerFactory`, `config`, and service handles. The main API prefix is `/api`; `/health` is mounted outside `/api` with permissive CORS for the Tauri desktop app.

### Session readers and provider routing

A single `readerFactory(project)` returns the appropriate `ISessionReader` based on `project.provider`. Provider types include: `claude`, `claude-ollama`, `codex`, `codex-oss`, `gemini`, `gemini-acp`, `opencode`. Readers are cached in a `Map` with LRU eviction at 500 entries.

### EventBus and file watching

`src/watcher/EventBus.ts` is the in-memory pub/sub hub. `FileWatcher` instances watch each provider's session directories and publish change events. The EventBus feeds into `PushNotifier`, `ExternalSessionTracker`, `LifecycleWebhookService`, and `RemoteChannelService`. SSE activity routes (`/api/activity`) stream EventBus events to browser clients.

### Security middleware stack

Applied in order to `/api/*`: host-check (DNS rebinding protection), CORS (origin validation), custom-header CSRF (`X-Yep-Anywhere: true` required on mutating requests; NOT on GET/HEAD to allow native `EventSource`). Host validation is configurable at runtime via the settings API.

### Configuration

All server config flows through a single `loadConfig()` call in `src/config.ts` reading env vars. Notable env vars beyond those already documented:

| Variable | Purpose |
|:---------|:--------|
| `SERVE_FRONTEND=false` | API-only mode (no frontend proxy/static) |
| `HTTPS_SELF_SIGNED=true` | Auto-generate self-signed TLS cert |
| `MAX_WORKERS` / `MAX_QUEUE_SIZE` | Supervisor concurrency limits |
| `PERMISSION_MODE` | Default session permissions (`bypassPermissions` or `acceptEdits`) |
| `USE_MOCK_SDK=true` | Use mock SDK (for testing) |
| `AUTH_DISABLED=true` | Disable auth (recovery mode) |
| `DESKTOP_AUTH_TOKEN` | Tauri desktop app auth bypass |

## Client Architecture

`packages/client` is React 19 + Vite with no external state library. State lives in React contexts and custom hooks (60+ hooks in `src/hooks/`).

### Context provider hierarchy

Nesting order matters: `I18nProvider > ToastProvider > AuthProvider > InboxProvider > SchemaValidationProvider > AppContent`. AuthProvider manages SSE connection lifecycle—disconnects when unauthenticated.

### Connection abstraction

`src/lib/connection/` provides a `Connection` interface with three implementations:
- `DirectConnection` — standard fetch/XHR for local server access
- `WebSocketConnection` — API calls over WebSocket (relay mode)
- `SecureConnection` — SRP + NaCl end-to-end encryption (not re-exported from index to avoid crashes in non-secure HTTP contexts)

`isRemoteClient()` is a build-time check (`VITE_IS_REMOTE_CLIENT`); `isRemoteMode()` is a runtime check.

### Provider interface

`src/providers/` defines a `Provider` interface with `capabilities` (supportsDag, supportsCloning) and `metadata` (i18n-aware descriptions). `getProvider(id)` returns the provider or a safe `GenericProvider` fallback. Implementations in `src/providers/implementations/`: one class per provider.

### Routing

React Router v7 in `src/main.tsx`. Root `/` redirects to `/projects`. Login page is outside the layout. `NavigationLayout` wraps most pages. File and Activity pages have their own layouts. `basename` is configurable via Vite's `BASE_URL` (for stable UI at `/_stable/`). **Routes must be kept in sync between `main.tsx` and `remote-main.tsx`.**

### i18n

Custom lightweight system in `src/i18n.tsx`. Two locales: `en` (default, bundled synchronously) and `zh-CN` (lazy-loaded). `t(key, vars)` uses `{variableName}` placeholders. Locale persisted in localStorage.

### Styling

Pure CSS custom properties—no Tailwind. Design tokens in `src/styles/tokens/`: `colors.css`, `spacing.css`, `motion.css`, `layout.css`, `typography.css`. Three breakpoints: Mobile (<768px, bottom tab bar), Tablet (768–1099px, collapsible sidebar), Desktop (≥1100px, persistent sidebar). Theme support via `[data-theme="..."]` attribute. Provider-specific color tokens (`--provider-claude`, `--provider-codex`, etc.).

## Shared Package Conventions

`packages/shared` uses barrel exports from `src/index.ts`. Server and shared use `module: "NodeNext"` with `.js` extension imports; client uses `moduleResolution: "bundler"` (no `.js` extensions). Zod schemas in `src/claude-sdk-schema/`, `src/codex-schema/`, `src/gemini-schema/`, `src/opencode-schema/` are the source of truth for SDK session data. Vite resolves shared directly to TypeScript source via `resolve.conditions: ["source"]`.

## Build and Lint Configuration

- **TypeScript**: `strict: true`, `noUncheckedIndexedAccess: true`, `verbatimModuleSyntax: true` in `tsconfig.base.json`. All packages extend this base.
- **Biome**: Double quotes, semicolons always, 2-space indent. `noExplicitAny` is `warn`. Ignores generated code in `packages/server/generated/`.
- **Test isolation**: Server, client, and shared test scripts use `node ../../scripts/run-with-safe-home.js` to redirect HOME to a temp directory, preventing tests from polluting `~/.yep-anywhere/`.
- **Stable UI build** (`pnpm build:stable`): Builds client with `--base /_stable/ --outDir dist-stable` for emergency fallback, served from `/_stable/`.
- **Remote client build** (`pnpm build:remote`): Uses `vite.config.remote.ts` with `VITE_IS_REMOTE_CLIENT=true` for SecureConnection-based builds.
- **CSP**: `vite-plugin-csp` injects Content Security Policy (permissive in dev, strict with script hashes in prod).
- **Version**: Derived from `git describe --tags --always`, injected as `__APP_VERSION__`.

## Release Notes

The npm package is published as `yepanywhere` via GitHub Actions OIDC trusted publishing. Before an npm release, update `CHANGELOG.md`, commit it, tag `vX.Y.Z`, and push the tag. CI verifies the changelog entry, runs lint/typecheck/tests, builds with `pnpm build:bundle`, publishes with provenance, and creates a GitHub Release.

The website deploys separately from npm. Pushing to `main` does not deploy the site; deployment happens from a `site-v*` tag or manual workflow. Use `scripts/release-website.sh <version>` after updating `site/CHANGELOG.md`.

## Design System

Always read `DESIGN.md` before making visual or UI decisions. All font choices, colors, spacing, responsive behavior, and aesthetic direction are defined there. Do not deviate without explicit user approval. In QA mode, flag any code that does not match `DESIGN.md`.

## Repository-Specific Rules

- `AGENTS.md` points future agents back to this file as the source of truth.
- `.cursorrules` also treats this file as the canonical project context.
- Never mention Claude, AI, or an AI assistant in commit messages.
- Periodically run `pnpm audit --prod` and pay attention to the `web-push -> asn1.js -> bn.js` chain; keep the `bn.js` pnpm override until `web-push` ships an upstream fix.
