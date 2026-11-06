# Issue #19 回归清理、诊断改进与验证记录

记录日期：2026-11-06。范围：父规格 #19 及其子任务 #20、#21、#22。本文汇总本轮测试脚本清理与诊断改进、实际运行的验证、对 `docs/acceptance-issue-13.md` 二进制选择链的更正、沿用的历史证据和未重跑项。产品功能、Go 后端、插件包内容与真实桌面验收范围不变。

## 1. 结论

- #20 以 `fadce65` 合入集成分支 `integration/issue-19-regression-cleanup`（合并提交 `ca98b8b`），#21 以 `ef6c92c` 合入（合并提交 `b6a6a30`）；两者均已评论结果并关闭。本记录不关闭或评论任何 Issue。
- 模型归因回归在成功和已进入资源管理范围的失败路径上，先关闭本次浏览器、宿主和受控服务，再删除本次隔离 home/work；原始错误保留，清理失败可见。
- 共享进程查询/等待、浏览器入口最后一次点击错误、`Continue` 弹层、`PLAYWRIGHT_MODULE` 提示和单次配置内联已落地；各调用方原有的隔离目录过滤、0/1 数量断言和超时保留。
- #13 验收记录已更正：恢复回归实际使用仓库 `backendBinary()` 选择的副本，不是包内后台；历史命令、结果、产物哈希，以及副本与包内后台哈希一致的事实均保留。
- 本轮只修改 `scripts/*.mjs` 和文档；包内跟踪文件聚合哈希保持 `10cd15331bd3dad39a5de0e228d0abc1385e23852a61488ca1a1d3a9544c9fb0`，未重新构建发行包，未重跑真实桌面验收。
- 主代理使用已安装的 headless shell 完成最终故障补验（`bm5aijjyj`，驱动 `/tmp/issue19-fault-validation.mjs`）：驱动 exit 0，两故障命令均 exit 1，本次 home/work 不存在、各自整个 TMPDIR 无存活进程。
- 后续两轴审查的必修项已修复：profile/auto 经共享可选加载边界给出 `PLAYWRIGHT_MODULE` 提示但保留缺依赖跳过 UI 的语义，profile 的 console error 监听前移到共享 `openNativePage`，新增注释改为中文，仅收敛真正多点复用的加载边界；插件重复进程断言删除。详见第 11 节。

## 2. 基线与范围

| 项 | 值 |
|---|---|
| 父规格 | Issue #19（完善回归环境清理、验收证据准确性与测试诊断） |
| 子任务 | #20 资源清理与受控回答；#21 共享观测与入口诊断；#22 证据更正与记录 |
| 集成基线 | `integration/issue-19-regression-cleanup` 起点 `64d9832`（Issue #13 最终验收提交） |
| 代码集成 tip | `b6a6a30`（合并 #21；此前 `ca98b8b` 合并 #20）；其后 `732c827` 仅合入 #22 文档提交，不改代码 |
| #20 实现 / 合并 | `fadce65` / `ca98b8b` |
| #21 实现 / 合并 | `ef6c92c` / `b6a6a30` |
| 本轮代码变更 | 仅 7 个 `scripts/*.mjs`：`dsh-auto-check.mjs`、`dsh-harness.mjs`、`dsh-lifecycle-check.mjs`、`dsh-profile-check.mjs`、`dsh-recovery-check.mjs`、`native-attribution-check.mjs`、`plugin-check.mjs` |
| 包内跟踪文件 | `git diff --name-only 64d9832 b6a6a30` 不含 `plugin`、`assets`、`bin`、`third_party`、`README.md`、`LICENSE`、`cordis.patch.yml`、`package.json`；聚合哈希不变 |
| 平台与工具 | macOS 27.2（Darwin 27.2.0），arm64；Node `v26.13.0`；Go `go1.27.3 darwin/arm64`；DSH `0.2.2-rc.1` |
| 模型 | 仅本机回环受控 OpenAI 兼容服务；未使用真实凭据或付费模型 |

## 3. 实现摘要

### 3.1 #20：归因回归资源清理与受控挑战回答

- `scripts/native-attribution-check.mjs` 从共享 harness 取得本次 `home`/`work`，在 `catch` 之后执行清理：关闭本次浏览器、停止 `hosts` 中的每个宿主、关闭受控 HTTP 服务，再删除本次 home/work。不扫描或删除历史临时目录。
- 原测试错误保留并重新抛出；若同时发生清理错误，抛出包含原始错误在前的 `AggregateError`；仅清理失败时也以非零退出暴露。
- 单次零参数 `patch()` 包装内联到 `installProfile` 调用。
- 受控回答不再用 `prompt.includes('1 到 355')` 兜底，也不默认生成 300 个数字；只解析 `(\d+)\s*个\s*1 到 355`，无法解析时输出明确诊断并返回 HTTP 500。可归因、拒答与用量语义不变。

### 3.2 #21：共享进程观测、入口诊断与夹具收敛

- `scripts/dsh-harness.mjs` 新增唯一进程查询边界 `backendProcesses(dataDir)` 和 `waitForProcessCount(dataDir, count, {timeout, message})`；调用方继续传入隔离目录、精确数量、超时和失败消息，轮询间隔统一为 50ms。
- 共享 `loadPlaywright` 负责模块解析与加载：必需调用（`launchChromium`）缺少模块或 `require` 失败时抛出含 `PLAYWRIGHT_MODULE` 的提示；可选调用返回 `undefined` 并输出同样提示。模块和浏览器选择方式不变，不自动安装。
- `openNativePage` 保留 20 次入口点击重试；全部失败时抛出最后一次真实点击错误，不再落入 `.dic-page h1` 的 30s 通用超时。首次进入弹层支持 `/^(继续|Continue)$/`，以匹配实际观测到的英文 `Continue` 按钮。
- `dsh-recovery-check.mjs`、`dsh-profile-check.mjs`、`dsh-auto-check.mjs`、`plugin-check.mjs` 改用共享进程查询/等待；profile/auto 复用共享入口操作。删除单次配置包装和未使用的 SSE `finish` 参数。

### 3.3 保留的就地实现

- `plugin/index.test.mjs` 的进程查询仍为就地实现：其 `waitUntil` 返回布尔值、供 `assert.ok` 使用，超时 8000ms，属于 plugin 单元测试边界。
- `dsh-recovery-check.mjs` 的 `waitUntil` 保留，因为还用于模型请求、取消信号等非进程条件等待。
- `dsh-lifecycle-check.mjs` 的 SSE `finish` 参数保留，`truncate-model` 实际使用 `finish: 'length'`。
- `dsh-profile-check.mjs` / `dsh-auto-check.mjs` 使用共享 `loadPlaywright({optional: true})`：缺少模块或模块加载失败时仍跳过浏览器 UI，同时输出含 `PLAYWRIGHT_MODULE` 的提示；只有共享 `launchChromium` 保持硬性失败。

## 4. 本轮实际运行与验证

### 4.1 静态语法

主代理在合入 `b6a6a30` 后，使用 Node `execFileSync` 对 `git diff --name-only 64d9832` 得到的 7 个 `.mjs` 逐个执行 `node --check`，全部通过：

```text
scripts/dsh-auto-check.mjs
scripts/dsh-harness.mjs
scripts/dsh-lifecycle-check.mjs
scripts/dsh-profile-check.mjs
scripts/dsh-recovery-check.mjs
scripts/native-attribution-check.mjs
scripts/plugin-check.mjs
```

更正说明：`/tmp/issue-21-implementation.md` 原记录的 `node --check file1 file2 …` 多参数命令只会检查第一个文件，不能据此声称全部 6 个文件已检查。上表结果来自主代理对 7 个文件的逐个复核，不复制原多参数命令作为全量通过依据。

### 4.2 插件与 UI 测试

主代理运行 `node --test plugin/*.test.mjs scripts/ui.test.mjs`，退出 0，25 pass / 0 fail。该结果针对本轮未改动的 `plugin/*.test.mjs` 与 `scripts/ui.test.mjs`。

### 4.3 模型归因资源清理（#20）

| 场景 | 结果 |
|---|---|
| 改前成功运行 | `EXIT=0`，但遗留 `dsh-ic-attribution-home-*` 与 `dsh-ic-attribution-work-*` 两个隔离目录，确认 #19 所述泄漏 |
| 改后成功运行 | `EXIT=0`，`native attribution check passed`；本次 `dsh-ic-attribution-*` 目录 0 个，无引用本次目录的存活进程；空状态、成功报告、拒答错误和切回成功报告通过 |
| 无效 Playwright | `PLAYWRIGHT_MODULE=/nonexistent/playwright`，`EXIT=1`；保留原始 `AssertionError: 缺少 Playwright 模块：/nonexistent/playwright`；本次目录 0 个，无存活进程 |
| 无效 DSH 二进制 | `DSH_BINARY=/nonexistent/dsh`，`EXIT=1`；保留原始 `TypeError: Cannot read properties of undefined (reading 'trim')`；本次目录 0 个 |
| 历史目录 | 改后运行期间，改前泄漏的两个目录仍存在，未被扫描或批量删除；最终收尾时按确切路径清理，见第 9 节 |

### 4.4 受影响的宿主回归（#21）

| 命令 | 结果 | 备注 |
|---|---|---|
| `node scripts/plugin-check.mjs` | PASS | 插件入口启动共享后台、页面 API、退出清理 |
| `node scripts/dsh-lifecycle-check.mjs` | PASS | 完整/缺用量/错误/截断/取消/复测/隔离/重跑/重启 |
| `node scripts/dsh-recovery-check.mjs` | PASS | 并发单后台/单调度、失败重试、桌面退出取消与清理、CLI 只连接 |
| `node scripts/dsh-profile-check.mjs` | PASS（浏览器 UI） | 首次被 DSH 弹层拦截；改用共享入口后通过 |
| `node scripts/dsh-auto-check.mjs` | PASS（浏览器 UI） | 弹层标签修复前后各通过一次 |
| `node scripts/dsh-settings-check.mjs` | PASS，5/5 | 最终 harness 上重跑 |
| `node scripts/native-attribution-check.mjs` | PASS | 合入 #20 后、修复 `Continue` 后运行，未修改该文件 |

环境说明：长时间持续遮挡的悲观探针在默认 `msedge` 下约 30–32 秒出现 `Target page, context or browser has been closed`，调用日志仍含遮罩拦截；改用本机 Playwright bundled `chrome-headless-shell` 后稳定完成约 66 秒的完整重试。该现象记录为浏览器/环境限制，不是代码回归，也不表述为 `TimeoutError`（此句仅指持续遮挡探针；第 4.5 节故障注入在最终 headless shell 下确为 60 秒报告等待超时）。`plugin-check`、`lifecycle`、`recovery` 在最终弹层标签调整前运行；该调整只影响浏览器入口，不涉及这些脚本的代码路径。

### 4.5 追加故障验证（#20）

在独立命令和受控 HTTP 边界上分别制造两种故障；仅通过本回归进程的临时 `--import` 钩子替换请求/响应，不使用 `NODE_OPTIONS`，不改 Go 题目、产品代码或共享 harness。

| 故障 | 实际结果 |
|---|---|
| response：把可归因模型的成功回答替换为非数字文本 | 命令 `EXIT=1`；真实 DOM 显示「本轮无法归因：没有可用回答：请粘贴完整数字序列；拒答或严重截断的回答不会计入。」；本次 home/work 无剩余，整个 TMPDIR 无存活进程。证据根目录 `/tmp/issue19-response-NR9fiH`，日志 `command.log` |
| prompt：把真实挑战请求中的数量改为「若干」 | 输出明确「受控模型收到非指纹挑战题目，无法生成预期回答」诊断并返回 HTTP 500；命令 `EXIT=1`；本次目录与进程为空。证据根目录 `/tmp/issue19-prompt-jvDQ82`，日志 `command.log` |

两命令最终都停在成功报告等待阶段，最后错误均为 `locator.waitFor: Timeout 60000ms exceeded`（`name: TimeoutError`），等待 `locator('.dic-trace-report')` 可见。结构化结果同时包含 response 与 prompt 两项，见 `/tmp/issue19-fault-results.json`。

驱动记录与边界：

- 最终 headless-shell 驱动 `node /tmp/issue19-fault-validation.mjs` 依次运行两故障，驱动 exit 0；使用 `PLAYWRIGHT_MODULE=/tmp/dsh-issue12-pw/node_modules/playwright-core` 与 `PLAYWRIGHT_EXECUTABLE=/Users/jxq/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell`。
- 最初两轮驱动对错误类型和页面文案作了过窄假设（限定 `TimeoutError`，并对 prompt 故障复用 response 的 DOM 归因失败文案），因此驱动整体失败。这些驱动失败不记为产品回归通过，也不改写为测试通过。
- 早期在默认 Edge 下，两故障曾因浏览器约 30–32 秒被外部关闭而以 `Target page, context or browser has been closed` 结束；这是环境限制，不能作为 `TimeoutError` 结论。改用稳定 headless shell 后已完整走到预期报告超时；两种环境的结束错误分别记录，不混写。
- 主代理的最终补验已完成，不再有待补充的故障结果。

## 5. 对 #13 验收记录的更正

`docs/acceptance-issue-13.md` 只更正二进制选择链表述，不改变历史命令、结果或产物哈希：

- 第 5 节不再笼统声称所有宿主回归都使用包内后台。设置、归因、profile、生命周期和自动检测在 `DSH_INTELLIGENCE_CHECK_TEST_BINARY` 未设置时使用包内后台；恢复回归先由 `backendBinary()` 选择仓库后台（存在 `bin/quality-check` 时使用该文件，否则使用平台命名文件），复制到独立临时目录，设置 `DSH_INTELLIGENCE_CHECK_TEST_BINARY`，再由 `pluginConfigOverride()` 把安装插件的 `binaryPath` 指向副本。
- 第 7 节将「最终 tarball 的 6 项宿主回归」明确为：插件包来自最终 tarball，其中恢复回归的 Go 后台是仓库副本，其余 5 项使用包内后台。
- 第 10 节保留原复现命令，并补充说明 `unset DSH_INTELLIGENCE_CHECK_TEST_BINARY` 只作用于脚本入口；恢复脚本会在内部重新设置覆盖。
- 已核实仓库副本与包内后台 SHA-256 均为 `9b86c7d705b32e60356e7a7c8f72b487145d95b9c8c4e470cfe4bf6835159cc9`，一致性事实保留；这不改变实际选择链的区别。原始 darwin-arm64 tarball SHA-256 仍为 `9143b7560e5973e80d1e82c76beacc8ad14a6ba23f5d14b84bb5f529dc614d7d`。

## 6. 沿用证据与未重跑项

**本轮实际运行**

- #20/#21 实施记录中的归因清理、受控回答、宿主回归与浏览器诊断验证（第 4.3–4.5 节）。
- 主代理对 7 个 `.mjs` 的逐个 `node --check`，以及 `node --test plugin/*.test.mjs scripts/ui.test.mjs` 的 25 项通过。
- 主代理 headless-shell 最终故障补验 `bm5aijjyj`：驱动 exit 0，response/prompt 两命令均 exit 1，本次目录与进程清理符合预期。
- 两轴审查修复后的追加验证（第 11 节）：`plugin-check`、profile/auto 的可选 Playwright 加载、归因硬性失败、设置回归的短暂/持续入口遮挡与早期 console 日志、profile 浏览器 UI。

**沿用 #13 历史证据，未在本轮重跑**

- `docs/acceptance-issue-13.md` 的最终产物哈希、五平台构建、`package-check`、`install-check`、`go vet`、`go test -race` 和真实 Desktop 窗口操作。
- #13 的 6 项宿主回归结果仍作为历史结果保留；本轮只在测试脚本变化后重跑了 #20/#21 明确涉及的脚本，不据此宣称重跑过全部历史命令。
- Cloudflare Quick Tunnel、旧网页控制台兼容接口和真实桌面自动检测调度等 #13 未验证项仍未重跑。

**未做的验证**

- 未运行 `go test`、`package-check`、`install-check`，未重新构建客户端或发行包，未运行真实桌面窗口。
- 未强制触发清理失败的 `AggregateError` 分支；从外部制造 `rm`/close 失败需要内部测试钩子（超出范围）或竞态文件系统操作。
- prompt 格式故障通过临时进程级钩子验证，未修改真实 Go 题目格式；未新增持久回归测试文件。

## 7. 包与发行影响

- `git diff --name-only 64d9832 b6a6a30` 仅含 7 个 `scripts/*.mjs`；这些文件不在 `package.json` 的 `files` 列表中，也不进入安装包。
- 包内跟踪文件聚合哈希仍为 `10cd15331bd3dad39a5de0e228d0abc1385e23852a61488ca1a1d3a9544c9fb0`（基线 `64d9832` 的同一算法结果），本轮无需重建发行包或更新产物哈希。
- 本轮文档修改同样不进入安装包。

## 8. 未验证项与限制

- 最终 headless-shell 故障补验已完成（第 4.5 节）；初期 Edge 下约 30–32 秒的浏览器外部关闭是环境限制，最终稳定浏览器完整走到 60 秒报告等待超时。
- 入口持续遮挡与短暂遮挡已在完整 `dsh-settings-check.mjs` 命令入口经真实 DSH 页面复验（第 11 节）。此前只调用 `openNativePage` 并配本地 mock 页的探针边界不足，不再作为规格证据；20×3s 重试预算未缩短或绕过，默认 Edge 下的外部关闭仍是环境限制。
- 真实 DSH 浏览器回归使用 `msedge` / bundled headless shell，未使用真实桌面窗口；#13 的真实 Desktop 证据不被本轮重述或替代。
- 归因清理的原始错误路径已由无效 Playwright、无效 DSH 二进制和追加故障触发；清理失败聚合分支未从外部强制触发。
- 两种故障在最终 headless-shell 下均以成功报告等待的 `locator.waitFor: Timeout 60000ms exceeded`（TimeoutError）结束；此前 Edge 的 `Target page, context or browser has been closed` 是环境限制，两者分别记录。

## 9. 数据隔离与清理

- 全部模型请求指向本机回环受控服务；未使用真实凭据、用户旧数据或付费模型。
- 归因回归只清理本次创建的 home/work、浏览器、宿主和受控服务，不扫描或批量删除历史临时目录。
- 改前泄漏的两个已知目录（`/tmp/issue20-red/dsh-ic-attribution-home-dWjAZ3`、`/tmp/issue20-red/dsh-ic-attribution-work-TXC6cl`）在改后成功运行期间未被误删，证明清理只作用于本次创建资源；最终收尾时主代理确认无匹配存活进程后，只按这两个确切路径删除本次 red 对照资源，不是扫描或批量清理历史目录。
- 临时探针、故障注入钩子和证据目录位于 `/tmp`，不进入仓库。

## 10. 复现命令

静态语法（逐个检查，避免多参数 `node --check` 只检查首个文件）：

```sh
node --check scripts/dsh-auto-check.mjs
node --check scripts/dsh-harness.mjs
node --check scripts/dsh-lifecycle-check.mjs
node --check scripts/dsh-profile-check.mjs
node --check scripts/dsh-recovery-check.mjs
node --check scripts/native-attribution-check.mjs
node --check scripts/plugin-check.mjs
```

核对变更范围与包内聚合哈希：

```sh
git diff --name-only 64d9832 b6a6a30
git ls-files plugin assets bin third_party README.md LICENSE cordis.patch.yml package.json | git hash-object --stdin-paths | shasum -a 256
```

本轮涉及的现有回归与测试：

```sh
node --test plugin/*.test.mjs scripts/ui.test.mjs
node scripts/native-attribution-check.mjs
node scripts/plugin-check.mjs
node scripts/dsh-recovery-check.mjs
node scripts/dsh-profile-check.mjs
node scripts/dsh-lifecycle-check.mjs
node scripts/dsh-auto-check.mjs
node scripts/dsh-settings-check.mjs
```

归因清理的失败路径可用无效模块或无效二进制从命令入口触发，例如：

```sh
TMPDIR=$(mktemp -d) PLAYWRIGHT_MODULE=/nonexistent/playwright node scripts/native-attribution-check.mjs
TMPDIR=$(mktemp -d) DSH_BINARY=/nonexistent/dsh node scripts/native-attribution-check.mjs
```

两种追加故障依赖 `/tmp` 下的临时 `--import` 注入钩子，不属于仓库公共 API。最终补验命令为：

```sh
PLAYWRIGHT_MODULE=/tmp/dsh-issue12-pw/node_modules/playwright-core \
PLAYWRIGHT_EXECUTABLE=/Users/jxq/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell \
node /tmp/issue19-fault-validation.mjs
```

驱动 exit 0 表示两个故障命令都按预期以非零退出并完成清理；各命令的实际结果和证据目录见第 4.5 节。

两轴审查修复后的入口遮挡复验命令（`--import` 钩子仅位于 `/tmp`，不进入仓库，也不设置 `NODE_OPTIONS`）：

```sh
# 短暂遮挡：完整设置回归应成功，并输出早期 console 探针
TMPDIR=$(mktemp -d) ISSUE19_OVERLAY=transient ISSUE19_CONSOLE_PROBE=1 \
PLAYWRIGHT_MODULE=/tmp/dsh-issue12-pw/node_modules/playwright-core \
PLAYWRIGHT_EXECUTABLE=/Users/jxq/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell \
node --import /tmp/issue19-overlay-hook.mjs scripts/dsh-settings-check.mjs

# 持续遮挡：命令应以非零退出，最后错误包含真实 pointer interception
TMPDIR=$(mktemp -d) ISSUE19_OVERLAY=persistent \
PLAYWRIGHT_MODULE=/tmp/dsh-issue12-pw/node_modules/playwright-core \
PLAYWRIGHT_EXECUTABLE=/Users/jxq/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell \
node --import /tmp/issue19-overlay-hook.mjs scripts/dsh-settings-check.mjs
```

可选 Playwright 加载语义的命令入口复验：

```sh
TMPDIR=$(mktemp -d) PLAYWRIGHT_MODULE=/nonexistent/playwright node scripts/dsh-profile-check.mjs
TMPDIR=$(mktemp -d) PLAYWRIGHT_MODULE=/tmp/dic-invalid-pw node scripts/dsh-auto-check.mjs
TMPDIR=$(mktemp -d) PLAYWRIGHT_MODULE=/nonexistent/playwright node scripts/native-attribution-check.mjs
```

## 11. 两轴审查修复与追加验证（2026-11-06）

两轴审查报告为 `/tmp/issue-19-review-standards.md` 与 `/tmp/issue-19-review-spec.md`。本轮只修改 `scripts/*.mjs` 与本文档，不修改产品代码、Go 后台、包内文件或 #13 历史证据哈希。

### 11.1 必修项

| 项 | 处理 |
|---|---|
| 新增注释中文 | `dsh-harness.mjs` 的进程观测注释改为中文并纠正“调用方保留目录过滤”的表述；`native-attribution-check.mjs` 的清理注释改为中文。本轮新增注释均为简体中文。 |
| profile/auto 的 Playwright 提示与可选语义 | 新增共享 `loadPlaywright({optional})`：缺少模块、路径无效或 `require` 失败时都给出含 `PLAYWRIGHT_MODULE` 的提示。profile/auto 以 `optional: true` 调用，继续跳过浏览器 UI，不改为硬性失败，也不下载依赖；共享 `launchChromium` 仍硬性失败。该边界由 3 个实际调用点复用，未引入新框架。 |
| console error 监听前移 | `openNativePage` 在 `goto` 前与 `pageerror` 一并注册 console error 监听；删除 `dsh-profile-check.mjs` 在 `goto`/入口点击/tab 切换之后的重复注册，未新增单次 callback 选项。 |
| 完整命令入口的入口遮挡验证 | 使用临时 `--import` 钩子在本回归进程内包装 Playwright 公开 API：在 `page.goto` 返回前先真实点击已有 `Continue` 欢迎层，再插入真实 DOM 遮罩。短暂遮罩 1.2s 后移除，持续遮罩不移除；`openNativePage` 的 20 次重试预算保持不变。 |
| 局部建议 | `native-attribution-check.mjs` 调整 `node:fs/promises` 与 `node:http` 的 import 顺序；`plugin-check.mjs` 删除 `waitForProcessCount(..., 0)` 成功后重复的 `backendProcesses` 查询与断言及不再使用的 import；本文档把 `b6a6a30` 标为代码集成 tip，并注明其后 `732c827` 仅文档变更。 |

### 11.2 本轮实际运行

| 命令/场景 | 实际结果 |
|---|---|
| 5 个修改脚本逐个 `node --check` | 全部通过 |
| `node scripts/plugin-check.mjs` | `EXIT=0`，PASS；删除重复断言后仍精确等待后台进程数为 0 |
| `PLAYWRIGHT_MODULE=/nonexistent/playwright node scripts/dsh-profile-check.mjs` | `EXIT=0`；输出含 `PLAYWRIGHT_MODULE` 提示与“已跳过浏览器 UI 验证”；PASS 标注“未执行浏览器 UI”；本次 TMPDIR 无残留目录与进程 |
| `PLAYWRIGHT_MODULE=/tmp/dic-invalid-pw node scripts/dsh-auto-check.mjs`（目录存在但无模块） | `EXIT=0`；输出含 `PLAYWRIGHT_MODULE` 提示和“加载失败：Cannot find module”；PASS 标注“未执行浏览器 UI 操作”；无残留目录与进程 |
| `PLAYWRIGHT_MODULE=/nonexistent/playwright node scripts/native-attribution-check.mjs` | `EXIT=1`；Error 消息包含 `PLAYWRIGHT_MODULE`；本次 home/work 已删除，无存活进程 |
| 短暂遮挡 + 早期 console 探针，完整 `node --import … scripts/dsh-settings-check.mjs` | `EXIT=0`；5 pass / 0 fail；4 次输出 `[ui] console: [issue19-console-probe] 早期加载控制台错误`，证明监听在 `goto` 前生效；无残留目录与进程 |
| 持续遮挡，同一完整设置回归命令 | `EXIT=1`；最终错误为入口点击的 `TimeoutError`，日志包含 `<div id="issue19-overlay"></div> intercepts pointer events`（共 16 处），即最后一次真实 pointer interception；4 个子测试各自耗尽 20 次重试，总耗时约 283s；无残留目录与进程 |
| 有效浏览器下 `node scripts/dsh-profile-check.mjs` | `EXIT=0`，PASS 标注“浏览器 UI 已验证”；无残留目录与进程 |

环境：Node `v26.13.0`、DSH `0.2.2-rc.1`、macOS arm64；`PLAYWRIGHT_MODULE=/tmp/dsh-issue12-pw/node_modules/playwright-core`（1.65.0）与 headless shell `chromium_headless_shell-1243`，避免默认 Edge 约 30s 外部关闭。钩子文件 `/tmp/issue19-overlay-hook.mjs` 与各命令日志均留在 `/tmp`，不进入仓库。

### 11.3 限制

- 入口遮挡复验使用 Playwright `--import` 钩子注入真实 DOM，未修改共享 harness 或产品页面。
- 持续遮挡下命令耗时约 283s，因为设置回归的 4 个子测试各触发一次 20 次入口点击重试；未缩短重试预算。
- 未重跑 Go 测试、桌面窗口、发行包、`package-check`、`install-check`，也未重跑已通过的插件/UI 25 项；这些不在本轮脚本与文档改动范围内。
