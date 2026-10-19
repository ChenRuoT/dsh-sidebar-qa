# dsh-sidebar-qa 后续更新路线图

> 起点：`1.2.0`（2026-10-15）· 参考上游：DSH `0.2.1-rc.2`（checkout `D:\dsh\deepseek-harness`）· 编写日期：2026-10-19
>
> 本文是**计划**，不是承诺：版本号与日期随上游 DSH 的发布节奏调整，但**优先级顺序**（兼容 → 可靠 → 功能）不应调整。

---

## 0. 一页结论

1. **先发 `1.2.1` 热修，不等下一个 minor。** 有两个已经生效、用户能感知的缺陷必须优先修：
   - **局域网 / `--trusted-host` 用户访问 `/sidebarqa/api` 全 403**：DSH `0.2.1-alpha.1` 删除了 `webRuntime` 服务，`src/index.ts` 的信任围栏回退读到未求值表达式，静默退化为 loopback-only（host 半，需重启 `dsh web`）。
   - **追问面板在当前 DSH 世代不再流式；轮次失败时永久停在「生成中…」**：插件只折叠已不再产生的 `assistant/chunk`，且忽略新的 `assistant/attempt` 错误记录与 opt-in 的 `assistant-stream`（client 半，硬刷新）。
2. **`1.3.0` 把「可控」补齐**：停止生成、steer、上下文降级可见、失败可重试、可跳大窗口。这些是面板从「能用」到「可信」的分水岭。
3. **`1.4.0` 把追问会话变成可管理的资产**：可寻址多标签、历史检索（issue #4）、可选的自动归档、持久化加固。
4. **`1.5.0` 补齐输入与入口**：修掉「添加到对话」清空 `@` 引用 chip 的问题，加入 composer/header 入口、`/ask` 命令与快捷键。
5. **`2.0.0` 只做一件大事**：用 DSH 官方 Conversation 内核替换自维护 transcript（先做一周 spike），一次性拿到官方流式、工具卡、审批与 Markdown 渲染，并稳定对外 seam。

**一句话排期**：`1.2.1`（10 月下旬，~1 周）→ `1.3.0`（11 月下旬）→ `1.4.0`（12 月下旬）→ `1.5.0`（2027-01）→ `2.0.0`（2027-Q1）。

**这轮不做**：不注册 `ctx.sessionTitle`（上游独占）、不默认自动归档、不引入任何运行期依赖、不改 DSH 源码、不做账号/云端同步。

---

## 1. 现状判断（证据）

### 1.1 上游已经变了，而本插件还按上一代契约写

| 变化 | 上游证据 | 对本插件的实际影响 |
|---|---|---|
| `webRuntime` 服务被删除，改为 `webStartup` + `webServer.host` | `packages/bundle/web-app/cordis.patch.yml:236-241`、`packages/bundle/web-app/src/startup.ts:23-42` | 信任围栏静默退化为 loopback-only（**P0**） |
| `engines.dsh` 存在时**单独决定**兼容性，peer 被忽略 | `packages/boot/app-boot/src/plugin-compatibility.ts:55-80` | `tests/dsh-compat.spec.ts` 与 AGENTS/README 的「peer 纯下限」叙事已过时；`engines.dsh` 成为唯一装载闸（**P1**） |
| session 日志不再写 `assistant/chunk`；成功写 `assistant/message`，失败/中断写 `assistant/attempt`（含 stream），实时流是 opt-in | `packages/core/agent-loop/src/agent.ts:468-546`、`packages/api/session-controller/src/types.ts:505-531` | 面板失去流式；轮次失败无 UI（**P0**） |
| `follow` 请求支持 `assistantStream: true` | `packages/api/session-controller/src/types.ts:508` | 恢复流式的正规通道 |
| 会话取消已开放 `remote.session.cancel()`，prompt 支持 `mode:'steer'` | `packages/api/session-controller/src/index.ts:510-515`、`.../client/contract/session.ts:82-89` | 「停止」与「打断」都可实现，面板目前没接 |
| `SessionInput.setDraft` 契约明确「整段替换并移除引用 chip」，新增 `inputActions.insertText/captureInsertion` | `packages/client/ui-conversation/src/client/contract/input.ts:184-186,247-269` | 「添加到对话」会清掉用户草稿里的 `@` chip（**P1**） |
| 右侧栏新增资源型 tab / `keepMounted` / tab 菜单 / close handler / refresh 快捷键 | `packages/client/ui-sidebar-right/src/client/tab-registry.ts:63-130`、`.../contract/slots.ts:84-183` | 多追问并存、常驻、菜单动作都有正规 API，不必继续用单一 page tab |
| 平台种子词从 9 个变为 11 个（新增 `zod`、`@tanstack/react-virtual`） | `packages/client/web/src/platform.ts:8-15` | 纯声明更新；也说明「9 个种子词」文档会过时 |
| `dsh` 升级到 `0.2.1-alpha.2` 起，profile 不允许覆盖安装 | `docs/upgrade-guide/v0.2.1-alpha.2/plugin-install-over-installed/guide.md`、`packages/boot/plugin-manager/src/tools.ts:87` | README / release notes 的升级步骤要改成 remove → install |

### 1.2 本项目的强项与真正的短板

- **强项**：约束文档、失败复盘、纯函数测试（28 个 spec / 381 用例）都很扎实；host/client 半边构建、i18n、错误边界、类型镜像都有明确规则。
- **短板**（这决定了路线图的顺序）：
  1. **测试只覆盖纯函数**：`orchestrate.ts`、`trust-fence.ts`、host 路由分派、`followSession`、全部 React 面板没有测试；`answer.spec.ts` 恰好把「只有 chunk 事件」的过期假设钉死，掩盖了 0.2.x 的流式失效。
  2. **宿主契约靠静态镜像 + 手工核对**：0.2.1 的 `webRuntime` 删除就是这样漏过去的；需要「能力探测 + 桩契约测试 + 真实宿主 smoke」三层。
  3. **面板只读不控**：没有停止、重试、steer、跳大窗口；上下文降级（`degraded`）全项目无人消费。
  4. **会话资产靠 localStorage**：多窗口互相覆盖、无自动修剪、无检索；PR #7 的自动归档因此只能算半成品。

### 1.3 社区信号

- 54 stars / 7 forks；活跃 issue：#4（会话管理与消息搜索，owner 已回应「消息搜索欢迎 PR」）、#6（面板收起无反馈，1.0.0 已结构性修复但未关闭）、#18（`codeLabels`，1.0.1 已修未关）、#19（`settings.register`，1.0.1 已修未关）。
- PR #7（自动归档）基于 0.3.x 时代实现，现已 `CONFLICTING`；不应直接合并，应按当前架构重做为**可选**能力。
- **维护者只有一条发布线**，所以版本的尺度必须小、可回滚、每个版本只讲一个主题。

---

## 2. 路线图原则

1. **兼容优先**：上游每个 minor 都可能删服务、改主键、换事件。新 DSH 发布后 **5 个工作日内**完成核对；能 `ctx.get()` 探测的绝不写进 `inject`；类型桩在核对后立即精确钉新版本。
2. **先修「看得见」再修「想得到」**：流式、错误、停止、降级提示属于「用户能感知的正确性」，排在检索、资源 tab、嵌入面板之前。
3. **每个 minor 一个主题**，patch 只修 bug/兼容/文档，不夹带功能。
4. **host 与 client 分开交付、分开写部署提示**：host 改动需重启 `dsh web`，client 改动硬刷新即可。
5. **不新增运行期依赖**；构建期依赖（`@deepseek-ai/schemastery`）继续 `noExternal` 打包。
6. **所有新的可从 UI 触达的逻辑先落到纯模块 + spec**；组件层至少补 jsdom 冒烟，避免再次出现「单测全绿、真机崩」。

---

## 3. 版本计划

### v1.2.1 — 兼容性与可见性热修（目标 2026-10 下旬，3–6 天）

> 主题：**让 0.2.x 用户重新「看得到」**。不发新功能，只发正确性。
>
> **状态（2026-10-19）**：1–5 已完成（30 文件 / 443 用例，typecheck / test / build 全绿；流式已在本机 desktop 重启后目测确认）；6 待 GitHub 操作；`package.json` 仍是 1.2.0，待 `pnpm version patch`（会自动同步 `dsh.plugin.json`）后发版。

| # | 项目 | 改动位置 | 验收标准 | 量 |
|---|---|---|---|---|
| 1 | **P0 信任围栏迁移到 `webStartup`** | `src/index.ts` 的 `buildApi`/围栏装配、`src/trust-fence.ts`；新增 `webStartup` 探测镜像（`context-types.ts`，注明上游出处） | ① `Host: <bind-ip>:<port>` 放行；② `--trusted-host app.example` 与 `trustedHosts` 列表放行；③ 非 loopback 未授权 Host 仍 403；④ `Origin` 规范化（含 https 默认端口）与上游 `api-request-trust.ts` 一致；⑤ 回归 `tests/trust-fence.spec.ts`（新增）+ 路由层 403/200 用例 | S/M |
| 2 | **P0 恢复流式 + 轮次失败可见** | `src/client/session-wire.ts`（`follow` 传 `assistantStream:true`，消费 `start/chunk/end`）、`src/client/answer.ts`（折叠 `assistant/attempt`，标记 interrupted/failed）、`AskPanel.tsx` 渲染错误行 | ① 首 token 在流中逐段出现；② provider 报错时面板显示失败原因，而非永久「生成中…」；③ 中断的回答仍显示已生成部分；④ `tests/answer.spec.ts` 增加 message/attempt 两代事件用例，并**保留**旧 chunk 用例做兼容 | M |
| 3 | **兼容叙事与闸门同步** | `tests/dsh-compat.spec.ts`、`engines.dsh`、`dsh.plugin.json`、AGENTS.md / CLAUDE.md / README 的「peer 纯下限」段落 | 说明改为「`engines.dsh` 独占决定装载」；验证 `>=0.1.7-alpha.1` 在 0.2.1-rc.2 上通过；manifest 与 `package.json` 版本/engines 一致 | S |
| 4 | **类型桩对齐 0.2.1-rc.2** | `package.json` 两个 `@deepseek-ai/*` devDependency（精确钉） | `pnpm install && pnpm typecheck && pnpm test && pnpm build` 全绿；`tests/primitives.spec.ts` 从桩自身读世代 | S |
| 5 | **README 事实修正** | `README.md` / `README_EN.md` | ① 配置面板是「8 个常用键」而非「12 个配置键」（`config.ts` 共 12 字段，面板只暴露 8）；② 删除/修正「流式」表述到与 1.2.1 行为一致；③ 测试清单补 `dsh-compat` / `live-config` / `panel-boundary` / `panel-icons` / `primitives` / `settings-face`；④ 升级步骤改为 `dsh plugin remove` → `add`（0.2.1-alpha.2+） | S |
| 6 | **Issue / PR 清理** | GitHub | #6 / #18 / #19 逐条复验后关闭并留言版本；#4 打 `feature` + 拆「检索」子项；PR #7 留言「按新架构重做，opt-in，默认关」后关闭或转 issue | S |

**发布注意**：1、3、4 是 host 半（重启 `dsh web`）；2 是 client 半（硬刷新）；CHANGELOG 必须分别标注。

---

### v1.3.0 — 可控与透明（目标 2026-11 下旬，约 2–3 周）

> 主题：**面板从「只读」变成「可操作、可解释」**。

1. **停止生成（stop）** [S/M]
   - 镜像 `ctx.remote.session.cancel({ sessionId })`（`context-types.ts`，注明 `session-controller/src/index.ts:510-515`），面板输入区在 answering 阶段显示停止键；停止后显示「已停止」并保留部分回答。
   - 关闭/切走面板时提供「停止正在运行的轮次」选项（默认只停视图，不杀 turn——保持现状语义，但让用户可选）。
2. **steer 追问** [S]
   - 现有 `sendFollowUp` 固定 `mode:'queue'`；在回答进行中发送时用 `mode:'steer'`（上游契约支持），并在 UI 上区分「排队」/「打断」。
3. **失败可见、可重试** [M]
   - 消费 `AskResult.degraded`：摘要失败/无 provider/网络失败时，在面板首条消息上方显示一条可关闭的「上下文不完整」说明（含原因）。
   - `orchestrate.ts`：prompt 失败时清理刚创建的子会话（或先入映射再 prompt，失败标记 `failed`），不再留下「DSH 里有、追问记录里没有」的孤儿。
   - 标题重命名：把 `markTitled` 移到成功之后；失败允许下一次 turn/end 再试一次（上限 2 次）。
   - `followSession` 断流重连（指数退避 + 一次 warn），长开面板不再静默停更。
4. **「在会话中打开」** [S]
   - AskPanel 顶部入口：`showSessionFirst` + 切主视图，便于看工具调用/审批/完整日志。
5. **上下文装配修正** [S]
   - `inherit` provider 继承时同时传 `model`（当前只传 provider，非 DeepSeek 渠道会回落到固定 `summarizeModel`，压缩静默失败）。
   - 空引文不再注入空 `<quoted_context>`。
6. **测试补齐** [M]
   - 新增 `tests/orchestrate.spec.ts`（fork 降级、rename/selectModel best-effort、modelOverride effort 语义、标题只触发一次、孤儿清理）。
   - 新增 `tests/trust-fence.spec.ts` + host 路由分派用例（403/404/405/envelope）。
   - `followSession` 的断流/重连/assistant-stream 帧用例（扩展 `session-wire.spec.ts`）。

**验收**：0.2.x 真机上「提问 → 首 token 流式 → 停止可用 → 失败有原因」全链路走通；`pnpm test` 覆盖到 orchestrate / trust-fence / host 路由。

---

### v1.4.0 — 会话资产化（目标 2026-12 下旬，约 3–4 周）

> 主题：**让追问成为可检索、可并存、可管理的会话资产**。对应 issue #4 的剩余部分。

1. **可寻址资源 tab + 多追问并存** [M/L]
   - `sidebarRightTabs.register({ patterns: ['dsh-resource://sidebarqa/**'], canOpen, multiple: true })` + `openResource(地址, { params })`；地址编码 `session/<父>/<子>`；一个追问一个 tab，`revealIfOpened` 去重。
   - 保留现有 `ask` page tab 作为「当前会话的默认入口」，避免破坏旧书签/旧调用；新资源 tab 逐步接管。
   - 迁移：localStorage 的父子映射保持兼容，新增 tab 不依赖新存储即可工作。
2. **`keepMounted` + close handler** [S]
   - 切会话/切 tab 不 unmount 面板，保留流式状态与输入草稿；`registerCloseHandler` 清理 pending 引文与 follow 订阅。
3. **tab 菜单项** [S]
   - `sidebar.right.tab.menu.item`：复制引文、重新提问、归档追问、在会话中打开。
4. **追问检索（issue #4）** [M]
   - 历史面板增加搜索框：优先用宿主 `ctx.sessions.search(query, signal)`（Host 可见消息索引）按会话命中过滤树；无该服务时降级为标题/引文子串过滤。
   - 压缩/裁切策略的「可选消息检索」：在最近窗口之外按关键词检索父会话历史，把命中片段一并注入（先做成 per-ask 开关，默认关；成本与收益先实测）。
5. **自动归档（重做 PR #7）** [S/M]
   - 配置项 `autoArchiveAfterLeave`，**默认 false**；只有「完成且切走」才归档，运行中/当前打开的不动；激活时不做批量归档（旧 PR 的存量清理语义太激进）。
   - 提供「恢复」入口（`uiWorkspace.unarchiveSession`）。
6. **持久化加固** [M]
   - `store.ts`：监听 `storage` 事件合并多窗口写入；版本化存储 key；对已删除/归档会话的行做惰性修剪（不再只靠手动移除）。
   - 长期方案（可放 1.5）：把父→子映射迁移到 host 侧（profile 文件或 DSH 会话元数据），实现跨浏览器一致；localStorage 作为迁移源保留一个版本。

**验收**：同一父会话下可同时打开多个追问 tab；追问记录可搜索；多窗口同时提问不丢映射；自动归档默认不改变任何现有用户行为。

---

### v1.5.0 — 输入与入口（目标 2027-01，约 2–3 周）

> 主题：**缩短「想追问」到「发出问题」的路径，并修复输入框副作用**。

1. **修「添加到对话」清空 `@` chip** [M]
   - 放弃 `SessionInput.setDraft`，改用 session 作用域 slot 暴露的 `inputActions.captureInsertion()` + `insertText()`（上游契约 `input.ts:247-269`），实现「光标处插入引用块」而不是整段替换。
   - 降级路径：拿不到 slot 时退回 `setDraft`，但先在浮层/日志中标注「会丢失引用 chip」。
2. **入口扩展** [S/M]
   - `conversation.session.header.actions` 或 `conversation.input.right` 注册一个小按钮，直接打开当前会话的追问面板。
   - `ctx.commandUi.register('/ask')`：对当前选区/剪贴板发起追问；`ctx.shortcuts.register` 给同一动作绑定快捷键（与 DSH 冲突时以宿主优先）。
   - guide 条目加 `commandId`，`+` 页也能看到「追问」入口。
3. **选区体验** [S]
   - 超长（>2000 字）/跨消息/流式中选区被拒时给出一次性提示，而不是静默无浮层。
   - 浮层做视口翻转（顶部/右侧不越界）；支持「多段引用」作为 P2（先设计数据结构，不实现）。
4. **分发** [S]
   - 发布到官方 plugin market 索引（`docs/user/guide/plugin-market.md`），每版写清 `engines.dsh` 与支持矩阵；发布说明补 0.2.1+ 的 remove→install 升级路径。
5. **设置入口迁移到统一插件设置页** [M]（用户 2026-10-19 提出）
   - **上游现状**：插件配置应在 **Plugins 页 → 该 bundle 的页面 → Configuration** 展示——root keyed 席位 `plugins.bundle.config`（key = **bundle 包名**，`packages/client/ui-plugin-manager/src/client/PluginManagerPage.tsx:782`），由 `ctx.configForms.whileServed([entryId], …)`（`packages/client/ui-settings/src/client/config-form.ts:236,285,308`，服务含 `get` / `whileServed`）判断宿主是否为该条目提供了可服务表单；`dsh-context` 是现成参考（`ctx.inject(['configForms'])` + `slots.inject('plugins.bundle.config', …)`，注册自定义卡片并保留自己的控件）。
   - **本插件现状**：仍注册成 `settings.section` 的独立「追问」整页（1.0.0 的选择，当时统一插件页还不存在）；功能可用，但不是上游现在的入口惯例。
   - **方案**：新增 `client/plugin-settings-slot.ts`（纯探测 + 注册，可测）：`ctx.get('configForms')` 具备 `get` / `whileServed` 时，用 `whileServed(['sidebar-qa'])`（**profile 条目 id**，不是包名）门控，向 `plugins.bundle.config` 注册 key=`dsh-sidebar-qa`（**包名**）的卡片，复用现有 `ConfigPanel`（保留模型渠道/模型下拉与 revision 乐观锁）；拿不到 `configForms` 的旧宿主回退现有 `settings.section`。两条路径**互斥**，避免出现两个配置入口。
   - **注意命名双轨**：与 `dsh-context` 不同（它的 row id 恰好等于包名），本插件 row id 是 `sidebar-qa`、包名是 `dsh-sidebar-qa`——slot key 用包名，configForms 的 namespace 用条目 id，二者不能互相推导。
   - **验收**：DSH 0.2.1 桌面版 Settings → Plugins → `dsh-sidebar-qa` → Configuration 出现「追问」卡片，保存生效且无重复入口；旧宿主仍回退到原「追问」设置页；接线守卫测试只允许 `plugin-settings-slot.ts` 知道 `plugins.bundle.config`。
6. **i18n / a11y 小修** [S]
   - zh-TW/zh-HK 至少明确回退策略（当前按 `zh` 前缀走简体）；面板按钮补 `aria-label`；`AskPanel` 切换条在长列表下可滚动。

**验收**：草稿含 `@` chip 时「添加到对话」不再清空 chip；从 header 按钮、`/ask`、快捷键三个入口都能打开面板；选区被拒有反馈；统一插件设置页出现本插件的 Configuration 卡片。

---

### v2.0.0 — 原生对话内核（目标 2027-Q1，约 6–8 周，含 1 周 spike）

> 主题：**不再自己画对话**。用 DSH 官方 Conversation 组件承接追问会话的渲染与交互。

1. **Spike（1 周，先做，可失败）** [M]
   - 按 `ui-subagent` 的 sidebar-chat 范式（`packages/client/ui-subagent/src/client/sidebar-chat/index.tsx:102-169`）验证：`SessionProvider` + `renderFactorySlot('conversation.content', { variant:'embedded', phase, hero })` 能否在右侧栏 tab 内渲染一个**非当前主视图**的会话。
   - 产出结论：可用的最小参数、需要的 session-scope slot、与现有 `keepMounted` / 资源 tab 的兼容性。**若 spike 失败，2.0 退回「自维护 transcript 的深度优化」，不硬上。**
2. **嵌入官方 Conversation** [L]
   - 追问 tab 改为渲染官方 Conversation：流式、工具卡、审批、Markdown、复制、停止按钮一并获得；只保留本插件特有的「引文 + 策略 + 模型座 + 切换条」外壳。
   - 这会自然淘汰 `answer.ts` 的自维护 transcript（保留为 fallback，用于资源加载失败时）。
3. **对外 seam 稳定化** [M]
   - 明确并文档化 `openAsk` 的稳定参数（quote/role/messageId/sessionId）、资源地址格式、tab kind/id；加 `docs/` 与跨插件示例。
   - 若必须改动现有 `openTab(kind)` 语义，提前一个 minor 发 deprecation，2.0 再移除。

**验收**：追问面板里能看到工具调用与审批；流式/停止由官方内核保证；现有 `openAsk` 调用不破坏；所有 host 路由与 widget 行为有回归。

---

## 4. 持续轨道（每个版本都做，不单独占版本号）

| 轨道 | 动作 | 触发时机 |
|---|---|---|
| **兼容哨兵** | 盯 DSH release / upgrade-guide；核对 6 个触面（右侧栏注册表+席位、`remote.session` 动词、`session-query`、`llm`、`webServer`/`webStartup`、`SettingsForms`、平台种子词、图标名）；类型桩精确钉新版本；5 个工作日内出 patch | 每次 DSH 发布 |
| **发布门禁** | `typecheck → test → build →` 真机 smoke（划选/提问/流式/停止/设置保存/LAN 访问）；`engines.dsh` 与 `dsh.plugin.json` 同步 | 每次发布 |
| **质量** | 覆盖率门槛（先定 70% 行覆盖，纯模块必须 90%+）；组件 jsdom 冒烟；可选 Playwright 冒烟（登录→划选→提问） | 1.3.0 起 |
| **文档** | README 与 CHANGELOG 每次发布前对照代码事实（配置键数量、测试文件数、支持矩阵）；升级步骤随 DSH 版本更新 | 每次发布 |
| **社区** | issue 首次响应 ≤ 7 天；`good first issue` 标签；PR #7 类旧补丁给出明确处置 | 持续 |

---

## 5. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 上游再次删除/改名服务（如 0.2.1 的 `webRuntime`） | 高 | 高 | 结构探测 + `ctx.get`；每个 DSH 版本做一次「服务面 diff」；关键接缝写「能力缺失时的降级」测试 |
| 类型桩与运行时漂移，`tsc` 放行但运行期炸 | 中 | 高 | 桩精确钉 + `tests/*-labels` 式钉住装好的桩；升级后先 `tsc` 再真机 smoke |
| 自维护 transcript 持续追赶宿主（0.2.x 的坑就是证明） | 高 | 中 | 1.3.0 先修到可用；2.0 用 spike 决定是否换成官方 Conversation |
| 资源 tab / 多标签迁移破坏旧书签与外部调用 | 中 | 中 | 保留旧 page tab 一个版本；地址格式与 `openAsk` 先文档化；迁移期双写 |
| 自动归档误伤用户正在读的追问 | 中 | 高 | 默认关；只归档「已完成且非当前打开」；提供恢复入口；先灰度一个小版本 |
| 维护者时间被兼容修修补补吃掉，功能路线搁浅 | 高 | 中 | patch 只做兼容；每个 minor 只承诺 1 个主题；P2 池坚决延后 |
| 组件层无测试导致「单测全绿、真机崩」 | 中 | 高 | 1.3.0 起引入 jsdom 组件冒烟；`containPanel` 与错误边界保留为最后防线 |

---

## 6. 12 周指标（用于判断路线图是否有效）

- **正确性**：0.2.1 宿主上 LAN 访问 200（回归用例）；首 token 可见延迟 < 1s；停止请求 100% 生效；失败轮次 100% 有可读原因。
- **质量**：测试文件 28 → 34+；`orchestrate` / `trust-fence` / host 路由 / `followSession` 全部有 spec；行覆盖率 ≥ 70%。
- **响应**：新 DSH 版本发布 → 兼容结论 ≤ 5 个工作日；open issue 中「已修未关」数量 = 0。
- **社区**：issue 首次响应 ≤ 7 天；插件进入官方 market 索引（1.5.0 目标）。

---

## 7. 非目标（明确不做，避免路线图膨胀）

- 不注册 `ctx.sessionTitle.register`（上游独占，内置提供者已占用）。
- 不默认自动归档、不自动删除任何 DSH 会话。
- 不做云同步、账号体系、服务端组件；插件保持第三方独立 npm 包、零运行期依赖。
- 不修改 DSH 源码，不为 `ui-sidebar-right` / `ui-layout` 声明 `dsh.client.external`。
- 不做多模型并排对比、导出 PDF、移动端原生适配（放入 P2 池，等 2.0 稳定性数据）。

---

## 8. 本周执行清单（把计划变成动作）

1. [ ] 建 issue「0.2.1 信任围栏退化：`webRuntime` 已删除」并附上游证据链接；同日开 `hotfix/1.2.1-trust` 分支。
2. [ ] 写 `tests/trust-fence.spec.ts`：先让旧实现红（LAN Host 403），再改实现绿。
3. [ ] 写 `tests/answer.spec.ts` 的新用例：`assistant/attempt` 错误 → 面板有失败行；`assistant-stream` 帧 → 流式文本增长（先红）。
4. [ ] 改 `session-wire.ts` 传 `assistantStream:true`，补 `start/chunk/end` 折叠；改 `answer.ts` 折叠 attempt。
5. [ ] 升级类型桩到 `0.2.1-rc.2`，跑 `pnpm install && pnpm typecheck && pnpm test && pnpm build`。
6. [ ] README/AGENTS/CLAUDE 的兼容叙事与配置键数量修正；`dsh-compat.spec.ts` 改为 engines 独占语义。
7. [ ] GitHub：关闭 #6/#18/#19（附版本与复验结论）、给 #4 打标签并拆分、处置 PR #7。
8. [ ] 发 `1.2.1`（`pnpm version patch` → push tag），release notes 分列 host/client 部署提示。

---

## 附：P2 候选池（不排期，等前面完成后再评估）

- 多模型并排对比（同一引文跑两个模型）。
- 追问导出 Markdown / 分享只读链接。
- 提示词模板与常用问题库（自定义快捷指令）。
- 多段引用 / 跨消息选区 / 代码块选区保留语言标记。
- 追问会话置顶与标签。
- 面板内搜索当前追问消息。
- 移动端 / 触屏浮层适配。
- zh-TW / zh-HK 完整词表。
- 更强的本地统计（追问数量、token 成本估算）。
