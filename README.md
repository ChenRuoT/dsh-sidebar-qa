# dsh-sidebar-qa

<!-- Hero -->
<div align="center">
  <b style="font-size: 1.15em;">划选即问，侧边栏内嵌问答</b><br /><br />
  <code>划选提问</code> <code>上下文摘要</code> <code>嵌套追问</code> <code>追问记录</code> <code>零打断</code><br /><br />
  <b>DeepSeek Harness（DSH）Web 插件</b>：在对话里<b>划选任意文本 → 点击「提问」→ 右侧面板问答</b>——<br />
  自动创建<b>同工作区的独立 DSH 会话</b>，主对话零打断。实现类 codex 侧边提问 / Claude Code `/btw` 功能。
</div>

<div align="center">
  🌏 <a href="./README.md"><b>中文</b></a> · <a href="./README_EN.md">English</a>
</div>

<div align="center">
  <img alt="dsh-sidebar-qa demo" src="https://github.com/ChenRuoT/dsh-sidebar-qa/releases/download/v0.1.0/demo.gif" width="100%" />
</div>

## ✨ 功能一览

- **📝 划选提问**：对话中划选任意文本 → 浮层「提问」→ 右侧面板内嵌问答，全程不跳转大窗口
- **🧠 智能摘要**：快速无思考模型把主对话上下文压缩成小摘要，与划选引文一起注入首条消息
- **🔗 独立会话**：自动创建同工作区独立 DSH 会话（`❓追问·<主题>`），可继续、可归档，主对话零打断
- **🪆 嵌套追问**：在追问对话里再划选提问，生成子追问，层层嵌套
- **🗂️ 追问记录**：按根（主）会话分层树展示；限定当前工作区；节点可折叠、显示最近访问时间；点击跳转后追问记录 tab 保持开启
- **🏷️ 两段式命名**：划选首行占位命名 → 首次回答完成后基于「问题 + 回答」自动提炼 ≤15 字最终标题
- **⚙️ 可配置**：摘要/回答模型渠道、思考模式、上下文窗口与预算全部可调（设置页齿轮弹窗）

> 🔌 **基于 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 开发的第三方拓展 Tab**，通过 `ctx.betterSidebar.registerTab` 注册；能力对等内置 tab，安装即用。

## 前置依赖（必装）

`dsh-better-sidebar` **必须安装**（未安装时本插件**不激活**，无任何 UI/行为，也不创建会话）。

```bash
dsh plugin --profile web add dsh-better-sidebar
```

## 安装

```bash
# 通过 npm（推荐）
dsh plugin --profile web add dsh-sidebar-qa

# 或本地路径
dsh plugin --profile web add <本仓库路径>
```

重启 `dsh web`（host 半改动需要重启；client 改动浏览器硬刷新即可）。

## 使用

1. 在任意对话（主对话或追问对话）中划选一段文本，点击浮层「提问」。
2. 右侧「追问」面板变成一条**内嵌对话**：引文/问题在侧边栏内流式回答，输入框固定在下方面板底部，**不会跳转到子对话大窗口**。
3. 回答过程中可在输入框继续追问（Enter 发送、Shift+Enter 换行），所有问答都在侧边栏内完成。
4. 每个追问仍是同工作区的独立会话（`❓追问·<主题>`），主对话零打断；追问可以**嵌套**（在追问对话里再划选提问会生成新的子追问）。
5. 侧边栏「追问记录」tab 按根（主）会话分组，以分层树列出**当前工作区**内的所有（嵌套）追问（归属判定：当前会话所在工作区，见 `src/client/history-scope.ts`），点击跳转。有子追问的节点右侧有**折叠按钮**（箭头随折叠状态旋转）收纳子树，其左侧显示该对话组**最近访问时间**（相对标签，复用 DSH 左侧面板的样式与数据源 `sessions.list.updatedAt`）。跳转后目标会话的**追问记录 tab 保持开启**（定向 `openTab(seed, scope)`，已打开则聚焦、未打开则新建）。

## 配置

配置走 DSH 设置服务 `sidebarqa` 命名空间（settings.yaml 或设置页）。**Web 界面入口**：DSH 设置 → 侧边卡片 → 「追问」卡片右上角的齿轮「功能配置」弹窗（由 dsh-better-sidebar v0.12+ 的 `settings.render` 提供），可逐项编辑下表字段——文本行 blur/Enter 提交，数字行按区间钳制，写入经 `/sidebarqa/api/config.update` 带 revision 乐观锁（多窗口冲突时提示重试）。

| 键 | 默认 | 说明 |
|---|---|---|
| `summarizeProvider` | `''` | 摘要快速模型渠道；空 = 继承被追问会话的 provider |
| `summarizeModel` | `deepseek-v4-flash` | 摘要快速无思考模型 |
| `summarizeReasoningEffort` | `off` | 摘要思考模式（`off`/`high`/`max` 三档下拉） |
| `summarizeBudgetTokens` | `160` | 背景摘要输出预算（tokens） |
| `recentWindowMessages` | `2` | **近原文**保留的最近消息条数（当前状态锚点，不经过模型） |
| `backgroundWindowMessages` | `12` | 交给模型压缩的较早消息条数上限 |
| `answerProvider` | `deepseek-official` | 子对话回答模型渠道 |
| `answerModel` | `deepseek-v4-flash` | 子对话回答模型 |
| `answerReasoningEffort` | `off` | 子对话思考模式（`off`/`high`/`max` 三档下拉） |
| `titleBudgetTokens` | `64` | 回答完成后重命名标题的输出预算（tokens） |

> 上下文注入刻意保持轻量：旧背景压成**最多 3 句话**（目标 / 当前进度 / 未决事项），近期只保留最近 2 条且每段强截断（≤400 字符）；模型侧**从新到旧**提交，让当前进度落在注意力最强位置。摘要失败/无渠道时自动降级为「仅近期对话 + 引文 + 问题」，问答不中断。

## 架构

```
dsh-sidebar-qa (bundle: dsh.bundle + package.json#dsh.client)
├── src/index.ts            host：/sidebarqa/api 摘要 + 标题服务 + sidebarqa 设置命名空间
├── src/summarize.ts        表面文本抽取 + 流组装（纯函数，可测）
├── src/title.ts            标题提示词 + 规范化 + Q+A 输入框定（纯函数，可测）
├── src/config.ts           设置 schema + 默认值
├── src/context-types.ts    结构化 cordis 服务面 + Context 增补
└── src/client/             浏览器：选区捕获、浮层、问答面板、会话编排、追问记录
    ├── index.tsx           apply：注册 2 个 better-sidebar tab + 浮层
    ├── selection.ts        选区捕获与校验（单消息/非流式/≤2000 字符）
    ├── SelectionPopover.tsx 划选浮层「提问」按钮
    ├── AskPanel.tsx         追问 tab（内嵌对话：流式 transcript + 底部输入框 + 追问切换）
    ├── HistoryPanel.tsx     追问记录 tab（分层树：折叠按钮 + 最近访问时间 + 工作区限定）
    ├── history-scope.ts     工作区归属解析 + 树过滤 + 子树最近访问时间（纯函数，可测）
    ├── history-time.ts      相对时间分桶 + 中文标签（纯函数，可测，复用左侧面板样式）
    ├── orchestrate.ts      create → 占位 rename → selectModel(默认 flash/关思考) → prompt + 继续追问 + 回答后重命名
    ├── store.ts            父→子 映射（localStorage 持久化，支持嵌套）+ 待提问引文 + 已命名标记
    ├── injection.ts        XML 转义/消毒 + 注入格式 + 占位主题生成
    ├── answer.ts           历史流 → 回答文本折叠
    └── api.ts              /sidebarqa/api fetch 封装 + 当前模型读取
```

### 关键数据流

```
划选文本 ─▶ 浮层[提问] ─▶ 右侧面板(引文 + 底部输入框)
  回车 ─▶ ① host 摘要：sessionQuery.readSurface(被追问会话) → llm 快速无思考模型压缩
          ② client 创建会话 sessions.create(workspaceId)
          ③ rename → "❓追问·<划选文本首行占位>"
          ④ selectModel(默认 deepseek-v4-flash, 思考关闭)
          ⑤ prompt(摘要块 + <quoted_context> + 问题)
        ─▶ 面板轮询 sessions.history 流式渲染 transcript（不跳转大窗口）
        ─▶ 首次 turn/end 后 ⑥ host 标题：Q+A 截断 → llm 快速无思考模型提炼 ≤15 字主题
          → rename 覆盖为 "❓追问·<最终主题>"（仅一次，失败保留占位）
        ─▶ 底部输入框继续追问；主对话零影响；追问可嵌套
```

### 上下文注入格式（首条消息）

```
<统领性指令：这是「侧边栏追问」，只围绕划选文本主题直接回答……>

【主对话上下文】
【背景】<模型压缩的旧历史，最多 3 句话>
【近期对话】<最近 2 条近原文，每条 ≤400 字符>

<quoted_context source="agent-history" label="Agent 回复"
                message_id="<id>" role="assistant" turn="<n>">
<引文原文>
</quoted_context>

问题：<用户输入>
```

统领性指令置于**输入最前**，利用注意力机制让模型先定调「聚焦划选文本」再读上下文；用户问题虽然在输入末尾，但划选文本（`quoted_context`）与指令共同锚定了回答范围。追问会话内的后续消息默认不带主对话上下文（只有首条携带）。

## 构建与测试

```bash
pnpm install
pnpm build      # tsc 声明 + tsdown（lib/index.js + lib/client.js + lib/client-registry.js）
pnpm test       # vitest 单测（injection / summarize / answer / store / history-scope / history-time）
pnpm typecheck
```

## License

MIT
