# Changelog

本项目的版本遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)，日志格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

## [0.4.0] - 2026-08-21

### Added

- **中英双语（i18n）**：界面文案与模型侧提示词都跟随 DSH 的语言设置（`locale.preference` > 浏览器语言 > en）**实时切换**，无需刷新。
  - 界面词表在 `src/client/locales.ts`（zh 为键集基准，en 由 `Record<CopyKey, string>` 类型标注锁定；单测另有键集平价、空值与占位符一致性检查），并通过 `ctx.locale` 注册进 DSH 的 `sidebarQa` 命名空间。locale 服务为**软依赖**：缺失时插件照常工作，回退浏览器语言。
  - 模型侧词表在 `src/prompt-locale.ts`：追问引导语、上下文压缩与标题系统提示，以及提示词**指名引用**的结构标记（`用户：`/`助手：`、`【背景】`、`问题：`）作为一个原子单元同进同退（单测断言这一配对）。
  - 已打开的 tab 标题同样跟随切换：better-sidebar 的 tab 标题是持久化定值，面板改为在语言变化时回推 `updateTab` 自愈。
- **明确的回答语言策略**：提示词现在显式要求「用与用户提问相同的语言作答；问题语言不明确时跟随划选文本」——**回答语言跟内容走，不跟界面语言走**（与 DSH 官方 session-title 同款策略）。此前得到中文回答只是「提示词恰好是中文」的副作用。

### Changed

- **追问会话标题去掉「追问」二字**：`❓追问·<主题>` → `❓<主题>`。emoji 本身已足够标记追问会话，去掉后该处不再需要翻译，也不会因切换语言而出现混合语言前缀。**已有会话的标题不会被追溯重命名。**
- **占位主题的截断预算按文种自适应**：含 CJK 取 12 字，纯拉丁取 24 字（`TOPIC_MAX_LEN` / `TOPIC_MAX_LEN_LATIN`）——12 个拉丁字符只有两三个词，此前会截在词中间。判定依据是**被划选文本的文种**，不是界面语言。
- **`/sidebarqa/api/context` 与 `/sidebarqa/api/title` 新增可选 `locale` 字段**（`'zh' | 'en'`）：host 侧没有语言信号，由 client 下发当前 DSH 语言。**字段缺省等价于 `zh`**，旧版 client 打到新 host 行为与今日逐字节一致；无法识别的语言一律落 en，永不抛错。压缩摘要缓存键加入 locale 维度，切换语言后不会继续命中旧语言的摘要。
- **面板内的宿主错误提示改为「本地化前缀 + 原始英文详情」**（追问失败 / 保存失败 / 模型加载失败），此前直接裸露英文原文。

### Fixed

- 追问记录的相对时间标签此前恒为中文；现在跟随语言（en 使用 `5m` / `3h` / `2d` 等紧凑缩写，规避复数形态）。

> 部署提醒：**host 半与 client 半都有改动**——需重启 `dsh web`，再硬刷新浏览器。只刷新不重启会短暂得到「英文引导语 + 中文压缩提示词」的混合状态（功能正常，仅提示词语言不一致）。
> 已知外观差异：dsh-better-sidebar 插件目录中对本插件的描述仍写作 `❓追问`，属上游只读文案，不影响功能。

## [0.3.2] - 2026-08-21

### Changed

- **回答/摘要的模型渠道与模型均改为下拉选择**：功能配置面板中「回答模型渠道 / 回答模型 / 摘要模型渠道 / 摘要模型」四行从自由文本输入改为下拉框，选项来自运行时已配置的渠道（新增 `/sidebarqa/api/catalog` 下发渠道与模型目录）。切换渠道时自动联动模型；摘要渠道额外提供「继承被追问会话」空值项。host + client 侧均有改动：需重启 `dsh web` 并硬刷新浏览器。

### Fixed

- **侧边栏切模型会改主对话、思考强度切不动**（[issue #10](https://github.com/ChenRuoT/dsh-sidebar-qa/issues/10)）：两个独立缺陷。
  - **模型座在「新追问」时绑的是被追问的父会话，而座位是写入式的**——为一个还没创建的子会话挑模型，改的却是主对话（挑中的值本来就会通过 `modelOverride` 正常应用到子会话，那次写入纯属误伤）。现在座位按状态分三态：**继续追问**时照旧直接提交到该追问会话；**新追问 + 压缩/裁切**时是**本地草稿**，默认显示配置里的回答模型（子会话真正会用的那个），仅在追问会话建好后应用，**全程不碰主对话**；**新追问 + 全量继承**时**只读置灰**并给出提示——fork 子会话沿用主对话模型正是前缀缓存命中的前提。绑定规则集中在纯函数 `src/client/model-seat.ts`（含单测）。
  - **推理强度切换从未发出请求**：`ModelSelect` 的去重守卫只比 provider + model，而「只改强度」恰恰路由不变，于是每一次强度切换都被静默吞掉（DSH 自己的座位让强度走另一条路径绕开该守卫，本插件移植时接错了）。守卫改为纯函数 `isNoopSelection` / `effectiveEffortOf`（`src/client/model-menu.ts`，含单测），在比较前折叠模型广告的 `defaultEffort`，于是勾选态、trigger 标签与去重判定读同一份逻辑。
- **追问子会话的思考强度可能被配置值顶替**：`trySelectModel` 用的是 `override?.reasoningEffort ?? config.answerReasoningEffort`，当面板选择有意表达「跟随提供方默认」时会被配置里的强度（默认 `off`）覆盖，等于给刚选的思考模型强行关思考。改为在强度这一维上 all-or-nothing。

> 已知限制（DSH 上游）：`sessions.selectModel` 会无条件把选择同时持久化为**全局默认模型**。因此压缩/裁切追问在给子会话设模型时，仍会改变「新建会话的起始模型」；一个**从未发过请求**的会话也会从该全局默认解析自己的当前模型，可能看起来跟着变。插件侧无 API 可规避（`selectModel` 无 opt-out、不写会话日志，`sessions.models` 只能拉取）。

> 部署提醒：以上均为 client 半改动，硬刷新浏览器即可生效，无需重启 `dsh web`。

## [0.3.1] - 2026-08-20

### Fixed

- **追问记录中已归档/已删除的会话成为悬空节点**：用户自行归档或删除 DSH 会话后，插件维护的父→子映射（localStorage）不会自动清理，追问记录 tab 会列出点击无效的节点。现在按会话状态实时分类——已归档（读 `workspaces.list` 的 `archivedSessionIds`）与已删除（会话 feed 缺失）的节点**置灰并标注「已归档 / 已删除」**、不可再点击跳转；行尾新增「移除」按钮，将其连同整棵子树从映射中清除（含 titled / collapsed 派生状态，DSH 侧会话本身不受影响）。纯函数集中在 `src/client/history-scope.ts`（`sessionStatus` / `subtreeIds` / `removeSubtree`）与 `store.removeSession`，均含单测。

> 部署提醒：client 半改动，硬刷新浏览器即可生效，无需重启 `dsh web`。

## [0.3.0] - 2026-08-20

### Fixed

- **侧边栏面板收起时，划选「提问」点击后无可见反应**（[issue #6](https://github.com/ChenRuoT/dsh-sidebar-qa/issues/6)）：better-sidebar 只对带 `path`/`url` 的**内容型打开**自动展开收起的面板，而「提问」走的是 type-only `openTab`，追问 tab 此前会落在不可见的收起面板里打开成功、用户却看不到任何反馈。「追问」与「追问记录」两个 tab 现在会**自愈展开**收起的面板，覆盖两个时机：
  - **挂载时**（tab 首次打开）：通过 `TabComponentProps.store`（better-sidebar 的 `SidebarStore`）展开——窄视口展开合并抽屉，宽视口按落点展开右侧/底部面板；
  - **重新激活时**（**用户手动收起面板后再点「提问」**——`openTab` 只聚焦已有 tab、组件不重挂载）：通过 `TabDescriptor.onActivate` 回调桥接到已挂载的组件，收到激活信号后再次自愈展开；用户手动收起本身不产生激活事件，不会被误打回。
  - 纯逻辑集中在 `src/client/ensure-panel.ts`，激活桥在 `src/client/tab-activation.ts`（均含单测），全程走公开服务契约、不依赖 DOM hack。client 半改动，硬刷新浏览器生效。

### Added

- **三种上下文策略**（对应 [issue #4](https://github.com/ChenRuoT/dsh-sidebar-qa/issues/4)）：发起追问时可逐次切换，配置 `historyStrategy` 设默认：
  - **全量继承**：从主会话分叉出子会话、完整继承上下文，复用 DeepSeek 前缀缓存命中（零压缩损失、更省 token）；子会话沿用主会话模型；主对话正在回答时自动降级为「压缩」并在面板提示。
  - **压缩**（默认）：快速模型压缩较早窗口 + 近期原文保留。
  - **机械裁切**：最后 `trimWindowMessages` 条消息原文直取，零 LLM 成本、确定性输出。
- **追问输入框改为 DSH 主对话同款外观**：圆角胶囊卡片 + 上箭头发送键；左侧为**上下文策略**选择 chip，右侧为**模型选择**（与主对话模型座、`/model` 命令共用同一份数据，切换互通）与 **context 占用环**（含系统 / 工具 / 消息 breakdown 面板）。模型选择与占用环在发起新追问时也显示——此时绑定被追问的父会话（占用环反映父会话上下文占用，可据此判断用全量继承还是裁切），继续追问时绑定该追问会话。
- **全量继承追问的对话视图**：追问 tab 默认定位在本次「引用 + 提问」处，继承的主对话历史显示在上方并带分割提示，向上滚动按页加载；压缩 / 裁切等新建会话行为不变。

### Changed

- **精简设置面板**：「功能配置」只保留 8 项常用设置（上下文策略、裁切保留条数、回答/摘要的 provider + model + 思考模式）；压缩与标题的内部调参键（`summarizeBudgetTokens`、`recentWindowMessages`、`backgroundWindowMessages`、`titleBudgetTokens`）不再在面板展示，仍可在 `settings.yaml` 的 `sidebarqa` 命名空间配置。

### Dependencies

- peer 依赖升级：`dsh-better-sidebar` `^0.12.0 → ^0.14.0`；`@deepseek-ai/dsh-client-ui-primitives` 与 `cordis` 升至 `rc.8`，适配 **DSH `0.1.0-rc.8`**。rc.7 及更早的 DSH 环境无法解析本插件依赖，需先升级 DSH。

> 部署提醒：host 半改动需重启 `dsh web`；client 半改动硬刷新浏览器即可生效。

## [0.2.0] - 2026-08-17

### Added

- 「追问记录」tab 限定当前工作区：按当前会话所属工作区的 `sessionIds` 过滤分层树，切换工作区后只看到本工作区的追问记录（归属判定与 DSH runtime 同源，走 `workspaces.list`）。纯函数集中在 `src/client/history-scope.ts`（含单测）。
- 「追问记录」有子追问的节点新增右对齐**折叠按钮**（箭头随折叠状态旋转，折叠状态持久化到 localStorage），左侧显示该对话组**最近访问时间**——复用 DSH 左侧面板的相对时间样式与 `sessions.list.updatedAt` 数据源（`src/client/history-time.ts`，含单测）。
- 「追问记录」点击任意节点跳转对话后，**目标会话的追问记录 tab 保持开启**（无论其原本的 tab 状态如何）：跳转后定向在目标会话的侧边栏状态中打开/聚焦追问记录 tab（better-sidebar v0.12+ 的 `openTab(seed, scope)` 定向能力，已打开则聚焦、未打开则新建），来回跳转不再多一步操作。
- **client 半改动，无需重启 `dsh web`，硬刷新浏览器即可生效。**

## [0.1.0] - 2026-08-16

首个公开版本。

### Added

- 划选对话文本 → 浮层「提问」→ 右侧面板内嵌问答，不打断主对话。
- 自动创建同工作区独立 DSH 会话（`❓追问·<主题>`），可继续、可归档、可嵌套追问。
- 快速无思考模型压缩主对话上下文 + 划选引文注入首条消息。
- 「追问记录」tab 按根会话分层树展示。
- 两段式命名：划选首行占位 → 首次回答完成后基于「问题 + 回答」自动重命名。

### Dependencies

- `dsh-better-sidebar`（硬 peer 依赖，未安装时插件不激活）。
