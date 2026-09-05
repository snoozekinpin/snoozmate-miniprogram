# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

好眠 SnoozMate — a WeChat Mini Program for a snore-guardian device ("月石床头主机", an ESP32 bedside host with dual mics, 24G mmWave radar, and an under-pillow vibration pad). All UI copy is Simplified Chinese.

This repo is the mini program **only**. The backend (`snoozmate-api`) lives elsewhere and is reached over WeChat Cloud Run.

## Commands

There is no `package.json`, no bundler, and no npm dependencies. Source runs as-is inside WeChat DevTools; tests are plain Node scripts run directly.

```bash
node tests/page-smoke.test.js      # loads all 18 pages against mock services, asserts each reaches a loaded state
node tests/real-contract.test.js   # real adapter contract: field mapping, caching, dedup, timeouts, cloud transport
SNOOZMATE_TEST_API_BASE=https://<host> node tests/real-http.integration.test.js  # hits a live backend; exits 2 without the env var
```

Run the first two before any commit — they are the whole regression suite. The integration test requires a reachable backend and is not part of the default loop.

To run the app: open the project root in WeChat DevTools (appid `wxbb905afee048fa00`, libVersion 2.32.3, `miniprogramRoot: ./`).

## Architecture

### Three layers, strict boundaries

```
pages/*/index.js   →  services/index.js  →  services/real|mock/index.js
     ↓                                              ↓
domain/*.js (pure, wx-free)  ←──────────────────────┘
```

- **`domain/`** — pure functions with no `wx` and no network. Clamping/validation (`limits.js`), state machines (`setup-machine.js`), classification (`ai-safety.js`, `attention-guidance.js`), error→copy mapping (`service-error.js`). Both pages and the mock service layer import from here. Put any logic worth unit-testing in `domain/`, not in a page.
- **`services/`** — the only place that talks to the backend or to `wx.request`/`wx.cloud`. Pages never construct URLs or touch tokens.
- **`pages/`** — WeChat `Page({})` definitions. Presentation, `setData`, navigation.

### The mock/real parity contract

`services/index.js` picks an implementation from `config/env.js` `serviceMode` and exports the chosen one. Both implementations must expose the **same five groups with the same method names and the same camelCase return shapes**:

| group | methods |
|---|---|
| `auth` | `login` `getProfile` `saveProfile` |
| `device` | `discover` `bind` `provisionWifi` `unbind` `getStatus` `runCalibration` `getTonightSettings` `saveTonightSettings` `getSoundState` `updateSound` `getLightState` `updateLight` `getDemoStates` `setDemoState` `applyTonightCandidate` `getActiveSettingsCommand` `getSettingsCommand` `reconcileSettingsCommand` |
| `reports` | `getLatest` `getEvents` `getSevenNightTrend` `submitFeedback` `getFeedback` |
| `ai` | `getOverview` `getRecords` `getChatSessions` `getChatSession` `saveChatSession` `getInterpretation` `ask` `getTonightCandidate` |
| `guardian` | `getSnapshot` `stopCurrentIntervention` `setDemoPhase` |

Adding or changing a service method means changing **both** `services/real/index.js` and `services/mock/index.js`. `tests/page-smoke.test.js` swaps in the mock group-by-group, so a shape drift there shows up as a page failure, not a clear service error.

`services/real/index.js` is the adapter: backend is snake_case, the app is camelCase. `s2c`/`c2s` do the shallow key translation; `normalizeSettings`/`normalizeSound`/`normalizeLight`/`normalizeCommand` clamp and default. Sensitivity is a UI 1–3 scale that maps to backend `snore_confidence_threshold` (0.75/0.65/0.55) via `toBackendSettings` — keep that mapping bidirectional with `normalizeSettings`.

Internal helpers are exported under `module.exports.__test__` for `tests/real-contract.test.js`. Add new helpers there rather than exporting them publicly.

### Transport

`config/env.js` `transport` decides how requests leave the device:

- `cloud-container` (production) — `wx.cloud.callContainer` with `X-WX-SERVICE: <cloudServiceName>`, never leaves the WeChat internal network. `app.js` `onLaunch` calls `services.initializeCloudContainer()` and stashes any failure as `globalData.cloudContainerError`.
- `public` — plain `wx.request` against `apiBaseUrl`. Debugging and the integration test only.

The `request()` helper in `services/real/index.js` enforces several invariants worth preserving:

- **Every transport failure settles exactly once** (`settled` / `attemptSettled` guards plus a watchdog that aborts the task).
- **GETs are deduplicated and cached** — 2.5s default TTL keyed on transport+token+path; concurrent identical GETs share one in-flight promise. Any non-GET clears the whole cache.
- **Writes are never retried.** Only GETs with `retryColdStart` get a single retry, and only on a timeout — backend idempotency is not guaranteed.
- **401 invalidates the session** (clears token + profile cache) and surfaces as `AUTH_EXPIRED`.

### Error handling

Services throw `Error` objects carrying a stable `error.code`. Pages convert with `toUserError(error, context)` from `domain/service-error.js`, render the result through the shared `<state-banner>` component, and route the banner's action through `runServiceErrorAction` (`retry` / `setup` → setup page / `reauth` → onboarding with `?reauth=1`).

Codes: `DEVICE_OFFLINE` `NOT_PROVISIONED` `AUTH_EXPIRED` `SYNC_TIMEOUT` `NETWORK_ERROR` `HTTP_5XX` `AI_CONSENT_REQUIRED` `NOT_CONFIGURED` `CLOUD_NOT_CONFIGURED`. A new code needs an entry in `errorDefinitions` (title/detail/retryable/action) plus the legacy-message regex in `readCode`, or it degrades to the generic `UNKNOWN` banner.

### Page conventions

- Data loading lives in a `load()` (or `loadData()`) method called from `onLoad`/`onShow`, so tests can invoke it directly on an instantiated definition.
- Pages keep `loading`, `error`, and often `partialError` in `data`. Partial failure is normal: `pages/home` fires six service calls through a `settle()` wrapper and renders whatever succeeded, keeping the previous value for anything that failed. Do not let one failing panel blank the page.
- Concurrent-load races are guarded with a monotonic `this._deviceRequestId` counter; stale responses are dropped.
- Retries capture `this._retryAction` so the banner can re-run the operation that actually failed.
- Every page registers `state-banner` in its `index.json` `usingComponents`.
- Report data must never block on the LLM — `reports.getLatest` requests `generate_ai=false`; AI text comes from the separate `ai.*` endpoints (35s timeouts).

### Onboarding gate and storage keys

All persisted state is `wx` storage under a `haomian-` prefix:

| key | meaning |
|---|---|
| `haomian-session` / `haomian-session-token` | session cache; token is the `Authorization: Bearer` value |
| `haomian-profile` | profile cache, loaded into `globalData.profile` at launch |
| `haomian-client-id` | generated once, stable client identifier |
| `haomian-device-id` / `haomian-device-serial` | bound device (falls back to `env.defaultDeviceId`) |
| `haomian-setup-complete` | gate: onboarding redirects to home when set |
| `haomian-setup-mode` | `'normal'` or `'demo'` |
| `haomian-demo-mode` | demo setup skipped real pairing |
| `haomian-calibration-success` | calibration marker consumed by `domain/readiness.js` |
| `haomian-ai-chat-sessions` | local chat history |

Flow: `onboarding` (login → profile/privacy) → `setup` (BLE search → connect → Wi-Fi provision, driven by `domain/setup-machine.js`) → `calibration` → `readiness` → `home`. `setup` also has a demo bypass (`?demo=1` or `haomian-demo-mode`) that sets `setup-mode: 'demo'` deliberately so a demo can never masquerade as a calibrated physical setup. `profile` clears all three gate keys to reset.

### AI flow and safety

`ai.*` methods call `requireAiAuthorization()` first, which reads the profile and throws `AI_CONSENT_REQUIRED` unless `aiDataAuthorized` is set. Never bypass this.

AI answers are always shaped as `{ text, sections: { canExplain, cannotDetermine, nextStep }, actions, answerKind, safetyClass }`. The mock classifies questions locally via `domain/ai-safety.js` (`urgent` / `medication` / `diagnosis` / `trend`); the real backend returns the classification. The product line is non-medical: AI explains recorded trends, explicitly refuses diagnosis and medication advice, and defers to a professional. Preserve the `cannotDetermine` section and the refusal copy when touching this path.

Applying an AI suggestion goes `ai.getTonightCandidate` → `device.applyTonightCandidate({ candidateId, expectedConfigVersion })` → poll `getSettingsCommand` / `reconcileSettingsCommand`. `expectedConfigVersion` is optimistic concurrency; a mismatch surfaces as `CONFIG_CONFLICT`. `domain/ai-candidate.js` enforces "gentle-only" candidates (vibration level and intervention count may only go down, sleep protection only up) — the mock validates with it; the real backend enforces it server-side.

## Styling

`app.wxss` holds the design tokens on `page` (`--ivory` `--paper` `--ink` `--muted` `--amber*` `--brown` `--olive` `--danger`) and the shared classes (`.page` `.card` `.primary-button` `.secondary-button` `.danger-button` `.section-title` `.chip` `.safe-note` `.empty-state` `.status-dot`). Reuse these rather than adding per-page colors; use `var(--x)`, never hardcoded hex. Sizes are `rpx`; headings use the Songti serif stack.

## Notes

- `sitemap.json` disallows indexing of every page — intentional.
- Sound scenes are local files: scene ids `sleep` / `healing` / `work` / `reading` map to `/audio/<id>.mp3`. Audio contexts must be paused in `onHide` and destroyed in `onUnload` (asserted by `real-contract.test.js`).
- ES modules are not used anywhere — everything is CommonJS `require`/`module.exports`, including page files.
