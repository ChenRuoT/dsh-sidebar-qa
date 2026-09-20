# Changelog

本项目的版本遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)，日志格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [1.0.0] - 2026-09-20

**首个 1.x：只注册进 DSH 自带右侧栏，零额外依赖。** 走 major 的原因只有一条——**移除了 `dsh-better-sidebar` 后端**（`### Removed` 一节）：升级后不再需要任何 peer 侧边栏基座，装 `dsh-sidebar-qa` 一个包即可；此前依赖 better-sidebar 的部署请一并卸掉它。

### Added

- **只注册进 DSH 自带右侧栏（`@deepseek-ai/dsh-client-ui-sidebar-right`，DSH ≥ `0.1.5-alpha.1`）**：本版本**移除 `dsh-better-sidebar` 兼容**，插件只有一个侧边栏后端，且**不需要任何额外依赖**。
- **三阶段注册，共用一个实现 id**：① 类型进 `ctx.sidebarRightTabs.register({ id, kind, priority: 'extension', title, guide })`（页面类型：无 `patterns`、无 `multiple`）；② body 进 keyed 席位 `sidebar.right.pane.tab`；③ **活的标题**进 keyed 席位 `sidebar.right.pane.tab.title`。后两者都是 `ctx.slots.inject(name, () => ctx.slots.register({ name, key: id }, Component))`——**席位按实现 id 分发，不是按 kind**；打开走 `ctx.sidebarRight.openTab(kind, { params })`。
- **标题席位是新增能力**：DSH 的 tab 标题只在**打开时刻**求值一次并写进布局记录、之后永不改写（上游也明确「没有标题注册时使用打开时捕获的文本」），所以以前已打开的 tab 会**冻结在打开时的语言**。注册一个**组件**到标题席位后，它订阅语言 revision 并在原处重渲染——**已打开 tab 的标题现在跟随语言切换**。宿主不声明该席位时回退为那个冻结字符串（陈旧但无害）。
- **`+`（guide）条目仍是可发现性的唯一来源**：原生侧边栏的 `+` 控件只打开 guide 页，注册的类型靠 `guide` 条目暴露成可点胶囊；本插件为两个 tab 各注册一个条目（标题/说明按语言实时读取），新增 `askGuideDesc` / `histGuideDesc` 文案。
- **配置面板有了归宿：迁入 DSH 官方设置页**。它注册成一个 `settings.section`（注册逻辑在 `src/client/settings-slot.ts`，纯模块、可测；页面组件 `src/client/settings-section.tsx` 渲染 `ConfigPanel`），因此设置页左侧导航新增**一整页**「追问 / Follow-up」（文案键 `cfgNavLabel` / `cfgSectionTitle` / `cfgSectionDesc`），`order: 30` —— 排在 DSH 自带各页（general 0 / models 10 / plugins 15 / agent-presets 20 / archived-sessions 25）之后。**不再有齿轮弹窗**。
  - 注册形态：`ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'sidebar-qa', order: 30, label: () => t('cfgNavLabel') }, ConfigSection))`；插槽注册表仍是 `ctx.get()` 探测（`src/client/slots.ts`，与侧边栏模块共用同一个探针）。
  - **为什么不是 `plugins.item`**：该席位的契约明文写着它留给 `ui-settings-plugins` 那些 host-plane 配置页，并要求 bundle 的配置走 `plugins.bundle.config`；而那个插件页在没有受管 profile 的部署上整页不可用，会把配置入口一起带走。`settings.section` 永远可达。
- 新增 client 纯模块 `src/client/ask-mode.ts`（`resolveAskMode`：面板视图模式；自 `meta-quote.ts` 搬出，后者随 better-sidebar 一起删除）与 `src/client/show-session.ts`（`showSessionFirst`：用 `ctx.uiWorkspace.openSession` 把目标会话切到屏幕上）。
- 回归用例：`tests/sidebar-native.spec.ts`（重写）、`tests/ask-mode.spec.ts`（新增）、`tests/settings-section.spec.ts`（新增）。

### Changed

- **`inject` 收窄为 `['sessions', 'remote', 'remote.session', 'workspaces']`**，`betterSidebar` 不再出现（它此前是硬依赖：任何没装 `dsh-better-sidebar` 的部署都会让**整个插件**不激活）。侧边栏服务 `sidebarRightTabs` / `sidebarRight` / `slots` **一律 `ctx.get()` 探测 + 监听 `internal/service` 重探**，**绝不写进 cordis `inject`**——cordis 没有可选依赖，注入一个宿主不提供的服务会让 fiber 停在 PENDING，而 `boot-client.ts` 会让**整个 web boot 抛错**（白屏，不是降级）。三件套齐备才落定：只有注册表没有席位，tab 会出现但 body 渲染不出来。全都缺失时插件仍激活（浮层 + 「添加到对话」），只记一条 `console.warn`。
- **面板不再感知侧边栏**：`AskPanel` / `HistoryPanel` 删掉了「推 tab 标题」与「面板自愈展开」两个 effect（前者由标题席位承担，后者原生 `openTab` 自己会展开栏位），也删掉了 `onTabActivated` 订阅（原生路径上本来就是死代码）。面板现在只消费一个中性的「出现实例」`SidebarqaTabOccurrence`：`{ tabId, revision, takeQuote(), openHistory(scope) }`（`src/context-types.ts`）。`revision` 就是 `navigation.revision`——每次被导航到都递增，是「再次打开」唯一的信号（一次外部打开 = 一个新的出现实例，所以引文能重新递送）。
- **跨会话手势统一走 `src/client/show-session.ts`**：原生 `openTab` 只作用于**已挂载**的会话 surface（无 surface 时抛 `no session surface is mounted`），而导航后会话绑定要到下一次 React commit 才由 seat 的 `useEffect` 重新发布——同 tick 的 `openTab` 会**静默**打到刚离开的会话。现在先 `uiWorkspace.openSession` 切屏，随后用 `openTabIn(sessionId, …)`（DSH 自己 Tab 域的路径，静默但绝不会落错会话）跨帧重发并以 `active()` 确认；宿主没有 `openTabIn` 时退回跨帧 `openTab`，且检查期间没有更晚的导航接管。
- **`id` 与 `kind` 是同一个 `SidebarTab` 对象上的两个字段**，打开时从**被注册的那个对象**读回 kind。「注册 `ask` 却打开 `dsh-sidebar-qa:ask`」这类分叉（`placeTab` 会抛 `no tab type is registered as "…"`）因此不可表达。
- `engines.dsh` 仍是 `>=0.1.2-alpha.1`（浏览器侧 RPC 走 `ctx.remote.session` 的下限），但 **DSH 完全不校验 `engines`**，所以它只是声明、不是闸门；真正的前置是**侧边栏 tab 需要 DSH ≥ `0.1.5-alpha.1`**。更早的 DSH 上插件**仍然激活**，只是不注册侧边栏 tab。
- `dsh.client.inject`（包名依赖边）保留：它是**纯信息性**的声明，不决定加载顺序，缺失会被静默跳过，**不是版本硬约束**。
- `src/context-types.ts` 随之收敛：删掉端口/桥/两后端相关类型，`SidebarqaTabComponentProps` 只保留 `tab.id` + 可选的 `sidebar` 出现实例，新增原生侧边栏、`slots`、`uiWorkspace`、`webRuntime` 的服务面镜像并挂 Context augmentation；与上游的漂移仍然只收敛在这一个文件。

### Removed

- **peer 依赖 `dsh-better-sidebar`** 及其 `peerDependenciesMeta` 条目（`package.json`）。
- `pnpm-workspace.yaml`：两条 `dsh-better-sidebar` 的 `minimumReleaseAgeExclude`，以及整个 `allowBuilds` 块（`node-pty` / `protobufjs` 只因 better-sidebar 才在依赖图里）；`pnpm-lock.yaml` 重生成后二者已完全消失。
- 源文件：`src/client/sidebar-port.ts`（端口契约 + 后端探测）、`sidebar-install.ts`（后端选择与安装）、`sidebar-better-sidebar.ts`（适配器）、`ensure-panel.ts`（面板收起自愈——原生 `openTab` 自己展开栏位）、`tab-activation.ts`（`onActivate` 桥——`navigation.revision` 取代）、`meta-quote.ts`（`resolveAskMode` 搬到 `ask-mode.ts`，引文形状校验改在 `sidebar-native.ts` 的 `quoteOfNavParams` 里）。
- 测试：`tests/sidebar-port.spec.ts`、`sidebar-seam.spec.ts`、`sidebar-better-sidebar.spec.ts`、`ensure-panel.spec.ts`、`tab-activation.spec.ts`、`meta-quote.spec.ts`。
- 文档：`docs/better-sidebar-expand-feature-request.md`（该功能请求随 better-sidebar 一起作废）。

### Fixed

- **侧边栏的 tab 图标没了：`+` 页（guide）的胶囊画的是宿主的方块占位，tab 条上只有裸文字**。原生改造（1.0.0 的重构）把图标整个丢了——旧的 better-sidebar 注册里写着 `icon: (size) => <IconQuestionOutline14 size={size} />`（追问）与 `IconQueueOutline14`（追问记录），而新的 `SidebarTab` 描述里没有这个字段。宿主的两处放置都会**在缺省时回退到别的东西**（guide 胶囊 → 自己的方块占位 `GuideBody.tsx:48,59`；tab chip → 裸标题），所以缺图标不是「朴素」，而是别人家的占位符。现修：
  - `SidebarTab` 新增必填 `icon: ComponentType<IconProps>`，`index.tsx` 两个 tab 分别用回 `IconQuestionOutline14` / `IconQueueOutline14`（宿主自带图标集，走平台模块表，不引入其它特性插件的值）。
  - **guide 胶囊**：`guide[].icon` 直接传该 glyph。
  - **tab chip**：布局记录里的标题只是**字符串**，图标不可能随标题捕获，所以 glyph 由**活标题席位**渲染——`titleFor` 现在返回 `Fragment(glyph, title)`（与宿主自己的 chip 标题 `GuideTitle.tsx` 同构），glyph 的样式在新的 `src/client/tab-title.module.css`（`flex: none` + `color: var(--dsw-alias-label-tertiary)`，与宿主一致）。
  - 顺带修掉一处**镜像漏声明**（同一类：镜像自己就是唯一声明，漏了编译器不会报，运行时静默丢）：`context-types.ts` 的 `SidebarqaSidebarRightGuideEntry` 没有 `icon`（上游 `tab-registry.ts:79`），所以即便传了也无处安放。现已补上并注明出处；`IconProps` 直接从宿主包里 `import type`，不再二次镜像。
  - `useLocaleRevision` 的 `useSyncExternalStore` 补上第三个参数（server snapshot）：缺它时任何服务端渲染都会抛 `Missing getServerSnapshot`，也让标题席位在 node 环境无法验收。活动语言 id 是稳定原语，正是服务端渲染该读的值。
  - 回归用例：`tests/sidebar-native.spec.ts`（guide 条目必须带 tab 的 glyph；活标题席位必须渲染「glyph 在前、标题在后」）。
- **「全量继承」追问会让面板全白且不可恢复**（本轮实测发现，**根因是一条上游 prop 改名**）。`MarkdownText` 的本地化文案 prop 从 `codeLabels` 改名成了 `labels`（`MarkdownLabels = { code: { copyLabel, copiedLabel }, footnotes }`，改名发生在 DSH `0.1.2-alpha.2` 之前），而**宿主渲染器读 `labels.code.copyLabel` 时没有任何守卫**（`ui-primitives/src/markdown/render.tsx:400`）。本插件一直在传已退役的 `codeLabels`，于是 `labels` 为 `undefined` —— **任何一条含围栏代码块的消息只要被渲染就抛 `TypeError`**。这解释了为什么它看起来是「全量继承特有的」：继承会把主导对话的整段历史（写代码的对话，满是代码块）画进面板，而普通追问的回答常常是纯文字。异常逃出席位后被 **abdicate**（`ui-slots/src/index.ts:1541`），本插件的 tab body 因此在**整页所有会话**上被永久摘除——只能刷新。
  - 现在传 `labels`（`AskPanel` 的 `markdownLabels`，按 locale memo：`MarkdownText` 以它的引用身份缓存流式渲染），新增文案键 `mdFootnotes`（脚注小节标题），退役的 `codeLabels` 从代码里彻底删除。
  - **为什么此前 `tsc` 报不出来**：类型来自 devDependency 桩 `@deepseek-ai/dsh-client-ui-primitives`，其范围写的是 `^0.1.0-rc.8`，而**带预发布的 semver 区间永远匹配不到另一个 patch 的预发布版本**（`0.1.6-alpha.2` 不满足 `^0.1.0-rc.8`，也不满足 `>=0.1.2-alpha.2`）——桩因此被永久冻结在改名之前的 API 上，编译器一直拿旧契约校验新代码。现把 devDependency **精确钉到 `0.1.6-alpha.2`**（与运行中的 DSH 一致），peer 只声明下限 `>=0.1.2-alpha.2`；`pnpm-workspace.yaml` 新增 `peerDependencyRules.allowedVersions`（该桩 peer 了一个本包从不链接的 `@deepseek-ai/cordis` 副本，cordis 由平台模块表提供）。lock 随之去掉旧桩那条重依赖图（katex / micromark / mdast 一族，约 860 行），新桩自身零依赖。
  - 回归用例：`tests/markdown-labels.spec.ts` 直接钉住**装好的桩**（必须声明 `labels:`、必须不再有 `codeLabels:` 属性），把「范围悄悄退回预发布旧版 → 类型检查重新放行」这条路堵死。
- **面板里的任何渲染错误都不再可能让 tab body 整页失效**：新增本插件自己的错误边界（`src/client/panel-boundary.tsx`，挂在 `sidebar-native.ts` 的 `bodyFor` 最外层）：崩溃被就地渲染成一条**可重试**的说明条（`errPanelCrashed` / `panelCrashHint` / 复用 `commonRetry`），标签页本身留着；切换会话（`resetKey` = sessionId）会自动清掉崩溃面。`containPanel(resetKey, Panel, props)` 接收**组件**而不是现成元素，因此「把面板当普通函数调用」这种会让边界失效的写法（本节第一条修 bug 时我自己就先写成了这样）**变成类型错误**；测试另有一道 wiring 守卫（`tests/panel-boundary.spec.ts`：`bodyFor` 必须 `return containPanel(props.sessionId, tab.component, bodyProps)`，且不得再出现 `tab.component(bodyProps)`）。注：React 的服务端渲染器不咨询错误边界（直接 rethrow），因此containment 在 node 环境以**元素结构**断言，而非渲染。
- **在「追问」页点到一条已被归档 / 已删除的追问，会让面板内容整块消失、而且再也调不出来**（本轮实测发现）。根因是**插件自己维护的 localStorage 父子映射不会随 DSH 侧的归档/删除清理**：切换条里的陈旧行照旧可点，点下去就是把面板切到一段**读不出内容**的会话上（正文永远停在「生成中…」）；更糟的是这类 id 一旦被拿去导航，`uiWorkspace.openSession` 会**先**把它 retain 成主视图，DSH 自己的导航策略**随后**再把它丢掉（`ui-workspace/src/client/navigation.ts:287-301` 的 `clearArchivedCurrent` → `clearMain`），主视图与整个右栏一起失效——用户正在读的面板随之消失。三处一起修（均为 client 半）：
  - **切换条逐条分类**：新增纯函数 `followUpAvailability` / `isFollowable` / `lastFollowableFollowUp`（`src/client/history-scope.ts`）。已归档 / 已删除的追问**保留可见**（映射行还在，DSH 侧恢复归档后立刻可用）但**置灰不可点**，并标注「已归档 / 已删除」——与「追问记录」的陈旧行同一套语言。面板的默认选中也改为「最新一条**可读**的追问」，不再默认落到一条读不出的会话上。
  - **选中项在阅读时被归档**：正文改为明确的说明文案 + 「移除」（只清插件自己的映射，DSH 侧会话不动），输入框、策略、模型座与发送键一并停用。不再有「面板开着却什么都没有、也不知道为什么」的状态。
  - **导航入口补围栏**：`sidebar-native.ts` 切屏前先读 `workspaces.list` 的 `archivedSessionIds`（`isArchivedTarget`），命中则**只记一条 warn 并放弃这次手势**，绝不把已归档会话 retain 成主视图；读不到 archive 集时一律当作「未归档」，围栏不会因为读不到输入而开始拒绝打开。
  - 分类特意**不复用**「追问记录」的 `sessionStatus`：行标签可以立刻把「feed 里还没有」写成「已删除」，而切换条一旦照此**禁用**，冷启动（`phase !== 'ready'`）时就会把全部追问锁死。`followUpAvailability` 因此多出一个 `unknown`（feed 尚未 hydrate，按可用来处理）。
- **宿主 `useTabInfo` 抛错会让本插件的 tab body 在整页范围内永久失效**。DSH 的 keyed 席位错误边界对崩溃条目的处理是 **abdicate**（`ui-slots/src/index.ts:1541`：`abdicated.add(entry)`）——把这条注册从席位上**永久摘除**，于是**所有会话**的这个 tab 一起变空白，重新打开也回不来（只能刷新页面），正是「内容完全消失且不能再调出」。而 `tab-info.ts:35` 抛的 `tab "<id>" is not committed in session "<id>"` 是宿主自己就可能瞬时产生的状态（布局提交与渲染不一致）。现在 body 读取该 hook 时**捕获并降级**为一条中性的「未挂载」出现实例（`useTabInfoSafely`）：这一帧面板渲染成惰性内容，下一次一致提交即自愈；`takeQuoteOnce` 只在真正读到 payload 时才消费，所以随打开带来的引文**不会因为这次降级而丢**。
- 回归用例：`tests/history-scope.spec.ts`（可用性分类 13 例）、`tests/sidebar-native.spec.ts`（已归档目标拒绝导航、hook 抛错仍渲染、引文跨降级仍可交付）、`tests/panel-boundary.spec.ts`（边界状态机 + containment 结构 + wiring 守卫）、`tests/markdown-labels.spec.ts`（类型桩契约），全套 23 文件 / 342 用例。

以下三条都是**在真实部署上实测发现**（现象：侧边栏里看不到 tab），按「上游 → 下游」的顺序排列——前两条如果不修，第三条根本走不到：

- **`ctx.inject` 的每个键都是「必需依赖」，不存在可选形式**（**这条是根因**）。上游 cordis 的 `Fiber._refresh` 会遍历 `Object.keys(this.inject)`，只要有一个键没有实现就把 fiber 置为 `INACTIVE`，因此回调**只在全部服务都存在时**才运行。初版写成 `ctx.inject({ sidebarRightTabs: null, betterSidebar: null }, cb)`，语义是「要求原生侧边栏和 better-sidebar **同时**存在」——现实中不成立，于是 fiber 永久 PENDING、回调一次都没跑，插件什么也没注册，**却仍然打印了正常的激活日志**。`{ name: null }` 不是「可选」，而是「必需，并以 `null` 拦截」。
  现改为 `ctx.get()` 读取（与 `ui-conversation` 的 `conversation` 同一条路，不需要 inject）+ 监听 cordis 的 **`internal/service`** 事件（`ReflectService.notify` 每次 `provide` 都会 emit）做反应式安装，并且在 `nativeSidebarServicesOf`（`src/client/sidebar-native.ts`）里要求三件套（`sidebarRightTabs` + `sidebarRight` + `slots`）齐备才落定 —— 只有注册表没有席位，tab 会出现但 body 渲染不出来。
- **原生 tab 类型没注册 guide 条目 → 侧边栏里根本看不到它**。原生右侧栏的 `+` 控件**只打开 guide（引导页）**，并不枚举已注册类型；guide 页才是把类型列成可点胶囊的地方（`GuideBody.tsx:96`：点击 → `tab.actions.openTab(entry.kind, { replaceTab: true })`；内置的工作区文件 / 新建终端 / 浏览器三个入口就是同一机制，见 `ui-sidebar-files/definition.tsx:35` 等）。初版只注册了类型与 body，这两个 tab 因此只能由代码打开——正是「没有 tab」。现为两个类型各注册一个 guide 条目（标题 / 说明按语言实时读取），并新增 `askGuideDesc` / `histGuideDesc` 文案。
- **探测只在 `apply` 时做一次 → 后端晚到时永久不注册**。`sidebarRightTabs` 由 `ui-sidebar-right` 自己的 `apply` 发布，两个 fiber 谁先落地属于组装顺序、不是插件可以假设的。初版探测落空后**不再重试**，只留一条容易被忽略的 warn。

三条都补了针对性回归用例（`tests/sidebar-native.spec.ts` 的「guide 条目到达 DSH」「后端迟到时仍会安装，且只装一次」「三件套缺一即视为没有侧边栏」「缺动词的服务当成缺席」）。测试替身也一并改对了：它现在**不提供**任何形式的可选 inject（那正是让前三轮「单测全绿、真机全挂」的原因），服务必须通过 `provide()` 事件到达。

- **原生「提问」打开时用的 kind 与注册时不一致 → 点击必然报错**。原生类型有**两个不能互换的名字**：`id`（实现身份，唯一，body 席位按它查找）与 `kind`（`openTab(kind)` 的派发名，`placeTab` 按它查注册表，查不到就抛）。本插件 `id` 用 tab key（`dsh-sidebar-qa:ask`）、`kind` 用短名（`ask`），而初版把 `openAsk` 的 kind 常量从 **key** 推导，于是注册了 `ask` 却去打开 `dsh-sidebar-qa:ask`：
  ```
  sidebarRight: no tab type is registered as "dsh-sidebar-qa:ask"
      at SidebarRightController.placeTab (service.ts:369)
      at Object.openAsk (sidebar-native.ts:226)
  ```
  现改为**注册时按角色记下每个类型实际使用的 kind**（`kindByRole`，见 `src/client/sidebar-native.ts` 的 `installSidebarTabs`），打开时用它，两者不可能再分叉；未注册时直接告警返回，不再让异常从点击处理器里逃出去。回归用例改为断言「打开的 kind === 注册的 kind」（断言常量抓不到这类漂移）。
- **原生「提问」前先切到引文所属会话**。原生导航面只作用于**已挂载**的会话面板：`openTab` 会取当前绑定的 seat，没有就抛 `sidebarRight: no session surface is mounted`（`ui-sidebar-right/src/client/service.ts:537`）。而引文是在划选时按当时会话捕获的，用户可能已切走，于是这次打开必然失败。现在打开前若目标会话不是当前会话，先经 `ctx.uiWorkspace.openSession` 把它切到屏幕上（`src/client/show-session.ts` 的 `showSessionFirst`）—— 这里原先写的是 `ctx.sessions.open`，一个 `ISessions` 根本不存在的**臆造 API**（该契约里没有任何导航入口，它自己的注释把导航划归 view owner），修掉它这条路径才真的动起来。
- **`SessionListState.current` 这个字段根本不存在 —— 本插件从第一版起就在读一个臆造的字段**（**这是「添加到对话」与选区归属的总根因**）。`SessionListState` 的真实结构是 `{ ids, byId, phase, subagentsByParent, jobsBySession }`（`api/session-controller/src/client/sessions/service.ts:53`），**没有 `current`**，所以 `sessions.list.getSnapshot().current` 恒为 `undefined`。更糟的是**本插件的类型镜像我当初自己加了 `current`**，于是运行时默默返回 `undefined`、编译器也永远报不出来——这个错误因此一直活到了现在。
  DSH 自己的「当前会话」定义在 `ui-workspace/src/client/tree.ts:41`：**主视图 retain 的那个会话**（`retainedBy.mainView > 0`）。现已新增纯函数 `src/client/current-session.ts`（`resolveCurrentSessionId`，9 条单测），替换全部 5 处误用：选区归属（`index.tsx`）、composer 目标解析（`draft-insert.ts`）、切会话前后的当前会话判定与接管判定（`show-session.ts` / `sidebar-native.ts`）、追问记录的工作区归属判定（`HistoryPanel.tsx`）。类型镜像里的 `current` 已删除，并按真实结构补齐 `ids` / `phase` / `retainedBy`——删掉假字段后，`tsc` 立刻抓出了最后一处漏改。
- **「添加到对话」在选区没带 sessionId 时被当成不可恢复**。空串来自上一行的假字段。初版把空串当成致命错误直接 `return`，于是**连重试路径也一起被砍掉了**（日志里能看到 `missing-session (selectionSession=<empty>)`）。现在空 id 会**在写入时重新解析**，并且允许下一帧重试。
- **「添加到对话」在会话不在屏幕上时必然失败**。写进 composer 需要该会话的 **Agent scope**，而 `ctx.sessions.scope(id)` 只对**当前已挂载**的会话返回值（`session-controller/src/client/sessions/service.ts:502` → `this.scopes.get(id)`）；scope 拿不到时该按钮只记一条 warn 并返回 false，而浮层在失败时会**保留自身与选区**——于是用户看到的就是「点了没反应」（这次连浮层都不消失）。
  现在按钮先把引文所属会话切到屏幕上（`ctx.uiWorkspace.openSession`，经 `src/client/show-session.ts`），并在 scope 仍未被 retain 时**于下一帧重试一次**（scope 由 React reconciliation retain，不是同步的）；失败原因（`missing-session` / `no-conversation-service` / `scope-unavailable` / `threw`）会带 phase 打到 console，不再只有一行含糊的 warn。重试只针对**重试可能修复**的两类（空 id、scope 未 retain），`no-conversation-service` 与 `threw` 不重试，避免噪音翻倍。
- **打开链路的异常不再静默**。浮层在调用之前就把自己关掉了（`SelectionPopover.ask()` 先 `controller.clear()` 再 `onAsk`），因此一旦后半段抛错，用户看到的就是「点了没反应」而没有任何提示。现在 openAsk / openHistory 都会把失败打到 console，并在调用前后各留一条 info 日志，便于区分「没走到」与「走到了但失败」。
- **一批「类型镜像臆造上游成员」的静默故障**。`src/context-types.ts` 是本仓库唯一的声明来源，臆造出来的成员 `tsc` 永远报不出来、运行期读作 `undefined`，同一类故障因此反复发生：`SidebarqaLoaderEntry` 只声明了 `options.name`，而 web-app bundle 把那一行挂成 `id: connection`（`name` 是包名），于是 `/sidebarqa/api` 的信任围栏恒判为 loopback-only，局域网或自定义 Host 的浏览器访问**恒 403**——现在按 `options.id` 匹配，并优先读已求值的 `webRuntime.trustedHosts`（那一行自己的 config 里是**未求值的** `!!js` 表达式，当成数组读会让 `.some()` 抛错、把 403 变成挂起；现在每个来源都做数组校验，失配时拒绝而不是抛）。另外：`slots.has`（上游叫 `spec()`，零调用点）、`HistoryEntry.view`（零调用点）、`HistoryRecord` 的 `{ type: 'chunks' }` 变体（上游是单成员联合，那个「打包增量」在线上根本不存在）、`FollowFrame` 缺 `assistant-stream` 变体（上游可能开始发的第三种帧，读 `frame.event` 会让渲染崩）、以及 `SessionInput.focus()`（上游本就公开，不必经由未公开的 editor 字段手搓）——全部按上游契约改正。

### 说明（原生侧边栏）

- **配置面板已迁入 DSH 官方设置页**：它现在注册成 `settings.section`，在设置页左侧导航里是**一整页**「追问 / Follow-up」（排在 DSH 自带各页之后，`order: 30`），**不再有齿轮弹窗**；`settings.yaml` 的 `sidebarqa` 命名空间仍然有效，两条路写的是同一份配置。之所以不是 `plugins.item`：该席位的契约明文留给 `ui-settings-plugins` 那类 host-plane 配置页、并要求 bundle 配置走 `plugins.bundle.config`，而那个插件页在没有受管 profile 时整页不可用，会把配置入口一起带走。
- **跳转会先把目标会话切到屏幕上**：原生 `openTab` 只作用于**已挂载**的会话 surface，而右栏的 session 绑定由 React effect 在下一次 commit 才重新发布，所以紧跟导航的打开会**静默**打到刚离开的会话。现在的顺序是：先 `ctx.uiWorkspace.openSession`（`src/client/show-session.ts`）把目标会话切到屏幕上，随后用 `openTabIn(sessionId, kind, …)` 定向到目标会话自己的 store —— 该 store 尚未被 adopt 时它是**静默 no-op**，所以**不可能开错会话** —— 在几个帧的有界预算内重发，并以 `active()` 确认，最终失败才 `console.warn`。**有界重试只在需要切换时发生**：目标已经是屏幕上的会话就直接 `openTab`，一次到位。

> 部署提醒：**host 与 client 两半都有改动**（host 侧修了 `/sidebarqa/api` 的信任围栏与 `webRuntime` 读取），且 manifest / 依赖层有变化：`dsh-better-sidebar` peer 被移除，`@deepseek-ai/dsh-client-ui-primitives` 的 devDependency 精确钉到 `0.1.6-alpha.2`、peer 改为下限 `>=0.1.2-alpha.2`，`pnpm-workspace.yaml` 新增 `peerDependencyRules`（lock 随之变化，去掉旧桩那条 katex/micromark 依赖图）：升级后请重新 `pnpm install`，并重启 `dsh web`。本轮新修的两条（`MarkdownText` 的 `labels` 与面板错误边界）都是 **client 半**代码，硬刷新浏览器即生效。

## [0.5.0] - 2026-08-29

### Added

- **划选浮层由一个按钮拆成两个（[issue #11](https://github.com/ChenRuoT/dsh-sidebar-qa/issues/11)）**：
  - **「添加到对话」**（新增）：把划选文本以 Markdown `>` 引用块**追加**进**当前会话的主输入框**（composer），聚焦并把光标停在引用块下方的空行——**不新建会话、不打开也不展开侧边栏**。适合「引用这段话，我就在主对话里接着说」，与开一个独立追问会话互为轻重两条路。
  - **「提问」**：文案与行为**逐字节不变**（存 pending 引文 + `openTab({ type: 'dsh-sidebar-qa:ask' })`）。之所以没有按 issue 原文改名「侧边聊天」，是因为 `dsh-better-sidebar` 0.16.x 自己就有一个叫 Side Chat / 侧边聊天的视图，改名会与上游功能撞车。
  - 引用块格式：**逐行**加 `> ` 前缀（选区内的空行渲染成裸 `>`，否则一个引用块会被截断成两个）；块尾留一个空行，所以光标落在引用块**外面**——紧贴 `> x` 下一行写字在 Markdown 里属于 lazy continuation，会被吸进引用块里。
  - **追加而非覆盖**：输入框里已有的内容一个字都不动，引用块空行分隔接在后面；连点两次会追加两个引用块（刻意不做幂等）。
  - 走 DSH `ui-conversation` 的 `conversation` 服务（`ctx.get('conversation')` → `input.for(scope).setDraft`），与 `dsh-better-sidebar` 资源管理器的 `@` 文件引用是同一条路径，**没有任何 DOM hack**。
  - 新增纯模块 `src/client/quote-draft.ts`（引用块格式化 + 草稿合并）与薄接线模块 `src/client/draft-insert.ts`，各自带单测（`tests/quote-draft.spec.ts` 21 例、`tests/draft-insert.spec.ts` 12 例）。

### Changed

- `src/context-types.ts` 增补 `conversation` 服务的结构化镜像（`SidebarqaConversationService` / `SidebarqaSessionInput`）并挂上 Context augmentation——与上游的漂移仍然只收敛在这一个文件里。声明它同时让 `ctx.get('conversation')` 返回**有类型**的服务面而不是 `any`（cordis 把 `get` 定义为 `<K extends string & keyof this>(name: K) => this[K] | undefined`）。
- 新增文案键 `askAddToConversation`（zh `添加到对话` / en `Add to chat`）。`askPopoverButton` 与三条提到「提问」的空状态提示均未改动。

### 降级契约

`conversation` 服务缺失（没装 ui-conversation 的部署）、会话 scope 解析不到、或调用链上任意一处抛错 → 「添加到对话」记一条 `console.warn` 后**什么都不做，并且保留划选与浮层**，用户可以改点「提问」。插件本身、浮层、以及原有的追问流程都不受影响；`conversation` **没有**进 `inject`，所以它的缺席不会让插件不激活。

> 部署提醒：**仅 client 半改动**，浏览器硬刷新即可，无需重启 `dsh web`。
> 已知限制：输入框里已有的 `@` 引用 chip 会在这次写入中被降级成纯文本——`setDraft` 是 composer 唯一的公开写入路径，它按纯文本重建整棵节点树（`dsh-better-sidebar` 的 `appendToDraft` 有同样的行为）。**输入框为空时（最常见路径）完全不受影响。**

## [0.4.2] - 2026-08-29

### Changed

- **`package.json` 新增 `engines.dsh: ">=0.1.2-alpha.1"`（[issue #14](https://github.com/ChenRuoT/dsh-sidebar-qa/issues/14)）**：0.4.1 起浏览器侧 RPC 走 DSH 的 Remote 服务（`ctx.remote.session`），该服务首次落地于上游 `dsh-v0.1.2-alpha.1`。此前这个前置条件只写在 release notes 里，机器读不到；现在成为清单里的显式声明，供市场 / CLI / CI 在安装前校验（配套提案见 [dsh-market#404](https://github.com/dsh-market/dsh-market/issues/404)）。
  > 注意这是**声明而非闸门**：npm / pnpm 的 `engines` 只校验 `node`（及包管理器自身），未知键会被忽略；`dsh plugin --profile web add` 又是 pnpm 的薄转发。真正的安装前拦截需要市场 / CLI 侧消费该字段。在此之前，早于 `0.1.2-alpha.1` 的 DSH 上本插件因 `inject` 解析不到 `remote` 而**静默不激活**（无 UI、无报错），请留在 `0.4.0`。
- **`dsh.plugin.json`（plugin-registry 渠道清单）的 `engines.dsh` 由 `>=0.0.1` 同步为 `>=0.1.2-alpha.1`**：该字段此前是一条陈旧声明（写于插件还没有任何宿主版本要求的时候），按 registry 清单做校验的消费方会读到「任何版本都行」，与 `package.json` 的声明互相矛盾。两份清单现在给出同一个下限。
- **`dsh-better-sidebar` peer 依赖由 `^0.16.0` 放宽为 `>=0.16.0`**：caret 对 `0.x` 只放行同一 minor（`>=0.16.0 <0.17.0`），而上游迭代快于本插件——better-sidebar 发到 `0.17.0` 时本插件会**平白无故解析失败**，尽管并没有任何已知不兼容。改为只声明下限，若将来某个版本确实破坏兼容再收窄上限。

> 部署提醒：本版仅清单与依赖声明改动（`engines.dsh`、peer 范围），无运行时代码变化；已安装用户无需重启。但早于 DSH `0.1.2-alpha.1` 的宿主上插件会**静默不激活**（与 0.4.1 行为相同），请留在 `dsh-sidebar-qa@0.4.0`。

## [0.4.1] - 2026-08-28

### Fixed

- **版本兼容（[issue #12](https://github.com/ChenRuoT/dsh-sidebar-qa/issues/12)）：`dsh-better-sidebar` peer 依赖由 `^0.14.0` 调整为 `^0.16.0`**，正式声明兼容 0.16.x（本次 Remote 迁移正源于该版本线的上游重构）；0.14.x / 0.15.x 不再被 peer 解析。
- **追问面板整块报错 `dsh-better-sidebar: Cannot read properties of undefined (reading 'sessions')`**：DSH 上游把浏览器侧 RPC 从 `ctx.connection.api` 迁到了**类型化 Remote 服务** `ctx.remote`（`refactor(connection): own RPC transport contracts` 删掉了 `ConnectionHandle.api`；`refactor(client): consume migrated Remote namespaces` 把各命名空间挂成独立 cordis 服务）。本插件的 11 处调用点全部落在那个已消失的对象上，其中 `ModelSelect` 的挂载 effect 是**同步**取值，因此直接被 better-sidebar 的单 tab 错误边界捕获、整块渲染成错误条。现已全量迁移到新接口：

  | 旧 | 新 |
  |---|---|
  | `connection.api.sessions.create / fork / rename / selectModel / prompt` | `ctx.remote.session.*`（信封由 `{result:{ok,…}}` 改为扁平 `{ok,…}`；`prompt` 新增必填 `requestId`，由客户端生成 UUID v4） |
  | `connection.api.sessions.models({sessionId})` | `ctx.remote.session.modelCatalog()`（Host 级目录，无会话地址）＋会话的 `modelSelection` **projection**（当前选择改为**订阅**而非轮询，主对话或 `/model` 改模型会自动同步到座位） |
  | `connection.api.sessions.history({sessionId})` 每 1.2s 轮询 | `ctx.remote.session.follow()` 实时流（开窗 + 增量帧）＋ `session.page()` 向上翻页。**追问回答现在是真流式**，不再等轮询节拍 |

- **`inject` 增补 `remote` / `remote.session`**，并且两个 tab 组件改为接收**本插件自己的 ctx**（此前用的是 better-sidebar 传下来的 ctx——cordis 只解析各自 plugin 注入过的服务，而 better-sidebar 并未注入 `remote`，沿用会再次拿到 undefined）。

### Added

- 新增纯模块 `src/client/session-wire.ts`（含 `tests/session-wire.spec.ts`，20 例）：Remote 信封拆封、`requestId` 生成、把 wire 上**打包的 assistant delta run**（`chunkrow/text-chunks` 等）还原成逐 seq 的 `assistant/chunk` 事件——因此 `answer.ts` 的折叠逻辑与其全部单测保持零改动——以及重开 follow 时按 seq 合并窗口（避免覆盖已向上翻页的继承历史）。
- projection 读取抽成共享的 `src/client/use-projection.ts`，上下文占用环与模型座位共用一条路径。

> 部署提醒：**仅 client 半改动**，浏览器硬刷新即可，无需重启 `dsh web`。
> 前置条件：本版本要求 DSH 已包含上述 Remote 迁移（0.16.x 系 DSH）；在更早的 DSH 上请留在 0.4.0。
> 已知上游问题：`dsh-better-sidebar` 0.16.1 的 Side Chat 视图仍在调用 `ctx.connection.api.sessions.history`，在同一版 DSH 上打开该 tab 会报同样的错——那是上游代码，不在本插件范围内。

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
