# Changelog

本项目的版本遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)，日志格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [0.6.0] - 2026-09-XX

### Added

- **原生侧边栏支持（原生优先，向后兼容）**：DSH 自 `0.1.5-alpha.1` 起自带右侧栏（`@deepseek-ai/dsh-client-ui-sidebar-right`，提供 `ctx.sidebarRightTabs` / `ctx.sidebarRight` 与 `sidebar.right.pane.tab` 渲染席位）。本插件现在**直接注册进原生右侧栏，不需要任何额外依赖**；更早的 DSH 上自动回落到 `dsh-better-sidebar`，行为与 0.5.0 一致。
  - 新增 `src/client/sidebar-port.ts`（端口契约 + 后端结构探测 + 服务探针，纯模块）、`src/client/sidebar-better-sidebar.ts` 与 `src/client/sidebar-native.ts` 两个适配器、`src/client/sidebar-install.ts`（后端选择与 tab 安装，无 React）。
  - **原生两段式注册**：阶段一 `ctx.sidebarRightTabs.register({ id, kind, priority: 'extension', title, guide })`（页面类型：无 `patterns`、无 `multiple`）；阶段二 `ctx.slots.inject('sidebar.right.pane.tab', …)` 把 body 注册在**同一个实现 id** 下（席位按 id 分发，不是按 kind）。打开走 `ctx.sidebarRight.openTab(kind, { params })`。
  - **`+` 菜单里看不到自注册类型是设计如此**：原生侧边栏的 `+` 只打开 guide 页，类型靠 guide 条目（上面的 `guide`）暴露，所以本插件为两个 tab 各注册了一个 guide 胶囊。这与 better-sidebar 不同——后者直接在 `+` 菜单里列 tab。
  - `AskPanel` / `HistoryPanel` **不感知后端**：它们面向一个中性的「出现实例」——`tabId` + `revision`（第几次被导航到）+ 能力集（`setTitle` / `takeQuote` / `healVisibility` / `openHistory`），由适配器填充。
  - **原生后端零 `@deepseek-ai/*` 值导入**：全程走 cordis 服务与插槽，client bundle 纯度门不放宽（第三方 bundle 运行期只有 9 个种子词可 `require`，且 DSH 政策禁止特性插件 value-import 或 `dsh.client.external` 另一个特性插件的值）。

### Changed

- **`betterSidebar` 不再是 cordis `inject` 的硬依赖**：此前它在 `inject` 里，任何没装 `dsh-better-sidebar` 的部署都会让**整个插件**不激活。现在改为运行期探测，**两种侧边栏都装不上时插件仍然激活**——划选浮层与「添加到对话」照常可用，只是不注册侧边栏 tab（并记一条 `console.warn` 说明）。
- 面板的标题刷新 / 跨插件引文 / 面板自愈 / 跳转打开**改走端口**，不再直接调 `ctx.betterSidebar.*`。行为等价，但语义更准：引文由适配器保证**只交付一次**；`ensure-panel.ts` 与 `tab-activation.ts` 现在只服务于 better-sidebar 路径（原生 `openTab` 自己会展开栏位，且用 `navigation.revision` 取代 `onActivate`）。
- `SidebarqaTabComponentProps` 收窄：`tab` 只保留 `id`（端口刻意不把后端的 tab 私有字段——better-sidebar 的 `meta` 之类——暴露给面板），新增可选的 `sidebar` 出现实例。
- `src/context-types.ts` 增补原生侧边栏与 `slots` 的服务面镜像并挂 Context augmentation；与上游的漂移仍然只收敛在这一个文件。

### Fixed

以下四条都是**在真实部署上实测发现**（现象：侧边栏里看不到 tab、也不自动展开栏位），按「上游 → 下游」的顺序排列——前两条如果不修，后面两条根本走不到：

- **`ctx.inject` 的每个键都是「必需依赖」，不存在可选形式**（**这条是根因**）。上游 cordis 的 `Fiber._refresh` 会遍历 `Object.keys(this.inject)`，只要有一个键没有实现就把 fiber 置为 `INACTIVE`，因此回调**只在全部服务都存在时**才运行。初版写成 `ctx.inject({ sidebarRightTabs: null, betterSidebar: null }, cb)`，语义是「要求原生侧边栏和 better-sidebar **同时**存在」——现实中不成立，于是 fiber 永久 PENDING、回调一次都没跑，插件什么也没注册，**却仍然打印了正常的激活日志**。`{ name: null }` 不是「可选」，而是「必需，并以 `null` 拦截」。
  现改为 `ctx.get()` 读取（与 `ui-conversation` 的 `conversation` 同一条路，不需要 inject）+ 监听 cordis 的 **`internal/service`** 事件（`ReflectService.notify` 每次 `provide` 都会 emit）做反应式安装，并且在 `createSidebarPort` 里要求原生三件套（`sidebarRightTabs` + `sidebarRight` + `slots`）齐备才落定 —— 只有注册表没有席位，tab 会出现但 body 渲染不出来。
- **原生 tab 类型没注册 guide 条目 → 侧边栏里根本看不到它**。原生右侧栏的 `+` 控件**只打开 guide（引导页）**，并不枚举已注册类型；guide 页才是把类型列成可点胶囊的地方（`GuideBody.tsx:96`：点击 → `tab.actions.openTab(entry.kind, { replaceTab: true })`；内置的工作区文件 / 新建终端 / 浏览器三个入口就是同一机制，见 `ui-sidebar-files/definition.tsx:35` 等）。初版只注册了类型与 body，这两个 tab 因此只能由代码打开——正是「没有 tab」。现为两个类型各注册一个 guide 条目（标题 / 说明按语言实时读取），并新增 `askGuideDesc` / `histGuideDesc` 文案。
- **探测只在 `apply` 时做一次 → 后端晚到时永久不注册**。`sidebarRightTabs` 由 `ui-sidebar-right` 自己的 `apply` 发布，两个 fiber 谁先落地属于组装顺序、不是插件可以假设的。初版探测落空后**不再重试**，只留一条容易被忽略的 warn。
- **探测用错动词**：探测 `betterSidebar` 查的是 `register`，而 better-sidebar 的注册方法叫 **`registerTab`**——没有原生侧边栏、只装 better-sidebar 的部署会被误判为「无侧边栏」。已改为逐服务声明各自动词（原生注册表 / 插槽 = `register`，better-sidebar = `registerTab`）。

四条都补了针对性回归用例（`tests/sidebar-seam.spec.ts` 的「guide 条目到达 DSH」「后端迟到时仍会安装」「等到最后一个服务才落定」「销毁后晚到服务不得重新注册」「不把 register 误认为 registerTab」）。测试替身也一并改对了：它现在**不提供**任何形式的可选 inject（那正是让前三轮「单测全绿、真机全挂」的原因），服务必须通过 `provide()` 事件到达。

- **原生「提问」打开时用的 kind 与注册时不一致 → 点击必然报错**。原生类型有**两个不能互换的名字**：`id`（实现身份，唯一，body 席位按它查找）与 `kind`（`openTab(kind)` 的派发名，`placeTab` 按它查注册表，查不到就抛）。本插件 `id` 用 tab key（`dsh-sidebar-qa:ask`）、`kind` 用短名（`ask`），而初版把 `openAsk` 的 kind 常量从 **key** 推导，于是注册了 `ask` 却去打开 `dsh-sidebar-qa:ask`：
  ```
  sidebarRight: no tab type is registered as "dsh-sidebar-qa:ask"
      at SidebarRightController.placeTab (service.ts:369)
      at Object.openAsk (sidebar-native.ts:226)
  ```
  现改为**注册时记下每个类型实际使用的 kind**（`kindByKey`），打开时用它，两者不可能再分叉；未注册时直接告警返回，不再让异常从点击处理器里逃出去。回归用例改为断言「打开的 kind === 注册的 kind」（断言常量抓不到这类漂移）。
- **原生「提问」前先切到引文所属会话**。原生导航面只作用于**已挂载**的会话面板：`openTab` 会取当前绑定的 seat，没有就抛 `sidebarRight: no session surface is mounted`（`ui-sidebar-right/src/client/service.ts:537`）。而引文是在划选时按当时会话捕获的，用户可能已切走，于是这次打开必然失败。现在打开前若目标会话不是当前会话，先 `sessions.open` 把它切到屏幕上（better-sidebar 的 `openTab` 自带 scope，不受影响）。
- **`SessionListState.current` 这个字段根本不存在 —— 本插件从第一版起就在读一个臆造的字段**（**这是「添加到对话」与选区归属的总根因**）。`SessionListState` 的真实结构是 `{ ids, byId, phase, subagentsByParent, jobsBySession }`（`api/session-controller/src/client/sessions/service.ts:53`），**没有 `current`**，所以 `sessions.list.getSnapshot().current` 恒为 `undefined`。更糟的是**本插件的类型镜像我当初自己加了 `current`**，于是运行时默默返回 `undefined`、编译器也永远报不出来——这个错误因此一直活到了现在。
  DSH 自己的「当前会话」定义在 `ui-workspace/src/client/tree.ts:41`：**主视图 retain 的那个会话**（`retainedBy.mainView > 0`）。现已新增纯函数 `src/client/current-session.ts`（`resolveCurrentSessionId`，9 条单测），替换全部 5 处误用：选区归属与重激活引文清理（`index.tsx`）、composer 目标解析与切换判定（`draft-insert.ts`）、打开前切会话（`sidebar-install.ts`）、追问记录的工作区归属判定（`HistoryPanel.tsx`）。类型镜像里的 `current` 已删除，并按真实结构补齐 `ids` / `phase` / `retainedBy`——删掉假字段后，`tsc` 立刻抓出了最后一处漏改。
- **「添加到对话」在选区没带 sessionId 时被当成不可恢复**。空串来自上一行的假字段。初版把空串当成致命错误直接 `return`，于是**连重试路径也一起被砍掉了**（日志里能看到 `missing-session (selectionSession=<empty>)`）。现在空 id 会**在写入时重新解析**，并且允许下一帧重试。
- **「添加到对话」在会话不在屏幕上时必然失败**。写进 composer 需要该会话的 **Agent scope**，而 `ctx.sessions.scope(id)` 只对**当前已挂载**的会话返回值（`session-controller/src/client/sessions/service.ts:502` → `this.scopes.get(id)`）；scope 拿不到时该按钮只记一条 warn 并返回 false，而浮层在失败时会**保留自身与选区**——于是用户看到的就是「点了没反应」（这次连浮层都不消失）。
  现在按钮先把引文所属会话切到屏幕上（`sessions.open`），并在 scope 仍未被 retain 时**于下一帧重试一次**（scope 由 React reconciliation retain，不是同步的）；失败原因（`missing-session` / `no-conversation-service` / `scope-unavailable` / `threw`）会带 phase 打到 console，不再只有一行含糊的 warn。重试只针对**重试可能修复**的两类（空 id、scope 未 retain），`no-conversation-service` 与 `threw` 不重试，避免噪音翻倍。
- **打开链路的异常不再静默**。浮层在调用之前就把自己关掉了（`SelectionPopover.ask()` 先 `controller.clear()` 再 `onAsk`），因此一旦后半段抛错，用户看到的就是「点了没反应」而没有任何提示。现在 openAsk / openHistory 都会把失败打到 console，并在调用前后各留一条 info 日志，便于区分「没走到」与「走到了但失败」。

### 已知差异（原生后端）

- **已打开 tab 的标题不会随语言切换刷新**：原生 tab 类型的 `title` 在**打开时刻**求值一次并写入布局记录，DSH 没有为已打开的 tab 提供改名入口；better-sidebar 后端有 `updateTab`，那边照旧实时更新。面板内部文案两种后端都实时切换。
- **配置面板暂无 Web 入口**：齿轮「功能配置」弹窗是 better-sidebar 的能力。原生侧边栏下请用 `settings.yaml` 的 `sidebarqa` 命名空间；把配置面板搬进 DSH 官方设置页（`plugins.item` 席位）是后续阶段的工作。
- **跳转只作用于当前屏幕上的会话**：better-sidebar 可以定向打开「不在屏幕上的会话」的侧边栏状态；原生导航面只作用于已挂载的会话 surface（`sessions.open` 之后二者等价）。

> 部署提醒：**仅 client 半改动**，浏览器硬刷新即可，无需重启 `dsh web`。

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
