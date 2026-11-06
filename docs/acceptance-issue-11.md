# Issue #11 最终安装与整体迁移验收

验收日期：2026-11-06。范围：从最终官方 bundle tarball 在真实、隔离的 DeepSeek Harness（DSH）profile 中完成安装、功能与生命周期验收。本文区分真实宿主、受控模型、单元/受控替身和静态产物检查；未执行项单列，不以打包或模拟结果代替真实宿主运行。

## 1. 源码、宿主与平台

| 项 | 值 |
|---|---|
| 集成基线 | `integration/dsh-native` tip `901fcd658690070a48cdb02dc0272eb56349bd65`（验收开始与结束均确认当前分支为同一 tip，无新增合并） |
| 验收实现提交 | `c65bee626a781a609248ca26c31e72736ced412c`（最终二进制、脚本与文档；验收文档随后单独提交） |
| 验收分支 / worktree | `worktree-agent-ac3883dcdcf4073dc` / `.claude/worktrees/agent-ac3883dcdcf4073dc` |
| DSH CLI | `/usr/local/bin/dsh` → `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`；`dsh --version` = `0.2.2-rc.1`；App `CFBundleShortVersionString` = `0.2.2-rc.1` |
| DSH 兼容参考 | 上游 tag `dsh-v0.2.2-rc.1`，commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`（与安装版按版本号对应；未做安装包与 tag 的逐字节比对） |
| 平台 | macOS 27.2（build 26B123），arm64（Darwin 27.2.0） |
| 构建工具 | Go `1.27.3 darwin/arm64`（仅构建时使用）；Node `v26.13.0`；Playwright `1.57.0` |
| 浏览器 | 最终记录使用 Chrome for Testing 153（`chromium-1243`）无头运行；`auth-browser-check` 使用系统 Edge channel |
| 运行时 PATH | 真实宿主检查的 PATH 为 `/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin`，`command -v go` 为空；安装后的后台来自 tarball 内二进制 |

## 2. 最终产物

最终 tarball 从 `c65bee6` 工作树重新构建；连续两次 `build-release` 的全部 SHA-256 完全一致。

| 产物 | SHA-256 |
|---|---|
| `dist/dsh-intelligence-check-darwin-arm64.tgz`（6,866,709 B） | `f31007bedb6a41a01dc4bcb5acd417c6102df7ef51fc80098d6b90a49410d5d6` |
| `dist/quality-check-darwin-arm64`（12,933,698 B） | `72fa8402962b974cc43d29de12d862f320eaa03e9247c6cd83210bc2e1bd6215` |
| `dist/quality-check-darwin-amd64` | `5390baff45100f4c168ce356c80aa8dae5cd3604680b4974c6b268ac74ea1fa4` |
| `dist/quality-check-linux-amd64` | `8918a37767d82235ea905a0a50f1efbd1a0203f3b21dcb3ac0b8aea9534c4400` |
| `dist/quality-check-linux-arm64` | `0ea34fdda1caeb1257c02a948736b3ea9d0ffc1b5c0225b64967cc5c01430654` |
| `dist/quality-check-windows-amd64.exe` | `c75db57932d66a250e212fd4bb70054f86f2900e04895c7b6f946b68dacac0bb` |

`dist/SHA256SUMS` 五项平台包与五项后台 `shasum -a 256 -c` 全部 `OK`；`dist/manifest.json` 与 checked-in `bin/quality-check-*` 均与最终源码构建一致。

另在独立 `DSH_HOME` 中执行 `dsh plugin --profile probe add dist/dsh-intelligence-check-darwin-arm64.tgz`，确认 profile manifest 将 `dsh-intelligence-check` 加入 bundle，安装目录 `node_modules/dsh-intelligence-check/bin/quality-check` 的 SHA-256 为 `72fa8402962b974cc43d29de12d862f320eaa03e9247c6cd83210bc2e1bd6215`，与上表最终后台二进制一致。该探针 profile 已删除。

## 3. 真实宿主验收

以下命令均设置 `DSH_PLUGIN_PACKAGE=dist/dsh-intelligence-check-darwin-arm64.tgz` 且不设置 `DSH_INTELLIGENCE_CHECK_TEST_BINARY`，因此由 `dsh plugin --profile <name> add <tarball>` 安装发行包，插件使用包内 `bin/quality-check`，没有 developer 目录或 `binaryPath` 覆盖。每个检查使用独立 `mkdtemp` 的 `DSH_HOME` 与工作目录，结束时删除；模型服务为监听回环地址的受控 OpenAI 兼容服务，经宿主 `llm-pi-ai` 配置注册，不调用付费模型。

| 检查 | 真实宿主覆盖 | 结果 |
|---|---|---|
| `node scripts/dsh-profile-check.mjs` | tarball 安装/卸载、宿主入口 401→302、控制台一次性链接、双 provider 同名模型目录、UI 选择/保存/重启、同 profile 跨会话共享配置/记录/评审、跨 profile 目标/记录/评审/配置隔离、运行中 `disabled: true` 热禁用与 HMR 重新启用、退出后无后台残留 | PASS |
| `node scripts/dsh-lifecycle-check.mjs` | 完整回答与 17 tokens、宿主未报告用量保持缺失、宿主 500 错误、截断部分回答、取消并保留部分回答、取消后重跑、milk 异常独立复测（两条独立记录：failed → passed）、跨 provider 同名目标隔离、重启后结束状态/用量/错误码/复测记录持久化 | PASS |
| `node scripts/dsh-auto-check.mjs` | 自动检测默认关闭、默认间隔 900 秒、仅监测目标执行 milk、无业务对话触发、关闭开关/移除目标后停止、同目标定时与手动运行合并、每日预算与清理历史不返还预算、短间隔 1–2 秒、重启恢复配置与监测目标、退出取消活动调用并清理后台；开关与间隔经浏览器 UI 操作 | PASS |
| `node scripts/browser-check.mjs` | 七题原文、provider + model 路由、实时增量、回答/评估/17 tokens 持久化、检测运行与检测失败时业务会话均正常返回、测试题原文不进入业务 session、历史筛选/同题比较/JSON 导出/下载/复制、人工评审与自动评估分离及刷新/重启读取、HTML/SVG 隔离预览与多尺寸、手动 ModelTrace 完整/无效/取消批次与闭集归因、重启后记录/评审/作品 | PASS |
| `node scripts/auth-browser-check.mjs` | 控制台一次性票据、跨站打开、会话 Cookie 重定向与刷新（Go 后台受控入口，不依赖 DSH 宿主） | PASS |

`dsh-profile-check` 的 HMR 步骤在宿主运行中向 profile patch 追加 `disabled: true`，观察到后台进程退出；移除后 HMR 重新加载并恢复后台，目标与记录仍在。

## 4. 非宿主检查

| 命令 | 结果 |
|---|---|
| `go vet ./...` | PASS |
| `go test -race ./...` | PASS，79 项，2 个包 |
| `node --test plugin/*.test.mjs` | PASS，18 项 |
| `node --test scripts/ui.test.mjs` | PASS，4 项 |
| `node scripts/build-release.mjs`（连续两次） | PASS，五平台 10 个产物 SHA-256 一致 |
| `node scripts/package-check.mjs` | PASS：包标识、`dsh.bundle`、图标、五平台布局、唯一平台可执行文件、可执行位、checksum、无 Go 源码 |
| `node scripts/install-check.mjs` | PASS：当前平台 tarball 解压后自带可执行后台、插件启动并签发控制台 |
| `cd dist && shasum -a 256 -c SHA256SUMS` | PASS，10/10 `OK` |
| PATH 无 Go 检查 | PASS，`no-go-on-PATH`；安装与运行未使用 Go |

## 5. 验收边界与未执行项

- **真实执行的平台只有 darwin-arm64**。linux-amd64、linux-arm64、darwin-amd64、windows-amd64 仅完成交叉编译、包布局、可执行位、checksum、无 Go 源码与包内二进制一致性检查，未在对应系统实际启动 DSH。
- **生产 15 分钟间隔未等待**。自动检测以 1–2 秒短间隔验证调度行为；默认值 900 秒由状态断言与重启持久化检查覆盖。
- **生产 180 秒超时未完整等待**。由 Go 单元测试（如 `TestHostBridgeHonoursCallerDeadline`、ModelTrace 截止时间分支）与统一错误路径覆盖；真实宿主矩阵使用受控错误/取消，未实际等待 180 秒。
- **Cloudflare 临时通道未重跑**。它不是 DSH 原生入口的依赖，需要外部网络；本票的 DSH 入口为本机回环和宿主同源路由。`auth-browser-check` 仅验证本机管理链接授权。
- **未使用真实模型凭据或付费模型**。所有模型调用均由宿主路由到本机受控 OpenAI 兼容服务。
- **未发布、未推送、未上架市场**；按任务边界仅提交本地分支。
- 一次 Edge 无头运行在后台重启后的 `page.goto` 出现“browser has been closed”的浏览器进程异常；同一脚本使用缓存 Chromium 153 重跑完整通过，过程中没有产品断言失败。最终记录以上表的 Chromium 运行为准。

## 6. 隔离与旧数据

- 所有真实宿主检查使用独立 `DSH_HOME`，未读取或改写用户真实 `~/.dsh` 配置与 profile 数据。
- 新数据固定在 `$DSH_HOME/profiles/<name>/dsh-intelligence-check/`；同一 profile 共享，跨 profile 隔离，卸载不删除数据目录。
- 本机未发现旧版 `~/.config/dsh-intelligence-check` 数据目录；实现不引用该路径，验收未创建或修改任何旧版/真实 profile 数据。
- 测试进程、临时 profile 与受控模型服务均在各自脚本 `finally` 中关闭并删除。

## 7. 复现命令

```sh
export PATH=/private/tmp/dsh-implementation.A0txhQ/tools/go1.27.3/bin:$PATH
export GOROOT=/private/tmp/dsh-implementation.A0txhQ/tools/go1.27.3
export GOPATH=/private/tmp/dsh-implementation.A0txhQ/tools/gopath
export GOMODCACHE=/private/tmp/dsh-implementation.A0txhQ/tools/go-mod-cache
export GOCACHE=/private/tmp/dsh-implementation.A0txhQ/tools/go-build-cache

go vet ./...
go test -race ./...
node --test plugin/*.test.mjs
node --test scripts/ui.test.mjs
node scripts/build-release.mjs
node scripts/package-check.mjs
node scripts/install-check.mjs
(cd dist && shasum -a 256 -c SHA256SUMS)

export DSH_PLUGIN_PACKAGE="$PWD/dist/dsh-intelligence-check-darwin-arm64.tgz"
unset DSH_INTELLIGENCE_CHECK_TEST_BINARY
node scripts/dsh-profile-check.mjs
node scripts/dsh-lifecycle-check.mjs
node scripts/dsh-auto-check.mjs
PLAYWRIGHT_EXECUTABLE="/Users/jxq/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" node scripts/browser-check.mjs
```
