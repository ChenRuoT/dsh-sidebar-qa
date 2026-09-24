# dsh-sidebar-qa

<!-- Hero -->
<div align="center">
  <b style="font-size: 1.15em;">Select. Ask. Answer in the sidebar.</b><br /><br />
  <code>select-to-ask</code> <code>context summary</code> <code>nested follow-ups</code> <code>history tree</code> <code>zero interruption</code> <code>zh / en</code><br /><br />
  A <b>DeepSeek Harness (DSH) Web plugin</b>: <b>select any text in a conversation → click “Ask” → answer in the right-side panel</b> —<br />
  it creates a <b>dedicated DSH session in the same workspace</b> without interrupting the main conversation. The codex-style side ask / Claude Code `/btw` experience.
</div>

<div align="center">
  🌏 <a href="./README.md">中文</a> · <a href="./README_EN.md"><b>English</b></a>
</div>

<div align="center">
  <img alt="dsh-sidebar-qa demo" src="https://github.com/ChenRuoT/dsh-sidebar-qa/releases/download/v0.1.0/demo.gif" width="100%" />
</div>

## ✨ Features

- **📝 Select-and-ask**: select any text in a conversation → floating “Ask” button → an embedded Q&A in the right panel, without ever leaving the main window; **the panel auto-expands even when collapsed**, so “Ask” always gives visible feedback
- **💬 Add to chat**: the other button on the same popover appends the selection to the **current session's main composer** as a `>` blockquote and focuses it (caret on the line below), **without creating a session or opening the sidebar** — for when you just want to keep talking in place ([issue #11](https://github.com/ChenRuoT/dsh-sidebar-qa/issues/11))
- **🧠 Smart summary**: a fast no-thinking model compresses the main conversation context into a small summary, injected together with the quoted selection in the first message
- **🔀 Three context strategies**: switch per ask between **inherit full history** (fork + prefix-cache hit), **compressed** and **trim** — from the in-panel selector or the configured default
- **🔗 Dedicated sessions**: each follow-up is a real DSH session in the same workspace (`❓<topic>`), continuable and archivable, with zero interruption to the main conversation
- **🪆 Nested follow-ups**: select text inside a follow-up conversation and ask again — follow-ups nest arbitrarily deep
- **🗂️ Follow-up records**: grouped under their root (main) session as a layered tree; scoped to the current workspace; nodes are collapsible and show last-activity time; the records tab stays open after jumping; archived/deleted follow-ups are **greyed out with a status badge** and can be removed from the records in one click (the whole subtree's mapping is pruned; the DSH session itself is untouched)
- **🏷️ Two-phase naming**: a placeholder title from the first quoted line → after the first answer, a topic distilled from “question + answer” overwrites it
- **⚙️ Configurable**: summary/answer model channels, reasoning effort, context windows and budgets — the entry point is **DSH Settings → the “Follow-up” page in the left nav** (the panel registers as a `settings.section`); the `sidebarqa` namespace in `settings.yaml` still works and writes the same configuration
- **🌏 Bilingual (zh / en)**: UI copy and model-facing prompts follow the DSH language setting and switch live (no reload, **including the chip of an already-open tab**); **the answer language follows the content you ask about**, not the interface language

> 🔌 **Registers into DSH's OWN right sidebar only**: DSH **0.1.5-alpha.1 and newer** ships that sidebar (`@deepseek-ai/dsh-client-ui-sidebar-right`), and this plugin registers into it directly (the `ctx.sidebarRightTabs` / `ctx.sidebarRight` services plus the `sidebar.right.pane.tab` and `sidebar.right.pane.tab.title` seats) — **with no extra dependency**. `dsh-better-sidebar` support was removed entirely in 1.0.0. On an older DSH the plugin **still activates**: the selection popover and “Add to chat” keep working, only the sidebar tabs are not registered (and one `console.warn` is logged).

## 📦 Changelog

### 1.0.2 - 2026-09-24

**Fixes "opening the side panel reports `The panel failed to render: Minified React error #130 … but got: undefined`"**: DSH `0.1.7-alpha.1` renamed the whole host icon set from a size suffix to a stroke-weight suffix (`IconQuestionOutline14` → `IconQuestionOutlineRegular` / `…Medium`) with no aliases, so the glyphs this plugin imported by name were `undefined` at runtime and the panel's composer row threw React error #130 on its first render (the plugin's own boundary then contained it into the retryable strip you saw). Icons are now **resolved by name** (`Regular → Medium → legacy size-suffixed`), and a glyph the host does not have renders as nothing instead of crashing; typed API surfaces (`MarkdownText` / `Tooltip` / `Menu`) are still imported by name. **Client half only — a hard browser refresh is enough.**

### 1.0.0 - 2026-09-20

**The first 1.x: DSH's own right sidebar is the only backend, with zero extra dependencies.** The breaking change is the **removal of the `dsh-better-sidebar` backend** (below), which is why this is a major release: installing `dsh-sidebar-qa` is now all it takes.

- **`dsh-better-sidebar` support removed (breaking)**: there is no second backend and no extra dependency left; the `dsh-better-sidebar` peer dependency and its `peerDependenciesMeta` entry are gone (after `pnpm install`, `node-pty` / `protobufjs` disappear from the lockfile too).
  - DSH ≥ `0.1.5-alpha.1`: registers into DSH's own right sidebar. Docking, splitting, floating and fullscreen are DSH's business, so the plugin no longer expands the column by hand.
  - Older DSH: the plugin **still activates** — the selection popover and “Add to chat” work, only the sidebar tabs are missing (with one `console.warn`).
  - **An already-open tab's chip now follows a language switch**: the plugin registers a live title component into the `sidebar.right.pane.tab.title` seat (the chip used to freeze at the language it was opened in).
  - **New modules**: `src/client/ask-mode.ts` (panel view mode) and `src/client/show-session.ts` (put the target session on screen through `ctx.uiWorkspace.openSession`).
- **Both tab glyphs are back**: the guide (`+`) capsule and the tab chip now show the host's ❓ / queue icons again — the native port had dropped the `icon` field entirely, so the capsules were drawing the host's cube placeholder.
- **Archived / deleted follow-ups no longer take the panel down**: those switcher rows are greyed out, labelled and unclickable, and the default selection is “the newest follow-up that can actually be read”; if the follow-up being read is archived under you, the panel says so (with a “Remove” action) and disables the composer. Clicking one used to strand the panel on a session it could not read (an eternal “Generating…”).
- **The panel can no longer go permanently blank**: both known triggers are fixed (a renamed `MarkdownText` copy prop made any message with a **code block** throw while rendering; any render error used to retire the tab body for **every session on the page**) and the plugin now carries its own error boundary — a crash becomes a readable, retryable strip and the tab itself survives.
- **A batch of “type mirror invented an upstream member” failures fixed**: “Add to chat” never found its target session, the records-tree jump threw a `TypeError`, LAN access to `/sidebarqa/api` was always 403, reading an `assistant-stream` frame crashed, and more. See [CHANGELOG](./CHANGELOG.md).
- **The config panel now lives in DSH's own settings page**: `ConfigPanel` registers as a `settings.section` (`src/client/settings-slot.ts` for the registration, `src/client/settings-section.tsx` for the page), so the settings nav gains a **whole “Follow-up” page** (after every page DSH ships) and **the gear popup is gone**. Not `plugins.item`: that seat's contract reserves it for the host-plane configuration pages `ui-settings-plugins` ships, and it is unavailable whenever the deployment has no managed profile, which would take the config entry down with it.
- **Both halves changed** — host-side fixes to the `/sidebarqa/api` trust fence, and dependency changes (the `dsh-better-sidebar` peer is gone; the `@deepseek-ai/dsh-client-ui-primitives` type stub is pinned to `0.1.6-alpha.2`): run `pnpm install` again and restart `dsh web` after upgrading.

### 0.5.0 - 2026-08-29

- **Two-button selection popover ([issue #11](https://github.com/ChenRuoT/dsh-sidebar-qa/issues/11))**：the new **“Add to chat”** button appends the selection to the **current session's main composer** as a `>` blockquote and focuses it (caret on the line below), **without creating a session or opening the sidebar**; **“Ask”** is unchanged. Client-only change — a hard browser refresh is enough.

## Prerequisites

| Host DSH | Sidebar tabs | Selection popover / Add to chat |
|---|---|---|
| ≥ `0.1.5-alpha.1` (recommended) | ✅ registered into DSH's own right sidebar | ✅ |
| `0.1.2-alpha.1` ~ `0.1.4.x` | ❌ not registered (one `console.warn`) | ✅ |

- **The sidebar tabs need DSH ≥ `0.1.5-alpha.1`**: DSH's own right sidebar (`@deepseek-ai/dsh-client-ui-sidebar-right`) ships from that release. On earlier DSH the plugin is not inactive — the popover and “Add to chat” work exactly as before.
- The check is a **runtime structural probe** (are the services there), not a version comparison: the tabs register only once `sidebarRightTabs` / `sidebarRight` / `slots` are all present.
- `engines.dsh` still declares `>=0.1.2-alpha.1` (the floor for the browser-side RPC over `ctx.remote.session`), but **DSH does not validate `engines` at all** — it is a declaration, not a gate.
- **Persisting settings needs `dsh-settings` to still offer namespace registration** (≤ `0.1.5-rc.x`, i.e. today's npm `latest`): from `0.1.7-alpha.1` that API is gone (`SettingsForms` derives editable fields from the plugin's own `Config` schema and addresses `describe` / `update` by profile entry id). The plugin **probes for this structurally** and degrades quietly — follow-ups work exactly as before, every setting falls back to its default, and the only log line is one `console.info`. Keeping the settings card editable on 0.1.7+ needs the new model and is tracked separately ([issue #19](https://github.com/ChenRuoT/dsh-sidebar-qa/issues/19)).

## Install

```bash
# via npm (recommended)
dsh plugin --profile web add dsh-sidebar-qa

# or from a local path
dsh plugin --profile web add <this repo path>
```

Restart `dsh web` (host-half changes need a restart; client-half changes only need a browser hard refresh).

## Usage

1. In any conversation (main or a follow-up), select some text and click the floating **Ask** button. The panel auto-expands even when it is **collapsed** (see [issue #6](https://github.com/ChenRuoT/dsh-sidebar-qa/issues/6)), so the **Follow-up** tab is visible right away — including the repeat scenario “collapse the panel manually, then click Ask again”.
2. The right **Follow-up** panel becomes an **embedded conversation**: the quote/question streams its answer inside the sidebar with the composer pinned to the bottom of the panel — **it never jumps to the child session's main window**.
3. While the answer streams you can keep asking from the composer (Enter to send, Shift+Enter for a newline); all Q&A stays in the sidebar. The composer **reuses the look of DSH's main input bar** (the same rounded capsule card built from the same design tokens): starting a new follow-up puts the **context strategy** chip on the left, while the **model seat** (the same `session.models` / `selectModel` data as the main conversation, so switches are shared) and the **context meter** (reusing the `contextPressure` projection) sit on the right and are always visible — for a new ask they bind the **parent session being asked about** (the meter shows the parent's occupancy, which is exactly what tells you whether to inherit or trim). **The model seat never writes the main conversation**: for a new ask under compressed/trim it is a **local draft** showing the configured answer model (the one the child will really use), applied only after the follow-up session exists; for a new ask under inherit it is **read-only and greyed out** (a fork child keeps the parent's model — that is precisely what preserves the prefix cache; switch to compressed/trim to pick another model); when continuing an existing follow-up it binds that session and takes effect immediately. The **up-arrow send key** sits at the far right.
4. Every follow-up is still an independent session in the same workspace (`❓<topic>`), with zero interruption to the main conversation; follow-ups **nest** (select text inside a follow-up and ask to spawn a sub-follow-up). When starting a new ask, the **context strategy** chip on the left of the composer picks the strategy (defaulting to the configured `historyStrategy`):
   - **Inherit full history**: `sessions.fork` branches a child from the main session's latest completed turn, so the full history travels with the seed and the first request reuses the parent's message prefix → DeepSeek's **automatic prefix cache hits**, with zero compression loss; the child keeps the parent's model. While the main conversation is still answering (no completed turn), the fork automatically degrades to **compressed** and says so. In the follow-up tab the inherited parent history renders **above a divider**, the initial view is anchored on this follow-up's own “quote + question”, and scrolling up **pages in** the parent history (the same experience as the main conversation's “load earlier”).
   - **Compressed**: the fast model compresses the earlier window while the recent messages stay verbatim (default, token-thrifty).
   - **Trim**: the last `trimWindowMessages` messages verbatim — zero LLM cost, deterministic output.
5. The sidebar's **Follow-ups** tab groups records under their root (main) session, listing every (nested) follow-up in the **current workspace** as a layered tree (membership resolved from the workspace owning the active session — see `src/client/history-scope.ts`); clicking a node jumps into it. Nodes with children carry a **collapse button** on the right (the chevron rotates with the collapse state) to fold the subtree, with that conversation group's **last-activity time** to its left (a relative label reusing the style and `sessions.list.updatedAt` source of the DSH left panel). After jumping, the target session's **Follow-ups tab stays open** (the plugin first puts the target session on screen through `ctx.uiWorkspace.openSession`, then opens the records tab into its right sidebar). Follow-ups that were **archived or deleted** (when you manage sessions yourself) are **greyed out and badged “Archived / Deleted”**, are no longer clickable, and the row's **Remove** button clears them from the records (pruning the whole subtree from the localStorage mapping; the DSH session itself is unaffected).

## Configuration

Configuration lives in the DSH settings service under the `sidebarqa` namespace (settings.yaml or the DSH settings page).

> ℹ️ **The config panel lives in DSH's settings page.** The “functional config” panel (`src/client/ConfigPanel.tsx`) registers as a `settings.section`; the path is **Settings → the “Follow-up” page in the left nav** (ordered after every page DSH ships). It still edits the host's `sidebarqa` namespace (through this plugin's own `/sidebarqa/api/config.update`, with its revision optimistic lock), so **the `sidebarqa` namespace in `settings.yaml` remains valid — the two routes write the same configuration**.

Every key in the table below can be written straight into the `sidebarqa` namespace of `settings.yaml`. In the panel you can edit those fields row by row — text rows commit on blur/Enter, number rows clamp to their range, and writes go through `/sidebarqa/api/config.update` with a revision optimistic lock (a conflict across windows prompts a retry); the answer/summary channel and model rows are dropdowns fed from the channels configured at runtime. Hand-editing the YAML is exactly equivalent.

| Key | Default | Description |
|---|---|---|
| `historyStrategy` | `compressed` | Default context strategy: `inherit` full history (fork + prefix-cache hit) / `compressed` / `trim` (switchable per ask in the panel) |
| `trimWindowMessages` | `10` | How many recent messages the trim strategy keeps verbatim (1–256) |
| `summarizeProvider` | `''` | Summary fast-model channel; empty = inherit the asked session's provider |
| `summarizeModel` | `deepseek-v4-flash` | Summary fast no-thinking model |
| `summarizeReasoningEffort` | `off` | Summary reasoning effort (`off`/`high`/`max` dropdown) |
| `answerProvider` | `deepseek-official` | Follow-up answer model channel |
| `answerModel` | `deepseek-v4-flash` | Follow-up answer model |
| `answerReasoningEffort` | `off` | Follow-up reasoning effort (`off`/`high`/`max` dropdown) |

> The config panel (`config-fields.ts`) declares only those 8 common settings; the compression/title internals (`summarizeBudgetTokens`, `recentWindowMessages`, `backgroundWindowMessages`, `titleBudgetTokens`) are not exposed there and are settable only in the `sidebarqa` namespace of `settings.yaml`.

> The compressed mode's context injection is deliberately light: the older background is squeezed into **at most 3 sentences** (goal / current progress / open items), the recent band keeps only the last 2 messages with hard truncation (≤400 chars each), and the model receives them **newest-first** so the current progress lands in the strongest attention position. If summarization fails or no channel is available, it degrades to “recent conversation + quote + question” and the Q&A is never blocked; if inherit fails (the main conversation is mid-answer) it degrades to compressed.

## Architecture

```
dsh-sidebar-qa (bundle: dsh.bundle + package.json#dsh.client)
├── src/index.ts            host: /sidebarqa/api context + title service + sidebarqa settings namespace
├── src/summarize.ts        surface-text extraction + stream assembly (pure, tested)
├── src/title.ts            title prompt + normalization + Q+A input framing (pure, tested)
├── src/config.ts           settings schema + defaults
├── src/prompt-locale.ts    model-facing zh/en prompt bundles + question-marker registry (shared, pure, tested)
├── src/context-types.ts    structural cordis service faces + Context augmentation
└── src/client/             browser: selection capture, popover, ask panel, orchestration, records
    ├── index.tsx           apply: tab specs (`id` and `kind` declared separately) + popover + locale dictionaries + sidebar install
    ├── sidebar-native.ts   **the only sidebar module**: service probing + three-stage registration (type / body / live title) + opening by kind (with cross-frame confirmation after a navigation)
    ├── slots.ts            slot-registry probe (`ctx.get('slots')`; shared by the sidebar tabs and the settings page)
    ├── show-session.ts      put the target session on screen (`ctx.uiWorkspace.openSession`, tested)
    ├── current-session.ts  current-session rule: `retainedBy.mainView > 0` (pure, tested)
    ├── selection.ts        selection capture & validation (single message / non-streaming / ≤2000 chars)
    ├── SelectionPopover.tsx floating “Add to chat” / “Ask” buttons
    ├── quote-draft.ts       blockquote formatting + draft merge (pure)
    ├── draft-insert.ts      write the quote into the main composer (conversation service)
    ├── AskPanel.tsx         Follow-up tab (embedded conversation: streaming transcript + DSH-style composer + switcher)
    ├── HistoryPanel.tsx     Follow-ups tab (layered tree: collapse buttons + last-activity time + workspace scope + archived/deleted greying and removal)
    ├── history-scope.ts     workspace resolution + tree filtering + subtree last-activity + session status (live/archived/gone) and subtree removal (pure, tested)
    ├── history-time.ts      relative-time buckets + localized labels (pure, tested, left-panel style)
    ├── StrategySelect.tsx   context-strategy chip (PermissionSelect-style trigger + Menu)
    ├── ModelSelect.tsx      model seat (two-level menu, three modes: commit / draft / read-only)
    ├── model-menu.ts        catalog flattening/selection resolution + effective effort and no-op detection (pure, tested)
    ├── model-seat.ts        seat binding (which session it reads, commit vs draft, what it shows; pure, tested)
    ├── ContextMeter.tsx     context-occupancy ring (contextPressure projection + breakdown panel)
    ├── context-meter.ts     occupancy percentage / compact token formatting (pure, tested)
    ├── ask-mode.ts          panel view mode (`resolveAskMode`, pure, tested)
    ├── locales.ts           zh/en UI dictionary + module-level t() (zero imports, tested)
    ├── use-locale.ts        useLocaleRevision(): re-render every panel root on a language switch
    ├── orchestrate.ts      create → placeholder rename → selectModel (default flash / thinking off) → prompt + continue + post-answer retitle
    ├── settings-slot.ts     register the config panel as a DSH settings section (probe + retry, pure, tested)
    ├── settings-section.tsx the settings “Follow-up” page: heading + description + ConfigPanel
    ├── ConfigPanel.tsx      functional config panel (edits the `sidebarqa` namespace; rendered by the settings page's `settings.section`)
    ├── config-fields.ts     config row declarations + number coercion + catalog option resolution (pure, tested)
    ├── store.ts            parent→child map (localStorage-persisted, nested) + pending quotes + titled marks
    ├── injection.ts        XML escape/sanitize + injection format + placeholder topic
    ├── answer.ts           history stream → answer text folding
    └── api.ts              /sidebarqa/api fetch wrapper + current-model reader
```

### Cross-plugin seam (a pre-filled quote)

An external plugin can open the follow-up tab with a **pre-filled quote** (bypassing this plugin's selection popover). The payload rides the native sidebar's **per-open channel** — `ctx.sidebarRight.openTab(kind, { params })`, where `kind` is `ask` or `history`:

```ts
// open the Follow-up tab in a session's right sidebar with a quote attached
ctx.sidebarRight.openTab('ask', {
  params: { quote: 'the selected content', role: 'user' },
})

// just open the records tab
ctx.sidebarRight.openTab('history')
```

> ⚠️ `kind` is the **dispatch short name** (`ask` / `history`), NOT `dsh-sidebar-qa:ask` / `dsh-sidebar-qa:history` — those are the tab's **implementation ids** (the keys its seats register under). `openTab` looks the registry up by kind and throws `no tab type is registered as "…"` for anything else.

This plugin's own popover uses the same channel: `sidebar-native.ts` exposes an opener (`openAsk` / `openHistory`) and the popover calls `opener.openAsk({ sessionId }, { quote, role })`. There is **no** port export for third parties — the client-bundle purity gate forbids value-importing another feature plugin in the first place.

The panel prefers that incoming quote (shape-validated: `params.quote` must be a non-empty string; `role` / `messageId` are optional pass-throughs) and falls back to the popover's pending quote. A quote is delivered **exactly once per navigation**, so a refresh or refocus never resurrects an old one while a **second external open** still delivers its new quote (one navigation = one fresh occurrence). The `<quoted_context>` block keeps `source="agent-history"`.

> An already-open tab's chip **does** follow a language switch: the plugin registers a **component** into the `sidebar.right.pane.tab.title` seat (it subscribes to the locale revision and re-renders in place). On a host that does not declare that seat the chip falls back to the string captured at open time — stale in that language, but harmless.

### Key data flow

```
select text ─┬▶ popover[Add to chat] ─▶ current session’s main composer (> blockquote + focus)
             └▶ popover[Ask] ─▶ right panel (quote + bottom composer)
  Enter ─▶ ① host context: sessionQuery.readSurface(asked session) → llm fast no-thinking model compresses
           ② client creates the session sessions.create(workspaceId)
           ③ rename → "❓<placeholder from first quoted line>"
           ④ selectModel (default deepseek-v4-flash, thinking off)
           ⑤ prompt(summary block + <quoted_context> + question)
        ─▶ panel follows the session journal and streams the transcript (no main-window jump)
        ─▶ after the first turn/end ⑥ host title: Q+A truncated → llm fast no-thinking model distills the topic
          → rename overwrites to "❓<final topic>" (once; the placeholder survives a failure)
        ─▶ keep asking from the bottom composer; the main conversation is untouched; follow-ups nest
```

### First-message injection format

```
<overarching instruction: this is a sidebar follow-up, answer the selected text's topic directly…>

[Main conversation context]
[Background] <model-compressed older history, at most 3 sentences>
[Recent] <last 2 near-verbatim messages, ≤400 chars each>

<quoted_context source="agent-history" label="agent reply"
                message_id="<id>" role="assistant" turn="<n>">
<the quoted text>
</quoted_context>

Question: <user input>
```

The overarching instruction goes **first** in the input so the attention mechanism sets the frame “focus on the selected text” before the model reads the context; the user's question sits at the end, but the quoted text (`quoted_context`) and the instruction anchor the answer's scope together. Later messages inside a follow-up session carry no main-conversation context by default (only the first one does). Under a Chinese locale the same structure uses the zh markers (`【主对话上下文】` / `【背景】` / `【近期对话】` / `问题：`) — see [Languages](#languages).

## Build & test

```bash
pnpm install
pnpm build      # tsc declarations + tsdown (lib/index.js + lib/client.js + lib/client-registry.js)
pnpm test       # vitest (answer / ask-mode / config / config-fields / context-meter / current-session / draft-insert / history-scope / history-time / injection / locales / model-menu / model-seat / prompt-locale / quote-draft / session-wire / settings-section / sidebar-native / store / summarize / title)
pnpm typecheck
```

## Languages

Both the UI copy and the model-facing prompts follow **DSH's own language setting** (Settings → General → Language, i.e. `locale.preference` in `$DSH_HOME/settings.yaml`), falling back to the browser language and then to English. Switching takes effect **live** — no reload, no restart.

- **UI**: both tab titles (including already-open ones — guaranteed by the live-title component in the `sidebar.right.pane.tab.title` seat), the selection popover, empty/status hints, the model seat, the context meter and the config panel. The dictionary is `src/client/locales.ts`; zh is the key-set source of truth and the en table is locked to it by its type annotation.
- **Model-facing**: the follow-up intro, the context-compression and title system prompts, and the structural markers those prompts name — all in `src/prompt-locale.ts`. The client sends a `locale` field to `/sidebarqa/api/context` and `/sidebarqa/api/title`; an **absent field means `zh`**, so a pre-i18n client talking to a new host behaves byte-for-byte as before.
- **The answer language follows the CONTENT, not the UI.** The prompts tell the model to answer in the language of the user's question, falling back to the quoted text — mirroring DSH's own session titler. Asking about an English paper from a Chinese UI still gets you an English answer.
- Follow-up sessions are titled `❓<topic>`: the emoji alone is the marker, so no language switch can leave your session list with mixed-language prefixes.

## License

MIT
