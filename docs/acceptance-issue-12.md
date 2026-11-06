# Issue #12 原生检测页面与共享后台验收

验收日期：2026-11-06。范围：把检测入口迁移到 DSH 原生侧边栏与主区域页面，后台改为用户级共享实例，并验证构建、安装、生命周期与旧数据隔离。本文区分真实 DSH 宿主、受控模型、单元测试和静态产物检查；未执行项单列，不以模拟结果代替真实桌面应用窗口验收。

## 1. 源码、宿主与平台

| 项 | 值 |
|---|---|
| 集成分支基线 | `integration/issue-12-native-desktop-panel` tip `adcd783`（含 ADR 0002） |
| 验收分支 / worktree | `worktree-agent-acae7b6884212140a` / `/Users/jxq/agent_work/dsh-intelligence-check/.claude/worktrees/agent-acae7b6884212140a` |
| 实现提交 | `f4b2584`（本验收文档随后单独提交） |
| DSH CLI | `/usr/local/bin/dsh` → `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`；`dsh --version` = `0.2.2-rc.1` |
| 平台 | macOS 27.2（Darwin 27.2.0），arm64 |
| 构建工具 | Go `1.27.3 darwin/arm64`；Node `v26.13.0`；Playwright（Edge channel / 缓存 Chromium） |
| 模型 | 全部为回环地址上的受控 OpenAI 兼容服务，经宿主 `llm-pi-ai` 注册；未使用真实付费模型或凭据 |

## 2. 最终产物

从 `f4b2584` 的同一源码执行 `node scripts/build-client.mjs` 与 `node scripts/build-release.mjs` 生成。下表为初始实现轮记录；审查修复后的最终产物以第 8 节为准，旧 `dist` 不得用于交付。

| 产物 | SHA-256 |
|---|---|
| `plugin/client.js`（76,923 B） | `3a9b71b0b2b611abfeedac33e3e03ac9771c7b0a1f3cb913cc0fe5780b16848c` |
| `dist/dsh-intelligence-check-darwin-arm64.tgz` | `6ad9376115c78d37f82efe1799c321b8b1f409364547523b789741470322bb3d` |
| `bin/quality-check-darwin-arm64` | `9b86c7d705b32e60356e7a7c8f72b487145d95b9c8c4e470cfe4bf6835159cc9` |
| `dist/quality-check-darwin-arm64` | `9b86c7d705b32e60356e7a7c8f72b487145d95b9c8c4e470cfe4bf6835159cc9` |
| `dist/quality-check-darwin-amd64` | `7a64b5c8218d779aa6f3bea497250ad46ffd24910ebb1e1c8ad5715ed7874ab6` |
| `dist/quality-check-linux-amd64` | `9ce41922353d3cc793e60d5262c34498f948aaad9ef2009705d5618ce3ff8e5c` |
| `dist/quality-check-linux-arm64` | `9c39eea03874279acf4f3899f195a3bb96b38bf4fc9bad339ed5d38e3fde49c7` |
| `dist/quality-check-windows-amd64.exe` | `8441c60e54fe428d2e54bb7f1a515b4249c284f68856ed12d18c53ddbc677a1e` |

`dist/SHA256SUMS` 的五个平台包与五个后台共 10 项与构建输出一致（上表列出其中 6 项）；checked-in `bin/quality-check-*` 已由同一源码重建。

## 3. 真实 DSH 宿主验收

以下命令均设置 `DSH_PLUGIN_PACKAGE=dist/dsh-intelligence-check-darwin-arm64.tgz`，不设置 `DSH_INTELLIGENCE_CHECK_TEST_BINARY`/`binaryPath`；插件从 tarball 安装并使用包内二进制。每个检查使用独立 `mkdtemp` 的 `DSH_HOME` 与工作目录，结束时删除。

| 检查 | 覆盖 | 结果 |
|---|---|---|
| `node scripts/dsh-profile-check.mjs` | tarball 安装/卸载；用户级 `$DSH_HOME/dsh-intelligence-check` 建库且不在 profile 目录建库；原生侧边栏“模型质量检测”入口与同 id 主区域页面；四个标签页；原生页面手动运行 milk/HTML/SVG、HTML iframe 与 SVG 预览、ModelTrace 报告、历史、检测预算设置；两个桌面 profile 共享目标/记录/评审且只有一个后台；第二个 profile 不覆盖桌面模型目录；CLI/Web profile 在桌面后台运行时仅连接并看到同一状态，不启动第二套后台；owner 退出后剩余实例接管并保留 SQLite 状态；无桌面后台时纯 CLI 宿主不启动/接管且页面 API 返回 503；热禁用与 HMR 重新启用后记录仍在 | PASS（浏览器 UI 已验证） |
| `node scripts/dsh-lifecycle-check.mjs` | 完整/缺用量/宿主错误/截断/取消/独立复测/同名目标隔离/取消后重跑/重启持久化 | PASS |
| `node scripts/dsh-auto-check.mjs` | 自动检测默认关闭与 900 秒默认间隔；仅监测目标 milk；无业务对话触发；关闭开关、取消监测、移除目标后停止；并发合并；每日预算与清理不返还；重启恢复配置；退出取消活动调用并清理后台；开关与间隔通过原生页面设置 | PASS（浏览器 UI 已验证） |

`dsh-profile-check` 中两个 profile 同时运行时共享后台进程数为 1；owner 退出后进程数回到 0，剩余 profile 的页面在后续请求中重新选举并继续读取同一批记录。CLI 宿主启动日志为 `CLI host detected; the shared desktop backend is not started`。

## 4. 非宿主检查

| 命令 | 结果 |
|---|---|
| `go vet ./...` | PASS |
| `go test -race ./...` | PASS，82 项，2 个包 |
| `node scripts/build-client.mjs` | PASS，生成 `plugin/client.js` |
| `node --test plugin/*.test.mjs scripts/ui.test.mjs` | PASS，24 项 |
| `node scripts/package-check.mjs` | PASS：包标识、`dsh.client.platform = web`、`exports['./client']`、图标、五平台包布局、可执行位、checksum、无 Go 源码 |
| `node scripts/install-check.mjs` | PASS：当前平台 tarball 解压后客户端 bundle 可加载、共享后台可启动、页面 API 可用并清理进程 |

新增/更新的行为测试覆盖：

- Go：非共享数据目录被占用时拒绝；共享 joiner 读取 owner 连接信息、`connection.json` 为 0600、owner 收到 SIGTERM 后连接文件删除。
- 插件：桌面判定与数据目录；CLI/Web 宿主只读取共享连接信息并连接已运行桌面后台，不派生进程、不接管、不推送自身模型目录，桌面后台退出后返回 503；CLI/Web 先于 Desktop 启动时，后续请求会重试只 join 的连接；两个 profile 共享单后台、单模型目录权威、owner 接管后继续接收模型目录更新；原生页面 API 拒绝未认证宿主请求并转发预览 CSP/Permissions-Policy；joined 实例不停止 owner 进程。
- 客户端：模块加载器单工厂契约、侧边栏与 main 注册、空状态、四个标签页渲染、共享纯函数（用量缺失不显示为零、缓存用量不重复计推理、预览会话过期等）。

## 5. 验收边界与未执行项

- **真实 DSH 桌面应用窗口已由独立验收补充**。报告 `/tmp/dsh-issue-12-desktop-validation.md` 在真实打包 `DeepSeek Harness.app` `0.2.2-rc.1` 中完成侧栏入口、原生四标签、fixture 目标/检测、历史回答与退出清理，均 PASS；同时实测 Desktop 固定 `$DSH_HOME/profiles/desktop`，并复现旧实现下无桌面标记的第二 profile 在桌面后台存活时仍 503。该完整 GUI 验收针对修复前 `b2d5259` 产物。审查修复后另用最终 tarball 做轻量真实 Desktop 复核（侧栏、页面标题、四标签、连接状态与退出无残留）PASS，见第 8 节；未用最终产物重跑完整 fixture 检测与自动调度 GUI 流程。
- **真实执行的平台只有 darwin-arm64**。其余四个平台仅完成交叉编译、包布局、可执行位、checksum 与无 Go 源码检查，未在对应系统启动 DSH。
- **生产定时未等待**。自动检测使用 1–2 秒短间隔验证调度；默认 900 秒由状态断言覆盖。
- **Cloudflare 与旧网页控制台兼容接口未重跑**。它们不是 Issue #12 的原生入口依赖；Go 内嵌控制台保留为兼容接口，本轮未执行 `cloudflare-check.mjs` 与 `auth-browser-check.mjs`。
- **未发布、未推送、未关闭 Issue**。按任务边界只提交本地分支，未创建 PR、未发布包。

## 6. 隔离与旧数据

- 所有真实宿主检查使用独立 `DSH_HOME`，未读取或改写用户真实 `~/.dsh` 配置、profile 或旧数据。
- 新数据固定在 `$DSH_HOME/dsh-intelligence-check/`；验收断言新版不在 `$DSH_HOME/profiles/<name>/dsh-intelligence-check/` 创建数据库。
- 本机旧数据 `/Users/jxq/.dsh/profiles/desktop/dsh-intelligence-check/check.db` 未被读取、迁移、覆盖或删除；新版按不同路径使用空数据启动。
- 测试进程、临时 profile、受控模型服务均在脚本 `finally` 中关闭并删除。

## 7. 复现命令

```sh
go vet ./...
go test -race ./...
node scripts/build-client.mjs
node --test plugin/*.test.mjs scripts/ui.test.mjs
node scripts/build-release.mjs
node scripts/package-check.mjs
node scripts/install-check.mjs

export DSH_PLUGIN_PACKAGE="$PWD/dist/dsh-intelligence-check-darwin-arm64.tgz"
unset DSH_INTELLIGENCE_CHECK_TEST_BINARY
node scripts/dsh-profile-check.mjs
node scripts/dsh-lifecycle-check.mjs
node scripts/dsh-auto-check.mjs
```

## 8. 审查修复后的最终提交与产物

修复提交为 `9f859dd0fa65f5edad407173d4f1a94c4dd059b0`，补修提交为 `1b0a9283bed511983f9a9b0ea3f8ee503207a6f5`（CLI 先于 Desktop 启动时的请求时补连、README 兼容段）；两轴逐项处理与证据见 [审查修复记录](review-issue-12.md)。本轮只改插件、客户端 bundle、集成脚本与文档，Go 源码未变，因此五平台后台哈希与初始实现轮一致；tarball 因新 `plugin/client.js` 与文档更新而更新。

从最终源码（修复提交 `9f859dd`、补修提交 `1b0a928`）连续两次执行 `node scripts/build-client.mjs` 与 `node scripts/build-release.mjs`，两次 `dist/SHA256SUMS` 完全一致：

| 产物 | SHA-256 |
|---|---|
| `plugin/client.js`（76,892 B） | `73dffc85781365fcd835d89c4e9a7e8016e06d178efd3bdd84a627f6538826c5` |
| `dist/dsh-intelligence-check-darwin-arm64.tgz`（6,912,832 B） | `d761c8a2af7913a003d96010079309c60868a6d517499dbed9dc5c013cd7c9bb` |
| `dist/quality-check-darwin-arm64`（12,933,858 B） | `9b86c7d705b32e60356e7a7c8f72b487145d95b9c8c4e470cfe4bf6835159cc9` |
| `dist/quality-check-darwin-amd64` | `7a64b5c8218d779aa6f3bea497250ad46ffd24910ebb1e1c8ad5715ed7874ab6` |
| `dist/quality-check-linux-amd64` | `9ce41922353d3cc793e60d5262c34498f948aaad9ef2009705d5618ce3ff8e5c` |
| `dist/quality-check-linux-arm64` | `9c39eea03874279acf4f3899f195a3bb96b38bf4fc9bad339ed5d38e3fde49c7` |
| `dist/quality-check-windows-amd64.exe` | `8441c60e54fe428d2e54bb7f1a515b4249c284f68856ed12d18c53ddbc677a1e` |
| `dist/SHA256SUMS` | `cddb548072c8f6fac1092b992b51dde5869a19d2dcd2ba6eed785140e8c296ed` |

`dist/SHA256SUMS` 的十项产物全部通过 `package-check` 校验；解包后的 `package/plugin/client.js` 与上表客户端哈希一致，证明 tarball 不再缺客户端 bundle。`install-check` 通过。主检出中遗留的旧 `dist/` 不得作为交付物；最终集成必须使用本节产物或从最终提交重新构建。

最终 tarball 的真实宿主与产品检查：

| 检查 | 结果 |
|---|---|
| `node --test plugin/*.test.mjs scripts/ui.test.mjs` | PASS，24 项；含“CLI/Web 先启动、Desktop 后启动”时请求重试只 join 的回归，CLI 不派生也不接管后台 |
| `dsh-profile-check.mjs`（最终 tarball，Playwright Web UI） | PASS：跨 profile 共享、CLI/Web 仅连接、桌面退出/接管、模型目录权威、CSP/Permissions-Policy 实际响应头、HTML/SVG 预览 |
| `dsh-lifecycle-check.mjs`（最终 tarball） | PASS：完整/缺用量/错误/截断/取消/独立复测/同名目标/重启持久化 |
| `dsh-auto-check.mjs`（最终 tarball，Playwright Web UI） | PASS：自动检测默认关闭、仅监测目标、关闭/移除停止、预算、重启与退出清理 |

最终产物真实 Desktop 轻量复核使用隔离 `DSH_HOME=/tmp/dsh-issue12-final-check/home`，通过桌面应用自带的 `dsh plugin --profile desktop add` 安装最终 tarball（安装后 `plugin/client.js` 与 `quality-check` 哈希与上表一致），Playwright 启动真实打包 App：侧栏“模型质量检测”点击后主区域 `.dic-page` 标题为“模型质量检测”，四个标签存在，状态“已连接”；`app.close()` 后 4 秒无匹配该隔离目录的 Host/后台进程。证据：`/tmp/dsh-issue12-final-check/shots/01-initial.png`、`02-native-page.png`、`evidence.json`。未读取用户 `~/.dsh` 配置或旧数据库，未调用付费模型。

剩余限制：最终产物未重跑完整真实 Desktop fixture 检测与自动调度 GUI（完整桌面 GUI 证据来自修复前 `b2d5259` 报告）；其他四平台未在对应系统启动 DSH；生产 15 分钟/180 秒未实际等待；Cloudflare 与旧网页兼容接口未重跑；未推送、未发布、未关闭 Issue。
