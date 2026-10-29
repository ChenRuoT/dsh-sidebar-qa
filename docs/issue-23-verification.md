# issue #23 验证记录

日期：2026-10-29。对象：[issue #23](https://github.com/ChenRuoT/dsh-sidebar-qa/issues/23)。未修改上游源码、真实用户 profile，也未发布或回复 issue。

## 查证结果

- 报告的故障路径成立：仅凭 `register` 存在选择 namespace，会让读源从插件活引用换成 legacy scope，保存时又把 `sidebarqa` 传给按 profile 行 id 寻址的 `update`。
- **未确认报告者桌面内置产物的具体来源**：官方 [rc.3 settings 源码](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/settings/settings/src/index.ts) 与下载的 npm `@deepseek-ai/dsh-settings@0.2.1-rc.3` 都没有 `register`。不能将其描述为所有 rc.3 都会复现。测试额外在真实 forms 产物上添加 legacy `register`，验证混合形态。
- rc.3 的 [DeepSeek 默认目录](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/llm/llm-deepseek/src/models.ts) 公布 `deepseek-flash`。直接把插件默认值改成新名称会影响旧目录，因此在使用时按实际目录兼容两个名称。
- 上游 fetch 拉到了 `dsh-v0.2.1-rc.3`、`dsh-v0.2.1-rc.4` 和最新 `dsh-v0.2.2-alpha.2`；本地分支 `upgrade/0.2.1-rc.2` 未配置 tracking，`pull --ff-only` 在 fetch 后停止，未合并或切换 checkout。最新远端提交为 `f3803c9697`。

## 修复契约

1. 优先选择 `configure` + `describe/update` 的条目表单能力；这条路径不要求启动中的 fiber 已出现在 `describe()` 列表里，也不调用 legacy `register`。没有条目 id 时拒绝写入。
2. 纯 namespace 服务仍走原路径；不提供 register 的 forms 服务继续按条目 id 寻址。
3. `config` 返回运行期可用的回答模型；`config.get` 保留保存值与 revision。摘要和标题按它们实际使用的 provider 查目录。仅当原名称缺失且另一 Flash 名称存在时切换；自定义 id、已有目录项、空目录和发现失败均保留原值，不写回配置。

## 自动化

`pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过，31 文件 / 455 用例，包含 client bundle purity gate。

- `tests/settings-face.spec.ts`：legacy、无 register 的 forms、混合形态，以及激活期间无 descriptor / 缺行 id 的行为。
- `tests/host-route.spec.ts`：真实插件 `apply` + API 路由，读取 profile 配置、保存后立即生效、旧 revision 返回 409；回答配置、摘要和标题使用新旧目录公布的名称。
- `tests/model-compat.spec.ts`：双向名称切换、两名称并存、自定义模型和无匹配的规则。

## 真实宿主模块验证

用**构建后的 `lib/index.js`** 调用官方 npm settings 产物的真实 `describe` / `update` / volatile 表单校验方法，配合本机上游依赖、真实 `Context` 与 cosmokit 的 `volatileEntries` / `updateVolatile`。config editor 换成内存实现，绕过 settings 构造器的启动迁移，避免访问用户配置。为从工作区加载 npm 产物，仅将外部 import 的解析地址改到本机上游依赖，方法体保持原样。

| Settings 产物 | 原生 forms | 增加 legacy register 的 forms |
|---|---|---|
| 0.2.1-rc.2 | 通过 | 通过 |
| 0.2.1-rc.3 | 通过 | 通过 |
| 0.2.2-alpha.2 | 通过 | 通过 |

六组均得到：读 200、保存 200、活引用立即读到 `trimWindowMessages=19`、旧 revision 409、未声明键 400；有效回答模型为 `deepseek-flash`，profile 中原名称不变，legacy register 调用数 0。

下载的原始 `lib/index.js` SHA256：

- rc.2 / rc.3：`9432b872597b7a31473072eb38a55979ab23375c76bd1d86d751388a692a0136`
- 0.2.2-alpha.2：`78cf7dbdb6dee665e362e721c3608d113a09d5560cda80d612550a8315e1ecba`

本机临时脚本位于工作区根目录 `.tmp/prepare-settings-rc3.mjs` 和 `.tmp/verify-settings-23.mjs`，对应原始 tarball / 解包目录也留在 `.tmp/`。在工作区根目录运行：

```powershell
node .tmp/prepare-settings-rc3.mjs
node .tmp/verify-settings-23.mjs
```

这证明配置与目录适配路径；**不包含报告者桌面内置产物、Electron UI 点击保存、重启后真实 profile 持久化、真实模型可用性或问答质量验收**。旧 namespace 服务由回归假件覆盖，未运行旧版完整宿主。

## 后续：本机完整构建与实际运行验证

同日已将本机上游切到 `dsh-v0.2.2-alpha.2`（`f3803c9697`），清理后完整构建 10 项全部通过。以下验证使用构建后的 CLI、真实 Loader / ConfigEditor / SettingsForms 和本地插件 bundle，取代前节的内存持久化替身。全部使用工作区 `.tmp/host23-*` 隔离目录，没有改动实际用户 profile。

- Web HTTP：初始 profile 配置正确读到 `trimWindowMessages=7` / `answerModel=deepseek-v4-pro`；保存 19 返回 200，运行期立即生效；旧 revision 返回 409，未知字段返回 400；重启进程后仍读到保存值。
- Web UI：Chrome 无头浏览器正常渲染 `0.2.2-alpha.2-f3803c9` 主界面，未捕获 pageerror。
- 模型目录：测试渠道仅公布 `deepseek-flash`，保存值仍为 `deepseek-v4-flash`，有效回答模型解析为 `deepseek-flash`。标题调用通过真实 provider 适配器到 loopback 测试服务，记录的 `/v1/messages` 请求 model 为 `deepseek-flash`，返回标题“验证成功”。测试服务提供固定 SSE 响应，不验证真实远端模型服务、成本、回答质量。
- Desktop：先用官方 `start:desktop` 重建运行载荷；随后用户提供的 `C:/Users/20554/Documents/DeepseekHarness/start-dsh-desktop.ps1 -Check` 返回 ready，使用其快速路径启动隔离桌面。`dsh-app://app/` 主界面正常，插件 applied，原生右侧栏两个 tab 注册成功。
- Electron 设置页：打开“设置 → 追问”，正确显示 19；在数字输入框改成 23、Tab 失焦提交，真实 `config.update` 返回 200；运行期读到 23，profile 文件也写入 23，未捕获 pageerror。未运行完整划选追问和真实远端模型对话。

证据均位于工作区根 `.tmp/`：`host23-http-results.json`、`host23-runtime-results.json`、`host23-model-requests.jsonl`、`host23-desktop-results.json`、`host23-desktop-settings.png`、`host23-fast-desktop.log`、`upstream-build-0.2.2-alpha.2.log`。

宿主启动日志另有 `No handler registered for 'dsh-desktop:mandatory-status'`，以及开发模式 Electron CSP 提示；主界面、插件注册和设置保存均正常。本次未修改这部分上游代码，不将桌面启动描述为完全无日志错误。
