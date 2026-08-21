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
- **🧠 Smart summary**: a fast no-thinking model compresses the main conversation context into a small summary, injected together with the quoted selection in the first message
- **🔀 Three context strategies**: switch per ask between **inherit full history** (fork + prefix-cache hit), **compressed** and **trim** — from the in-panel selector or the configured default
- **🔗 Dedicated sessions**: each follow-up is a real DSH session in the same workspace (`❓<topic>`), continuable and archivable, with zero interruption to the main conversation
- **🪆 Nested follow-ups**: select text inside a follow-up conversation and ask again — follow-ups nest arbitrarily deep
- **🗂️ Follow-up records**: grouped under their root (main) session as a layered tree; scoped to the current workspace; nodes are collapsible and show last-activity time; the records tab stays open after jumping; archived/deleted follow-ups are **greyed out with a status badge** and can be removed from the records in one click (the whole subtree's mapping is pruned; the DSH session itself is untouched)
- **🏷️ Two-phase naming**: a placeholder title from the first quoted line → after the first answer, a topic distilled from “question + answer” overwrites it
- **⚙️ Configurable**: summary/answer model channels, reasoning effort, context windows and budgets — all editable from the settings gear popup
- **🌏 Bilingual (zh / en)**: UI copy and model-facing prompts follow the DSH language setting and switch live (no reload); **the answer language follows the content you ask about**, not the interface language

> 🔌 Built on **[dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)** as a third-party extension tab, registered through `ctx.betterSidebar.registerTab`; capability-equal to built-in tabs, install and go.

## Prerequisites (required)

`dsh-better-sidebar` **must be installed** (without it the plugin stays **inactive** — no UI, no behavior, no session creation), and it must be **`0.14.0+`** (matching **DSH `0.1.0-rc.8`**; DSH rc.7 and earlier cannot resolve this plugin's peer dependencies — upgrade DSH first).

```bash
dsh plugin --profile web add dsh-better-sidebar@latest
```

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
5. The sidebar's **Follow-ups** tab groups records under their root (main) session, listing every (nested) follow-up in the **current workspace** as a layered tree (membership resolved from the workspace owning the active session — see `src/client/history-scope.ts`); clicking a node jumps into it. Nodes with children carry a **collapse button** on the right (the chevron rotates with the collapse state) to fold the subtree, with that conversation group's **last-activity time** to its left (a relative label reusing the style and `sessions.list.updatedAt` source of the DSH left panel). After jumping, the target session's **Follow-ups tab stays open** (targeted `openTab(seed, scope)`: focused if already open, created if not). Follow-ups that were **archived or deleted** (when you manage sessions yourself) are **greyed out and badged “Archived / Deleted”**, are no longer clickable, and the row's **Remove** button clears them from the records (pruning the whole subtree from the localStorage mapping; the DSH session itself is unaffected).

## Configuration

Configuration lives in the DSH settings service under the `sidebarqa` namespace (settings.yaml or the settings page). **Web entry point**: DSH Settings → Side Cards → the gear popup in the top-right of the Follow-up card (provided by dsh-better-sidebar v0.12+ `settings.render`), where every field below is editable — text rows commit on blur/Enter, number rows clamp to their range, and writes go through `/sidebarqa/api/config.update` with a revision optimistic lock (a conflict across windows prompts a retry). The answer/summary channel and model rows are dropdowns fed from the channels configured at runtime.

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

> The panel surfaces only these 8 common settings; the compression/title internals (`summarizeBudgetTokens`, `recentWindowMessages`, `backgroundWindowMessages`, `titleBudgetTokens`) are not exposed there and keep their defaults, but stay settable in the `sidebarqa` namespace of `settings.yaml`.

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
    ├── index.tsx           apply: register 2 better-sidebar tabs + popover + locale dictionaries
    ├── selection.ts        selection capture & validation (single message / non-streaming / ≤2000 chars)
    ├── SelectionPopover.tsx floating “Ask” button
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
    ├── ensure-panel.ts      collapsed-panel self-heal: expansion decision + expand via SidebarStore (pure, tested)
    ├── tab-activation.ts    onActivate bridge: re-heal when a tab is re-activated after a manual collapse (issue #6)
    ├── locales.ts           zh/en UI dictionary + module-level t() (zero imports, tested)
    ├── use-locale.ts        useLocaleRevision(): re-render every panel root on a language switch
    ├── orchestrate.ts      create → placeholder rename → selectModel (default flash / thinking off) → prompt + continue + post-answer retitle
    ├── ConfigPanel.tsx      config gear popup (edits the sidebarqa namespace; answer/summary channel and model dropdowns)
    ├── config-fields.ts     config row declarations + number coercion + catalog option resolution (pure, tested)
    ├── store.ts            parent→child map (localStorage-persisted, nested) + pending quotes + titled marks
    ├── injection.ts        XML escape/sanitize + injection format + placeholder topic
    ├── answer.ts           history stream → answer text folding
    └── api.ts              /sidebarqa/api fetch wrapper + current-model reader
```

### Cross-plugin seam (meta.quote)

An external plugin can open the follow-up tab with a **pre-filled quote** (bypassing this plugin's selection popover) by carrying `meta` on better-sidebar's `openTab` seed:

```ts
ctx.betterSidebar.openTab(
  { type: 'dsh-sidebar-qa:ask', meta: { quote: { text: 'the selected content', role: 'user' } } },
)
```

The panel prefers `meta.quote` (shape-validated: `text` must be a non-empty string; `role` / `messageId` are optional pass-throughs) and falls back to the popover's pending quote. Once the user sends a question the quote is consumed (cleared via `updateTab`), so a refresh or refocus never resurrects an old one. The `<quoted_context>` block keeps `source="agent-history"`.

### Key data flow

```
select text ─▶ popover[Ask] ─▶ right panel (quote + bottom composer)
  Enter ─▶ ① host context: sessionQuery.readSurface(asked session) → llm fast no-thinking model compresses
           ② client creates the session sessions.create(workspaceId)
           ③ rename → "❓<placeholder from first quoted line>"
           ④ selectModel (default deepseek-v4-flash, thinking off)
           ⑤ prompt(summary block + <quoted_context> + question)
        ─▶ panel polls sessions.history and streams the transcript (no main-window jump)
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
pnpm test       # vitest (injection / summarize / answer / store / title / meta-quote / history-scope / history-time / model-menu / model-seat / context-meter / config / config-fields / ensure-panel / tab-activation / locales / prompt-locale)
pnpm typecheck
```

## Languages

Both the UI copy and the model-facing prompts follow **DSH's own language setting** (Settings → General → Language, i.e. `locale.preference` in `$DSH_HOME/settings.yaml`), falling back to the browser language and then to English. Switching takes effect **live** — no reload, no restart.

- **UI**: both tab titles (including already-open tabs), the selection popover, empty/status hints, the model seat, the context meter and the config panel. The dictionary is `src/client/locales.ts`; zh is the key-set source of truth and the en table is locked to it by its type annotation.
- **Model-facing**: the follow-up intro, the context-compression and title system prompts, and the structural markers those prompts name — all in `src/prompt-locale.ts`. The client sends a `locale` field to `/sidebarqa/api/context` and `/sidebarqa/api/title`; an **absent field means `zh`**, so a pre-i18n client talking to a new host behaves byte-for-byte as before.
- **The answer language follows the CONTENT, not the UI.** The prompts tell the model to answer in the language of the user's question, falling back to the quoted text — mirroring DSH's own session titler. Asking about an English paper from a Chinese UI still gets you an English answer.
- Follow-up sessions are titled `❓<topic>`: the emoji alone is the marker, so no language switch can leave your session list with mixed-language prefixes.

## License

MIT
