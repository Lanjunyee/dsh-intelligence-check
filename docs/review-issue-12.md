# Issue #12 统一审查修复记录

基线为集成分支 `integration/issue-12-native-desktop-panel` tip `b2d5259`；修复提交 `9f859dd0fa65f5edad407173d4f1a94c4dd059b0`，补修提交 `1b0a9283bed511983f9a9b0ea3f8ee503207a6f5`（CLI 先启动的延迟连接与 README 兼容段）。本记录随后单独提交。审查输入为 `/tmp/dsh-issue-12-review-fix-input.md` 的两轴报告，逐项核实后处理如下。

## Standards 轴

| # | 审查项 | 核实与处理 | 验证 |
|---|---|---|---|
| 1 | `backend.mjs` 用空 `catch` 包裹无抛错路径的 `stop()` | 属实。`stop()` 只等待退出，`ensure()` 已删除 `try/catch`，直接 `await stop()`。 | 现有 owner 退出/接管回归通过。 |
| 2 | 原生页面使用“人工审核/审核”，偏离 GLOSSARY 的“人工评审” | 属实。`client-panel.js` 的标题、字段、状态、筛选、确认文案统一为“人工评审 / 评审”；`client-core.mjs` 中的动词改为“复核”。兼容保留的 Go 内嵌页面不改写，仍按其历史验收记录运行。 | 搜索确认原生页面无“审核”；客户端与 UI 测试通过。 |
| 3 | `docs/dsh-migration.md` 的 ADR 0002 链接不存在 | 属实。两处改为实际文件 `adr/0002-desktop-panel-and-shared-check-state.md`。 | 链接目标存在。 |
| 4 | 连续两次相同的 `healthy()` 判断 | 属实，删除重复调用。 | 插件测试通过。 |
| 5 | `consoleUrl`、脚本 `requests`、`useMemo` 为死代码 | 属实。README 已声明插件不再签发控制台链接，删除 `consoleUrl`；删除 `dsh-profile-check` 只写不读的 `requests`；删除未使用的 `useMemo`。 | `node --check`、插件测试通过。 |
| 6 | `openConsoleSession` 名实不符且返回 `console`/`client` 双别名 | 属实。重命名为 `openPageSession`，只返回 `{client, payload}`；三个集成脚本统一改用 `client`。 | 语法检查与真实宿主检查通过。 |
| 7 | 只在初始 owner 时订阅模型目录事件，接管后不再更新 | 属实。桌面宿主无论初始是否为 owner 都注册 `llm/adapters-updated` 与 `llm/models-updated`；`syncCatalog` 仍以当前 `owner` 为准。 | 新增接管后目录更新回归先失败后通过。 |

## Spec 轴

| # | 审查项 | 核实与处理 | 验证 |
|---|---|---|---|
| 1 | 非桌面标记的第二 profile 在桌面后台运行时仍 503；CLI/Web 不应启动或接管后台，也不应覆盖桌面模型目录 | 属实。非桌面宿主现在只读取共享数据目录的 `connection.json` 并连接已运行后台，`manage: false` 保证不派生进程、不参与接管；模型目录事件只在桌面宿主注册，`owner=false` 时不推送。桌面应用未运行时保持 503；若 CLI/Web 先启动、Desktop 后启动，请求时会再次只执行 attach，无需重启 CLI 宿主。 | 单测新增“CLI 仅 join、不启动、不覆盖目录、桌面退出后 503”与“先 CLI 后 Desktop 的请求时补连”；真实 DSH 宿主脚本新增运行中 CLI profile join 与无桌面时 503 断言。 |
| 2 | README 声称在桌面使用 `--profile <name>`，但 Desktop 固定 `profiles/desktop` | 属实。宿主源码与真实验收均确认固定 `$DSH_HOME/profiles/desktop`。安装、开发与卸载说明改为 `--profile desktop`，并说明其他 profile 供 CLI/Web 连接共享后台。 | 真实 Desktop 以 `--profile desktop` 安装成功并出现侧栏入口。 |
| 3 | 宿主代理剥离 HTML 预览的 CSP/Permissions-Policy | 属实。`SAFE_HEADERS` 增加两项，恢复 Go 预览的 `sandbox allow-scripts`、`connect-src 'none'` 等策略。 | 单测用真实代理链路断言响应头；真实 DSH 宿主脚本对预览响应断言 CSP 与 Permissions-Policy。 |
| 4 | 接管后模型目录只同步一次 | 与 Standards #7 同一修复。 | 同上。 |
| 5 | ADR 链接错误；`docs/acceptance-issue-11.md` 的旧 profile 隔离边界需标注 | ADR 链接已修；Issue #11 文档仅新增历史边界说明，声明该节验收事实已被 Issue #12 共享设计取代，未改写旧事实。 | 文档检查。 |
| 6 | 主检出 `dist` 为旧产物，tarball 缺 `client.js`，package-check 失败 | 本轮从 `9f859dd` 源码重建全部产物；`bin/quality-check-*` 与旧 Go 源码构建一致（Go 未改动），tarball 内含新 `plugin/client.js`。主检出的旧 `dist` 不得用于交付，最终集成需以本轮产物或再次同源重建为准。 | 连续两次 `build-release` 哈希一致；`package-check`、`install-check` 通过；解包校验 `client.js` 哈希。 |

## 真实 Desktop 证据与限制

独立代理在真实 `DeepSeek Harness.app` `0.2.2-rc.1` 上完成完整 GUI 验收，报告见 `/tmp/dsh-issue-12-desktop-validation.md`：侧栏入口、原生四标签、fixture 检测、历史回答、退出后进程清理均 PASS；同时确认 Desktop 固定 `profiles/desktop`，且旧实现的无标记第二 profile 在桌面后台存活时返回 503。该报告针对修复前 `b2d5259` 产物，未暴露需要额外修复的产品错误。

本轮另用最终 tarball 做轻量真实 Desktop 复核（隔离 `DSH_HOME`，不读取用户配置/旧数据，不调用付费模型）：侧栏点击后 `.dic-page` 标题为“模型质量检测”，四个标签存在，状态“已连接”，退出 4 秒后无 Host/后台残留。证据：`/tmp/dsh-issue12-final-check/shots/01-initial.png`、`02-native-page.png`、`evidence.json`。未用最终产物重跑完整 fixture 检测与自动调度 GUI 流程；这些仍分别由 `b2d5259` 的真实 Desktop 报告和最终 tarball 的真实 DSH Web 宿主检查覆盖。

## 本轮验证

| 检查 | 结果 |
|---|---|
| `go vet ./...` | PASS |
| `go test -race ./...` | PASS，82 项，2 个包 |
| `node --test plugin/*.test.mjs scripts/ui.test.mjs` | PASS，24 项（含先 CLI 后 Desktop 的请求时补连） |
| `node scripts/build-release.mjs`（连续两次） | PASS，10 项 SHA-256 一致 |
| `node scripts/package-check.mjs` | PASS |
| `node scripts/install-check.mjs` | PASS |
| `dsh-profile-check.mjs`（最终 tarball） | PASS（浏览器 UI；含 CLI join、CSP 头、接管目录） |
| `dsh-lifecycle-check.mjs`（最终 tarball） | PASS |
| `dsh-auto-check.mjs`（最终 tarball） | PASS（浏览器 UI） |
| 真实 Desktop 轻量复核（最终 tarball） | PASS（侧栏/页面/标签/连接/退出清理） |

`dsh-profile-check`、`dsh-lifecycle-check` 与 `dsh-auto-check` 在补修前的同一源码 tarball 上完成；补修只增加 CLI/Web 先启动时的请求重试与 README 兼容段说明，未改变桌面后台、检测或调度路径。补修后的最终包通过 24 项插件/UI 测试、`package-check`、`install-check` 与最终 Desktop 轻量复核。

## 最终产物

| 产物 | SHA-256 |
|---|---|
| `plugin/client.js`（76,892 B） | `73dffc85781365fcd835d89c4e9a7e8016e06d178efd3bdd84a627f6538826c5` |
| `dist/dsh-intelligence-check-darwin-arm64.tgz`（6,912,832 B） | `d761c8a2af7913a003d96010079309c60868a6d517499dbed9dc5c013cd7c9bb` |
| `dist/quality-check-darwin-arm64` | `9b86c7d705b32e60356e7a7c8f72b487145d95b9c8c4e470cfe4bf6835159cc9` |
| `dist/SHA256SUMS` | `cddb548072c8f6fac1092b992b51dde5869a19d2dcd2ba6eed785140e8c296ed` |

五平台完整哈希见 `dist/SHA256SUMS`；解包后的 `package/plugin/client.js` 与上表客户端哈希一致。
