# dsh-sidebar-qa

<!-- Hero -->
<div align="center">
  <b style="font-size: 1.15em;">划选即问，侧边栏内嵌问答</b><br /><br />
  <code>划选提问</code> <code>上下文摘要</code> <code>嵌套追问</code> <code>追问记录</code> <code>零打断</code> <code>中英双语</code><br /><br />
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

- **📝 划选提问**：对话中划选任意文本 → 浮层「提问」→ 右侧面板内嵌问答，全程不跳转大窗口；**侧边栏面板收起时也会自动展开**，「提问」永远有可见反馈
- **🧠 智能摘要**：快速无思考模型把主对话上下文压缩成小摘要，与划选引文一起注入首条消息
- **🔀 三种上下文策略**：每次提问可在「全量继承（fork+缓存命中）/ 压缩 / 机械裁切」间切换，面板内选择器 + 配置默认值双入口
- **🔗 独立会话**：自动创建同工作区独立 DSH 会话（`❓<主题>`），可继续、可归档，主对话零打断
- **🪆 嵌套追问**：在追问对话里再划选提问，生成子追问，层层嵌套
- **🗂️ 追问记录**：按根（主）会话分层树展示；限定当前工作区；节点可折叠、显示最近访问时间；点击跳转后追问记录 tab 保持开启；已归档/已删除的追问**置灰标记状态**，可一键从记录中移除（连同整棵子树清理映射，不影响 DSH 侧会话）
- **🏷️ 两段式命名**：划选首行占位命名 → 首次回答完成后基于「问题 + 回答」自动提炼 ≤15 字最终标题
- **⚙️ 可配置**：摘要/回答模型渠道、思考模式、上下文窗口与预算全部可调（设置页齿轮弹窗）
- **🌏 中英双语**：界面文案与模型侧提示词跟随 DSH 语言设置实时切换（无需刷新）；**回答语言跟随你提问/划选的内容**，不被界面语言绑架

> 🔌 **基于 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 开发的第三方拓展 Tab**，通过 `ctx.betterSidebar.registerTab` 注册；能力对等内置 tab，安装即用。

## 前置依赖（必装）

`dsh-better-sidebar` **必须安装**（未安装时本插件**不激活**，无任何 UI/行为，也不创建会话），且需 **`0.14.0+`**（对应 **DSH `0.1.0-rc.8`**；rc.7 及更早的 DSH 环境无法解析本插件的 peer 依赖，请先升级 DSH）。

```bash
dsh plugin --profile web add dsh-better-sidebar@latest
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

1. 在任意对话（主对话或追问对话）中划选一段文本，点击浮层「提问」。即使右侧面板处于**收起**状态也会自动展开（对应 [issue #6](https://github.com/ChenRuoT/dsh-sidebar-qa/issues/6)），「追问」tab 直接可见——包括"先手动收起面板、再点提问"的重复场景。
2. 右侧「追问」面板变成一条**内嵌对话**：引文/问题在侧边栏内流式回答，输入框固定在下方面板底部，**不会跳转到子对话大窗口**。
3. 回答过程中可在输入框继续追问（Enter 发送、Shift+Enter 换行），所有问答都在侧边栏内完成。面板底部的**输入框复用 DSH 主对话的输入栏外观**（同一套设计 token 的圆角胶囊卡片）：发起新追问时左侧是**上下文策略** chip，右侧的**模型选择**（与主对话同一份 `session.models/selectModel` 数据，切换互通）与 **context 占用环**（复用 `contextPressure` 投影）始终可见——新追问时它们绑定**被追问的父会话**（context 环即父会话占用，可据此判断用全量还是裁切）。**模型座不会写主对话**：新追问 + 压缩/裁切时它是**本地草稿**，默认显示配置里的回答模型（子会话真正会用的那个），你的选择只在追问会话建好后应用；新追问 + 全量继承时**只读置灰**（fork 子会话沿用主对话模型，正是前缀缓存命中的前提，如需换模型请改用压缩/裁切）；继续已有追问时绑定该追问会话并直接生效。最右侧为**上箭头发送键**。
4. 每个追问仍是同工作区的独立会话（`❓<主题>`），主对话零打断；追问可以**嵌套**（在追问对话里再划选提问会生成新的子追问）。发起新追问时，输入框左侧的**上下文策略** chip 可选择策略（默认取配置 `historyStrategy`）：
   - **全量继承**：`sessions.fork` 从主会话最近的已完成 turn 分叉子会话，完整历史随种子继承，首条请求复用主会话消息前缀 → DeepSeek **自动前缀缓存命中**、零压缩损失；子会话沿用主会话模型。主对话正在回答（无已完成 turn）时 fork 自动降级为「压缩」并提示。追问 tab 中，继承的父对话历史显示在**分割条上方**，默认视图锚定在本追问自己的「引用 + 提问」处，**向上滚动分页加载**父对话历史（与主对话「加载更早」体验一致）。
   - **压缩**：快速模型压缩较早窗口 + 近期原文保留（默认，省 token）。
   - **机械裁切**：最后 `trimWindowMessages` 条消息原文直取，零 LLM 成本、确定性输出。
5. 侧边栏「追问记录」tab 按根（主）会话分组，以分层树列出**当前工作区**内的所有（嵌套）追问（归属判定：当前会话所在工作区，见 `src/client/history-scope.ts`），点击跳转。有子追问的节点右侧有**折叠按钮**（箭头随折叠状态旋转）收纳子树，其左侧显示该对话组**最近访问时间**（相对标签，复用 DSH 左侧面板的样式与数据源 `sessions.list.updatedAt`）。跳转后目标会话的**追问记录 tab 保持开启**（定向 `openTab(seed, scope)`，已打开则聚焦、未打开则新建）。被**归档或删除**的追问（用户自行管理会话时）会**置灰并标注「已归档 / 已删除」**，不可再点击跳转，行尾的「移除」按钮将其从记录中清除（连同整棵子树清理 localStorage 映射，DSH 侧会话本身不受影响）。

## 配置

配置走 DSH 设置服务 `sidebarqa` 命名空间（settings.yaml 或设置页）。**Web 界面入口**：DSH 设置 → 侧边卡片 → 「追问」卡片右上角的齿轮「功能配置」弹窗（由 dsh-better-sidebar v0.12+ 的 `settings.render` 提供），可逐项编辑下表字段——文本行 blur/Enter 提交，数字行按区间钳制，写入经 `/sidebarqa/api/config.update` 带 revision 乐观锁（多窗口冲突时提示重试）。回答/摘要的模型渠道与模型为下拉框，选项来自运行时已配置的渠道。

| 键 | 默认 | 说明 |
|---|---|---|
| `historyStrategy` | `compressed` | 默认上下文策略：`inherit` 全量继承（fork+缓存命中）/ `compressed` 压缩 / `trim` 机械裁切（面板内可逐次切换） |
| `trimWindowMessages` | `10` | 机械裁切模式保留的最近消息条数（1–256） |
| `summarizeProvider` | `''` | 摘要快速模型渠道；空 = 继承被追问会话的 provider |
| `summarizeModel` | `deepseek-v4-flash` | 摘要快速无思考模型 |
| `summarizeReasoningEffort` | `off` | 摘要思考模式（`off`/`high`/`max` 三档下拉） |
| `answerProvider` | `deepseek-official` | 子对话回答模型渠道 |
| `answerModel` | `deepseek-v4-flash` | 子对话回答模型 |
| `answerReasoningEffort` | `off` | 子对话思考模式（`off`/`high`/`max` 三档下拉） |

> 面板只展示上述 8 项常用设置；压缩/标题的内部调参键（`summarizeBudgetTokens`、`recentWindowMessages`、`backgroundWindowMessages`、`titleBudgetTokens`）不在面板暴露，仍可在 `settings.yaml` 的 `sidebarqa` 命名空间里配置。

> 压缩模式的下上文注入刻意保持轻量：旧背景压成**最多 3 句话**（目标 / 当前进度 / 未决事项），近期只保留最近 2 条且每段强截断（≤400 字符）；模型侧**从新到旧**提交，让当前进度落在注意力最强位置。摘要失败/无渠道时自动降级为「仅近期对话 + 引文 + 问题」，问答不中断；全量继承失败（主对话正在回答）时自动降级为压缩模式。

## 架构

```
dsh-sidebar-qa (bundle: dsh.bundle + package.json#dsh.client)
├── src/index.ts            host：/sidebarqa/api 摘要 + 标题服务 + sidebarqa 设置命名空间
├── src/summarize.ts        表面文本抽取 + 流组装（纯函数，可测）
├── src/title.ts            标题提示词 + 规范化 + Q+A 输入框定（纯函数，可测）
├── src/config.ts           设置 schema + 默认值
├── src/prompt-locale.ts    模型侧 zh/en 提示词词表 + 问题标记注册表（两半共享，纯函数，可测）
├── src/context-types.ts    结构化 cordis 服务面 + Context 增补
└── src/client/             浏览器：选区捕获、浮层、问答面板、会话编排、追问记录
    ├── index.tsx           apply：注册 2 个 better-sidebar tab + 浮层 + locale 词典
    ├── selection.ts        选区捕获与校验（单消息/非流式/≤2000 字符）
    ├── SelectionPopover.tsx 划选浮层「提问」按钮
    ├── AskPanel.tsx         追问 tab（内嵌对话：流式 transcript + DSH 风格输入卡片 + 追问切换）
    ├── HistoryPanel.tsx     追问记录 tab（分层树：折叠按钮 + 最近访问时间 + 工作区限定 + 归档/删除置灰与移除）
    ├── history-scope.ts     工作区归属解析 + 树过滤 + 子树最近访问时间 + 会话状态判定（live/archived/gone）与子树移除（纯函数，可测）
    ├── history-time.ts      相对时间分桶 + 本地化标签（纯函数，可测，复用左侧面板样式）
    ├── StrategySelect.tsx   上下文策略 chip（PermissionSelect 同款触发器 + Menu）
    ├── ModelSelect.tsx      模型选择（双层菜单三态：提交 / 草稿 / 只读）
    ├── model-menu.ts        模型目录扁平化/选中解析 + 有效强度与去重判定（纯函数，可测）
    ├── model-seat.ts        模型座绑定（读哪个会话、提交还是草稿、显示什么，纯函数，可测）
    ├── ContextMeter.tsx     context 占用环（contextPressure 投影 + breakdown 面板）
    ├── context-meter.ts     占用百分比/紧凑 token 格式化（纯函数，可测）
    ├── ensure-panel.ts      面板收起自愈：展开判定 + 经 SidebarStore 展开（纯函数，可测）
    ├── tab-activation.ts    onActivate 激活桥：收起后重新激活 tab 时再次自愈（issue #6）
    ├── locales.ts           界面 zh/en 词表 + 模块级 t()（零依赖，可测）
    ├── use-locale.ts        useLocaleRevision()：语言切换时重渲染各面板根
    ├── orchestrate.ts      create → 占位 rename → selectModel(默认 flash/关思考) → prompt + 继续追问 + 回答后重命名
    ├── ConfigPanel.tsx       功能配置面板（设置齿轮弹窗：编辑 sidebarqa 命名空间，回答/摘要模型渠道与模型下拉）
    ├── config-fields.ts      配置面板行声明 + 数字钳制 + catalog 选项解析（纯函数，可测）
    ├── store.ts            父→子 映射（localStorage 持久化，支持嵌套）+ 待提问引文 + 已命名标记
    ├── injection.ts        XML 转义/消毒 + 注入格式 + 占位主题生成
    ├── answer.ts           历史流 → 回答文本折叠
    └── api.ts              /sidebarqa/api fetch 封装 + 当前模型读取
```

### 跨插件 seam（meta.quote）

外部插件可以打开追问 tab 并**预填引文**（不经本插件的划选浮层）：通过 better-sidebar 的 `openTab` seed 携带 `meta`：

```ts
ctx.betterSidebar.openTab(
  { type: 'dsh-sidebar-qa:ask', meta: { quote: { text: '选中的内容', role: 'user' } } },
)
```

面板优先显示 `meta.quote`（形状校验：`text` 为非空字符串；可选透传 `role` / `messageId`），回退到本插件浮层的 pending 引文；用户输入问题发送后引文即被消费（`updateTab` 清除），刷新/再次聚焦不会复现旧引文。`<quoted_context>` 的 `source` 标签沿用 `agent-history`。

### 关键数据流

```
划选文本 ─▶ 浮层[提问] ─▶ 右侧面板(引文 + 底部输入框)
  回车 ─▶ ① host 摘要：sessionQuery.readSurface(被追问会话) → llm 快速无思考模型压缩
          ② client 创建会话 sessions.create(workspaceId)
          ③ rename → "❓<划选文本首行占位>"
          ④ selectModel(默认 deepseek-v4-flash, 思考关闭)
          ⑤ prompt(摘要块 + <quoted_context> + 问题)
        ─▶ 面板轮询 sessions.history 流式渲染 transcript（不跳转大窗口）
        ─▶ 首次 turn/end 后 ⑥ host 标题：Q+A 截断 → llm 快速无思考模型提炼 ≤15 字主题
          → rename 覆盖为 "❓<最终主题>"（仅一次，失败保留占位）
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
pnpm test       # vitest 单测（injection / summarize / answer / store / title / meta-quote / history-scope / history-time / model-menu / model-seat / context-meter / config / config-fields / ensure-panel / tab-activation / locales / prompt-locale）
pnpm typecheck
```

## 多语言

界面文案与模型侧提示词都跟随 **DSH 的语言设置**（设置 → 通用 → 语言，即 `$DSH_HOME/settings.yaml` 的 `locale.preference`）；缺少 locale 服务时回退浏览器语言，再回退 en。切换语言**即时生效**，无需刷新或重启。

- **界面**：两个 tab 标题（含已打开的 tab）、划选浮层、空态与状态提示、模型选择、context 占用环、功能配置面板——词表在 `src/client/locales.ts`，zh 为键集基准，en 由类型标注锁定。
- **模型侧**：追问引导语、上下文压缩系统提示、标题系统提示，以及提示词指名引用的结构标记——词表在 `src/prompt-locale.ts`。client 调用 `/sidebarqa/api/context` 与 `/sidebarqa/api/title` 时带 `locale` 字段；**缺省等价于 `zh`**，旧版 client 打到新 host 与 i18n 之前逐字节一致。
- **回答语言不跟界面走**：提示词要求模型「用与用户提问相同的语言作答，问题语言不明确时跟随划选文本」——中文界面下划选英文论文提问，仍得到英文回答（与 DSH 官方会话命名同款策略）。
- 追问会话标题为 `❓<主题>`：只用 emoji 标记，不含需要翻译的词，切换语言不会让会话列表出现混合语言前缀。

## License

MIT
