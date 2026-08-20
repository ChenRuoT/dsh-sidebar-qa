# 依赖侧 Feature Request 草稿（粘贴到 dsh-better-sidebar 仓库）

> 用途：本文件是给 **dsh-better-sidebar** 仓库的 issue 草稿，描述
> "外部按钮触发打开 tab 时缺少面板展开通道"的集成缺口。dsh-sidebar-qa
> 已在消费侧自愈兜底（挂载时 + `onActivate` 桥，见 `src/client/ensure-panel.ts`
> 与 `src/client/tab-activation.ts`），此 issue 用于推动依赖侧提供正规 API。

---

## [Feature Request] 为 type-only openTab 提供面板展开通道（expand 选项 / expandPanel 方法）

### 背景

消费插件常见场景是"点击页面上的外部按钮 → 打开侧边栏 tab 并保证用户看得到"。
但当前 `BetterSidebarService.openTab` 的自动展开只覆盖**内容型打开**
（seed 带 `path`/`url`）；**类型型打开**（seed 只有 `type`，如 + 菜单、外部
插件触发）从不展开面板——`service.ts` 的注释明确写道：
"Type-only opens never expand — the panel behavior is their caller's business"。

问题在于：**调用方没有正规手段来完成这个"panel behavior"**。
`BetterSidebarService` 暴露了 `openTab` / `closeTab` / `activateTab` /
`getSnapshot` / `subscribeState` / `updateTab` / `openFile`…… 但**没有任何
展开/收起面板的方法**；`togglePanel` 只是内部 store reducer，不对 service
调用方开放。于是消费插件只能：

1. 走 DOM hack（模拟点击 `aria-label="展开侧边栏"` 按钮）——脆弱、依赖
   locale 文案与 DOM 结构；
2. 或者借道 tab 组件 props 里的 `SidebarStore` 自愈（`store.reduce` 展开）——
   能用，但要求 tab 已挂载，且绕开了 service 语义。dsh-sidebar-qa 当前的
   兜底组合（见其 [issue #6](https://github.com/ChenRuoT/dsh-sidebar-qa/issues/6)）：
   - **挂载时**展开（tab 首次打开）；
   - **重新激活时**展开：descriptor 的 `onActivate`（对**已激活 tab 的再次
     openTab 聚焦也会触发**）桥接到已挂载组件再展开——覆盖"用户手动收起面板
     后再点「提问」"这一最核心场景。组件侧要为此维护一个模块级监听器桥，
     属于消费侧的额外机械；若 `openTab` 直接支持展开，这整层都能去掉。

### 建议

任选其一（或两者）：

**A. `openTab` seed 增加 `expand?: boolean`（推荐，改动最小）**

```ts
interface OpenTabSeed {
  type: string
  // ...
  /** 类型型打开的显式展开请求：true 时按内容型打开的同一规则
   *  (窄视口展开抽屉 / 宽视口按落点展开右侧或底部面板) 自动展开收起的面板 */
  expand?: boolean
}
```

语义：`expand: true` 让类型型打开复用现有 content-open 的展开逻辑
（`service.ts` 的 auto-expand 块），显式表达"调用方要把 tab 落在视野内"；
缺省 `false` 保持现状（+ 菜单等不希望弹面板的路径不受影响）。

**B. service 暴露 `expandPanel(scope?)` / `collapsePanel(scope?)`**

把 `togglePanel` 等内部 reducer 提升为 service 方法，任何插件都能在
`openTab` 之外独立控制面板几何。

### 需要保留的例外

- **定向打开（targeted open，目标 session 非当前）不自动展开**：目标会话的
  面板用户看不见，展开无意义——`expand` 选项/`expandPanel(scope)` 应遵循
  同样的语义（scope 指向非激活会话时 no-op 或由调用方自行决定）。
- **用户显式收起不应被自动打回**：展开只应在"打开/激活事件"时触发，不要在
  每次快照变化时抢回面板。

### 影响面

- 消费侧（dsh-sidebar-qa 等）：拿到正规通道后替换组件侧自愈（挂载 + onActivate 桥），
  自愈逻辑留作旧版本 fallback。
- 内置路径（+ 菜单、agent 终端自动补 tab）不受影响（不传 `expand`）。

### 参考实现

`service.ts` openTab 的 auto-expand 块（content open 规则）与
`Sidebar.tsx` 中 subagent / jobs 自动激活时的
`store.reduce(s => s.panelOpen ? s : togglePanel(s))` 模式，可直接复用。
