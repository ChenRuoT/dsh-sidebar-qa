# Changelog

本项目的版本遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)，日志格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

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
