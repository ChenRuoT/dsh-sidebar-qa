# dsh-sidebar-qa

<!-- Hero -->
<div align="center">
  <b style="font-size: 1.15em;">Select. Ask. Answer in the sidebar.</b><br /><br />
  <code>select-to-ask</code> <code>context summary</code> <code>nested follow-ups</code> <code>history tree</code> <code>zero interruption</code><br /><br />
  A <b>DeepSeek Harness (DSH) Web plugin</b>: <b>select any text in a conversation → click “提问” → ask in the right-side panel</b> —<br />
  it creates a <b>dedicated DSH session in the same workspace</b> without interrupting the main conversation. The codex-style side ask / Claude Code `/btw` experience.
</div>

<div align="center">
  🌏 <a href="./README.md">中文</a> · <a href="./README_EN.md"><b>English</b></a>
</div>

<div align="center">
  <img alt="dsh-sidebar-qa demo" src="https://github.com/ChenRuoT/dsh-sidebar-qa/releases/download/v0.1.0/demo.gif" width="100%" />
</div>

## ✨ Features

- **📝 Select-and-ask**: select any text in a conversation → floating “提问” button → an embedded Q&A in the right panel, without ever leaving the main window; **the panel auto-expands even when collapsed**, so 提问 always has visible feedback
- **🧠 Smart summary**: a fast no-thinking model compresses the main conversation context into a small summary, injected with the quoted selection in the first message
- **🔗 Dedicated sessions**: each follow-up is a real DSH session in the same workspace (`❓追问·<topic>`), continuable and archivable, with zero interruption to the main conversation
- **🪆 Nested follow-ups**: select text inside a follow-up conversation and ask again — follow-ups nest arbitrarily deep
- **🗂️ History tree**: follow-ups grouped under their root (main) session; scoped to the current workspace; nodes are collapsible, show last-activity time, and keep the history tab open after jumping
- **🏷️ Two-phase naming**: placeholder title from the first quoted line → after the first answer, a ≤15-char topic distilled from “question + answer” overwrites it
- **⚙️ Configurable**: summary/answer model channels, reasoning effort, context windows and budgets — all editable via the gear popup

> 🔌 Built on **[dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)** as a third-party extension tab, registered through `ctx.betterSidebar.registerTab`; capability-equal to built-in tabs, install and go.

## Prerequisites (required)

`dsh-better-sidebar` **must be installed** (without it the plugin stays **inactive** — no UI, no behavior, no session creation).

```bash
dsh plugin --profile web add dsh-better-sidebar
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

1. In any conversation (main or a follow-up), select some text and click the floating 「提问」 button. The panel auto-expands even when it is **collapsed** (see [issue #6](https://github.com/ChenRuoT/dsh-sidebar-qa/issues/6)) — the 「追问」 tab becomes visible right away, including the repeat scenario "collapse the panel manually, then click 提问 again".
2. The right 「追问」 panel becomes an **embedded conversation**: the quote/question streams the answer inside the sidebar, with the input box pinned at the bottom — **it never jumps to the child session's main window**.
3. While answering, keep typing follow-up questions in the input (Enter to send, Shift+Enter for a newline); all Q&A stays in the sidebar.
4. Every follow-up is still an independent session in the same workspace (`❓追问·<topic>`), with zero interruption to the main conversation; follow-ups **nest** (select text inside a follow-up and ask to spawn a sub-follow-up).
5. The 「追问记录」 tab groups follow-ups under their root (main) sessions as a layered tree scoped to the **current workspace** (membership resolved from the workspace owning the active session — see `src/client/history-scope.ts`); clicking a node jumps into it. Nodes with follow-ups carry a right-aligned **collapse button** (the chevron rotates with the collapse state) to fold the subtree, with the group's **last-activity time** to its left (compact relative label, same style and `sessions.list.updatedAt` source as the DSH left panel). After jumping, the target session's **history tab stays open** (targeted `openTab(seed, scope)`: focuses if already open, creates if not).

## Configuration

Configuration lives in the DSH settings service under the `sidebarqa` namespace (settings.yaml or the settings page). **Web entry point**: DSH Settings → Side Cards → the gear 「功能配置」 popup on the 「追问」 card (provided by dsh-better-sidebar v0.12+ `settings.render`), editing the fields below — text rows commit on blur/Enter, number rows clamp to their range, writes go through `/sidebarqa/api/config.update` with a revision optimistic lock (conflicts prompt a retry).

| Key | Default | Description |
|---|---|---|
| `summarizeProvider` | `''` | Summary fast-model channel; empty = inherit the asked session's provider |
| `summarizeModel` | `deepseek-v4-flash` | Summary fast no-thinking model |
| `summarizeReasoningEffort` | `off` | Summary reasoning effort (`off`/`high`/`max` dropdown) |
| `summarizeBudgetTokens` | `160` | Background-summary output budget (tokens) |
| `recentWindowMessages` | `2` | **Verbatim** recent messages kept (the current-state anchor, not model-compressed) |
| `backgroundWindowMessages` | `12` | Max older messages handed to the model for compression |
| `answerProvider` | `deepseek-official` | Follow-up answer model channel |
| `answerModel` | `deepseek-v4-flash` | Follow-up answer model |
| `answerReasoningEffort` | `off` | Follow-up reasoning effort (`off`/`high`/`max` dropdown) |
| `titleBudgetTokens` | `64` | Output budget for the post-answer retitle (tokens) |

> The context injection is deliberately light: old background is compressed to **at most 3 sentences** (goal / current progress / open items), the recent window keeps only the last 2 messages with heavy truncation (≤400 chars each); the model sees them **newest-first** so the current state lands in the strongest attention position. If summarization fails or no channel is available, it degrades to “recent conversation + quote + question” and the Q&A continues uninterrupted.

## Architecture

```
dsh-sidebar-qa (bundle: dsh.bundle + package.json#dsh.client)
├── src/index.ts            host: /sidebarqa/api summary + title service + sidebarqa settings namespace
├── src/summarize.ts        surface-text extraction + stream assembly (pure, tested)
├── src/title.ts            title prompt + normalization + Q&A input framing (pure, tested)
├── src/config.ts           settings schema + defaults
├── src/context-types.ts    structural cordis service faces + Context augmentation
└── src/client/             browser: selection capture, popover, ask panel, orchestration, history
    ├── index.tsx           apply: register 2 better-sidebar tabs + popover
    ├── selection.ts        selection capture & validation (single message / non-streaming / ≤2000 chars)
    ├── SelectionPopover.tsx floating 「提问」 button
    ├── AskPanel.tsx        追问 tab (embedded conversation: streaming transcript + bottom input + switcher)
    ├── HistoryPanel.tsx    追问记录 tab (tree: collapse buttons + last-activity time + workspace scope)
    ├── history-scope.ts    workspace resolution + tree filtering + subtree last-activity (pure, tested)
    ├── history-time.ts     relative-time buckets + zh labels (pure, tested, left-panel style)
    ├── ensure-panel.ts     collapsed-panel self-heal: expansion decision + expand via SidebarStore (pure, tested)
    ├── tab-activation.ts   onActivate bridge: re-heal when a tab is re-activated after a manual collapse (issue #6)
    ├── orchestrate.ts      create → placeholder rename → selectModel (default flash / thinking off) → prompt + continue + post-answer retitle
    ├── store.ts            parent→child map (localStorage-persisted, nested) + pending quotes + titled marks
    ├── injection.ts        XML escape/sanitize + injection format + placeholder topic
    ├── answer.ts           history stream → answer text folding
    └── api.ts              /sidebarqa/api fetch wrapper + current-model reader
```

### Key data flow

```
select text ─▶ popover[提问] ─▶ right panel (quote + bottom input)
  Enter ─▶ ① host summary: sessionQuery.readSurface(asked session) → fast no-thinking model compresses
           ② client creates session sessions.create(workspaceId)
           ③ rename → "❓追问·<placeholder from first quoted line>"
           ④ selectModel (default deepseek-v4-flash, thinking off)
           ⑤ prompt(summary block + <quoted_context> + question)
        ─▶ panel polls sessions.history and streams the transcript (no main-window jump)
        ─▶ after the first turn/end ⑥ host title: Q&A truncated → fast no-thinking model distills ≤15-char topic
          → rename overwrites to "❓追问·<final topic>" (once; placeholder survives failure)
        ─▶ keep asking from the bottom input; main conversation untouched; follow-ups nest
```

### First-message injection format

```
<overarching instruction: this is a sidebar follow-up, answer directly around the selected text…>

【main conversation context】
【background】<model-compressed older history, at most 3 sentences>
【recent】<last 2 verbatim messages, ≤400 chars each>

<quoted_context source="agent-history" label="Agent 回复"
                message_id="<id>" role="assistant" turn="<n>">
<quoted text>
</quoted_context>

Question: <user input>
```

The overarching instruction goes **first** so the attention mechanism sets “focus on the selected text” before reading context; the user question sits at the end, but the quoted text (`quoted_context`) plus the instruction anchor the answer scope together. Later messages inside a follow-up session carry no main-context by default (only the first message does).

## Build & test

```bash
pnpm install
pnpm build      # tsc declarations + tsdown (lib/index.js + lib/client.js + lib/client-registry.js)
pnpm test       # vitest (injection / summarize / answer / store / title / meta-quote / history-scope / history-time / model-menu / context-meter / config / ensure-panel / tab-activation)
pnpm typecheck
```

## License

MIT
