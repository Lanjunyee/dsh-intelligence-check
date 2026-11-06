# Issue #13 最终修复包与真实桌面验收

验收日期：2026-11-06。范围：确认 Issue #13 的四项前置修复与审查修复均在同一集成分支，从最终源码构建客户端 bundle、五平台后台与安装包，完成包布局/安装验证，并用最终 tarball 在真实打包 DeepSeek Harness Desktop 的隔离环境中实际操作窗口。本文分别记录源码与产物、宿主层回归、真实 Desktop 窗口结果、历史证据对应关系、未验证项和清理情况；不以 Web 宿主或伪桌面标记代替真实桌面结果。

## 1. 结论

- 四项前置修复（#14 设置保存失败与轮询焦点、#15 归因失败可见、#16 共享后台并发恢复与退出清理、#17 用户级共享数据目录）已合入 `integration/issue-13-native-fixes`，审查修复提交 `dafcf38` 也已合入；最终验收分支为该集成 tip 的合并结果。
- 最终源码构建出 `plugin/client.js`、五平台后台和五平台 tarball；布局、安装、checksum、无 Go 源码、可执行位检查通过；连续两次构建产物哈希一致。
- 最终 tarball 已安装进隔离 `DSH_HOME` 的真实 `/Applications/DeepSeek Harness.app`，通过真实窗口操作验证：基本页面；保存失败时弹窗保留、草稿与“有未保存的修改”保留、失败可见、无成功提示；恢复后重试保存成功且配置生效；3 秒后台轮询不抢输入焦点；模型归因失败在指纹页可见且不显示成功报告；正常归因报告不回退；退出应用后无本次隔离环境残留进程。
- 宿主层的并发恢复、CLI/Web 权限与共享存储回归与真实窗口结果分开记录（第 4、5 节）。
- 历史 `docs/acceptance-issue-12.md` 只更正日志引用与版本范围表述，未改写历史事实（第 6 节）。

## 2. 源码、宿主与版本

| 项 | 值 |
|---|---|
| 父规格 / 收尾任务 | Issue #13 / Issue #18 |
| 修复前基线 | `939f1e9843b08cc62a93ca7362975fc338c3c528` |
| 集成分支 tip | `integration/issue-13-native-fixes` = `dafcf38cd289285ff7f9e9045299c4915ad5519b`（含 `3e00ba2` 四项修复与审查修复） |
| 验收分支 / worktree | `implement/issue-18` / `/Users/jxq/agent_work/dsh-intelligence-check/.claude/worktrees/agent-add953f41f43fb73a` |
| 文档更正提交 | `bdac1c3`（README 状态与历史日志/版本范围表述；本验收文档随后单独提交） |
| 插件版本 | `0.3.0` |
| DSH CLI | `/usr/local/bin/dsh` → `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`；`dsh --version` = `0.2.2-rc.1` |
| 真实应用 | `/Applications/DeepSeek Harness.app`，`0.2.2-rc.1`，打包态 |
| 平台 | macOS 27.2（Darwin 27.2.0），arm64 |
| 工具链 | Go `1.27.3 darwin/arm64`；Node `v26.13.0`；Playwright `playwright-core@1.65.0`（`/tmp/dsh-issue12-pw`） |
| 版本范围 | `package.json` 的 `engines.dsh` 为 `>=0.2.0 <0.3.0`（兼容声明）；本轮只在 DSH `0.2.2-rc.1` 实际验收，未逐版本验证该范围 |
| 模型 | 仅回环 `http://127.0.0.1:18766/v1` 的受控 OpenAI 兼容服务；未使用真实凭据或付费模型 |

## 3. 最终产物与可重现性

从文档更正提交 `bdac1c3` 的源码树执行 `node scripts/build-client.mjs` 与 `node scripts/build-release.mjs`。`plugin/client.js` 两次重建哈希一致；`build-release.mjs` 连续两次执行后 `dist/SHA256SUMS` 完全一致。包内 `README.md` 的 SHA-256 与仓库根 `README.md` 一致（`566a7d63…da14`），确认 README 更正进入最终包。

| 产物 | 大小 | SHA-256 |
|---|---|---|
| `plugin/client.js` | 77,897 B | `9c343cf56a53e511fd59dcf1b48f81ab1f031a60c81015e43f896252990c2522` |
| `dist/dsh-intelligence-check-darwin-arm64.tgz` | 6,915,402 B | `9143b7560e5973e80d1e82c76beacc8ad14a6ba23f5d14b84bb5f529dc614d7d` |
| `dist/dsh-intelligence-check-darwin-amd64.tgz` | — | `08b83acfd2ebbddd320002bb2c326af2128cf8daf0921a48621826a40c2fb167` |
| `dist/dsh-intelligence-check-linux-amd64.tgz` | — | `7d980d312045ea7905854592ef821a39c50652e9ae6b6597bca63c4abf2cd67f` |
| `dist/dsh-intelligence-check-linux-arm64.tgz` | — | `e3593b24fabfbff9699446ed78b860f0d6d7aad954b682b2d5420e4d50164116` |
| `dist/dsh-intelligence-check-windows-amd64.tgz` | — | `2301b110abe6f5d54d375bbaa3b53376d7d35b6fb31bcc35f198fcad90c4d30d` |
| `dist/quality-check-darwin-arm64` = `bin/quality-check` | 12.3 MB | `9b86c7d705b32e60356e7a7c8f72b487145d95b9c8c4e470cfe4bf6835159cc9` |
| `dist/quality-check-darwin-amd64` | 12.9 MB | `7a64b5c8218d779aa6f3bea497250ad46ffd24910ebb1e1c8ad5715ed7874ab6` |
| `dist/quality-check-linux-amd64` | 12.8 MB | `9ce41922353d3cc793e60d5262c34498f948aaad9ef2009705d5618ce3ff8e5c` |
| `dist/quality-check-linux-arm64` | 12.3 MB | `9c39eea03874279acf4f3899f195a3bb96b38bf4fc9bad339ed5d38e3fde49c7` |
| `dist/quality-check-windows-amd64.exe` | 12.9 MB | `8441c60e54fe428d2e54bb7f1a515b4249c284f68856ed12d18c53ddbc677a1e` |
| `dist/SHA256SUMS` | 997 B | `92369011a3b9affb7f48853e70a9f7a47930bd94ff3482adb2b62f8c5c77d614` |
| `dist/manifest.json` | 2,236 B | `dd273b7bedc408d3a9a49c8d84b300e2a1da041236ed5551d030b53753243741` |

`dist/SHA256SUMS` 同时覆盖五个平台后台与五个 tarball 共 10 项；`bin/quality-check-*` 与对应 `dist/quality-check-*` 哈希一致。只有 darwin-arm64 tarball 被安装并真实运行；其余四个平台仅交叉编译与静态包检查（第 7 节）。

## 4. 包布局与安装验证

| 检查 | 结果 |
|---|---|
| `node scripts/package-check.mjs` | PASS：包标识、`dsh.bundle`/`dsh.client` 声明、`./client` 导出、图标、五平台布局、可执行位、checksum、每包仅含本平台后台、无 Go 源码 |
| `node scripts/install-check.mjs` | PASS：当前平台 tarball 解压后插件可加载、后台可启动并提供页面 API、退出清理 |
| 最终 tarball 解包 `package/plugin/client.js` | 哈希 `9c343cf5…c2522`，与源码构建一致 |
| 最终 tarball 解包 `package/README.md` | 哈希 `566a7d63…da14`，与仓库 README 一致 |
| 最终 tarball 安装到隔离 desktop profile | `dsh plugin --profile desktop add <tarball>` 成功；安装后 `plugin/client.js` 与 `bin/quality-check` 哈希与上表一致 |
| `go vet ./...` | PASS |
| `go test -race ./...` | PASS，82 项，2 个包 |
| `node --test plugin/*.test.mjs scripts/ui.test.mjs` | PASS，25 项 |

安装前置：CLI 的 `dsh plugin --profile desktop` 在 profile 尚未初始化时会拒绝；本轮先在隔离 `DSH_HOME` 按 Desktop `initProfile` 同一布局创建 `profiles/desktop`（`package.json` 的 `dsh.profile.bundles`、`pnpm-workspace.yaml`、`cordis.yml`、受控 provider 的 `cordis.patch.yml`），再执行安装。README 已说明应先启动一次桌面应用并退出以初始化固定 profile。

## 5. 宿主层回归（与真实窗口结果分开）

以下检查均以最终 tarball（`dist/dsh-intelligence-check-darwin-arm64.tgz`，哈希 `9143b756…4d7d`）安装插件包，使用隔离 `DSH_HOME`、真实 Go 后台和本地受控模型。设置、归因、profile、生命周期和自动检测脚本在 `DSH_INTELLIGENCE_CHECK_TEST_BINARY` 未设置时使用包内后台。恢复回归不同：脚本启动时调用 `backendBinary()` 选择仓库后台（存在 `bin/quality-check` 时使用该文件，否则使用 `bin/quality-check-<goos>-<goarch>`），复制到独立临时目录，设置 `DSH_INTELLIGENCE_CHECK_TEST_BINARY` 指向副本，再由 `pluginConfigOverride()` 把安装插件的 `binaryPath` 指向该副本。因此恢复回归实际运行的是仓库后台副本，不是包内后台；下表的恢复结果为该副本上的结果。历史产物记录已核实该副本与包内后台 SHA-256 均为 `9b86c7d705b32e60356e7a7c8f72b487145d95b9c8c4e470cfe4bf6835159cc9`；两者一致不改变上述选择链的区别。

| 命令 | 覆盖 | 结果 |
|---|---|---|
| `DSH_PLUGIN_PACKAGE=<final> node scripts/dsh-settings-check.mjs` | 原生页面真实 DOM：保存失败保留草稿/修改标记/失败反馈、忙碌未执行不报成功、轮询不抢焦点且不改写草稿、失败后重试生效、首次聚焦/Escape/关闭按钮 | PASS，5 项 |
| `DSH_PLUGIN_PACKAGE=<final> node scripts/native-attribution-check.mjs` | 归因失败在指纹页可见、失败不显示成功报告、正常报告与空状态不回退 | PASS |
| `DSH_PLUGIN_PACKAGE=<final> node scripts/dsh-recovery-check.mjs` | 并发恢复单后台/单调度、失败后可重试、桌面退出取消活动检测并清理、CLI/Web 只连接不启动不接管不推送模型目录 | PASS |
| `DSH_PLUGIN_PACKAGE=<final> node scripts/dsh-profile-check.mjs` | 原生侧边栏与页面、共享单后台、桌面配置权威、跨 profile、CLI 仅连接、HTML/SVG 预览、人工评审、ModelTrace、退出/接管、HMR | PASS（第一次运行被 DSH 弹层遮罩拦截侧栏点击，重跑 PASS；产品路径未改动） |
| `DSH_PLUGIN_PACKAGE=<final> node scripts/dsh-lifecycle-check.mjs` | 完整/缺用量/宿主错误/截断/取消/独立复测/同名目标隔离/取消后重跑/重启持久化 | PASS |
| `DSH_PLUGIN_PACKAGE=<final> node scripts/dsh-auto-check.mjs` | 自动检测默认关闭、仅监测目标、无业务对话触发、关闭/移除停止、并发合并、预算与清理、重启配置、退出取消与清理 | PASS（浏览器 UI 操作） |

并发恢复、CLI/Web 权限与共享存储的结论来自上述宿主回归，不来自桌面窗口观察；桌面窗口只单独证明第 6 节列出的用户可见行为。

## 6. 真实 Desktop 窗口验收

### 6.1 隔离环境与安装

| 项 | 值 |
|---|---|
| 应用 | `/Applications/DeepSeek Harness.app`（打包态 `0.2.2-rc.1`） |
| 隔离变量 | `DSH_HOME=/tmp/dsh-issue13-desktop/home`、`DSH_AGENTS_HOME=/tmp/dsh-issue13-desktop/agents`、`--user-data-dir=/tmp/dsh-issue13-desktop/userdata` |
| 安装 | `DSH_HOME=… DSH_AGENTS_HOME=… dsh plugin --profile desktop add /…/dist/dsh-intelligence-check-darwin-arm64.tgz`（最终 tarball）；安装后客户端与后台哈希与第 3 节一致 |
| 驱动 | Playwright Electron `_electron.launch` 启动真实打包应用；操作驱动保留在 `/tmp/dsh-issue13-desktop/drive-desktop.mjs`，受控模型服务为 `/tmp/dsh-issue13-desktop/mock-server.mjs` |
| 模型 | `fixture-one / attributable-model` 返回可用指纹序列；`fixture-one / rejected-model` 对指纹题返回拒答文本；milk 返回 `46.24 inches`；全部为本机回环受控服务 |
| 数据隔离 | 未读取、迁移、覆盖或删除 `/Users/jxq/.dsh` 下的真实配置、凭据或旧数据库 |

### 6.2 操作与结果

| 步骤 | 结果 |
|---|---|
| 启动真实应用 | 主窗口 URL `dsh-app://app/`；侧栏出现“模型质量检测” |
| 点击真实侧栏入口 | 主区域 `.dic-page` 打开，标题“模型质量检测”，连接状态“已连接”；四个标签为“模型监测 / 质量题库 / 模型指纹 / 检测记录” |
| 打开“检测预算设置” | 弹窗打开，首次焦点落在弹窗内首个输入（复选框） |
| 输入自动检测开启、间隔 123、每日上限 77；聚焦间隔输入并等待 3.2 秒 | 焦点仍在被编辑的输入框；草稿保持 `auto=true / 123 / 77`，后台轮询未改写或抢焦点 |
| 注入真实保存失败：临时移除隔离 profile 内的 `bin/quality-check` 并终止本次隔离后台（PID 74850，仅匹配本隔离数据目录），点击“保存设置” | 弹窗保持打开；草稿 `auto=true / 123 / 77` 与“有未保存的修改”保留；弹窗内可见 `质量检测后台不可用：请通过 DSH 桌面应用打开`；无“检测设置已保存”成功反馈 |
| 恢复包内后台二进制，再次点击“保存设置” | 宿主重新连接后台；弹窗关闭，显示“检测设置已保存”；概览显示“每 123 秒”，配置实际生效 |
| 通过原生 UI 添加 `fixture-one / rejected-model` 与 `fixture-one / attributable-model` 两个检测目标 | 目标表出现两行；初始化时自动监测保持关闭 |
| 模型指纹页选择 rejected-model，点击“运行三条指纹挑战” | 批次 3/3 已结束；页面显示 `本轮无法归因：没有可用回答：请粘贴完整数字序列；拒答或严重截断的回答不会计入。`；`可归因报告` 数量为 0，未被“暂无指纹检测记录”空状态掩盖 |
| 选择 attributable-model 再运行 | 正常显示“最相似候选 / 最相似家族”报告（受控回答下 `claude-opus-5-5 61.0%`），成功路径未回退 |
| 退出测试桌面应用 | `app.close()` 后 5 秒检查，匹配本隔离目录的后台/Host 进程为空 |
| 受控模型请求 | 6 次 `POST /v1/chat/completions`（两次三条指纹挑战），无其他外部模型调用 |

保存失败的注入方式说明：真实 Desktop 页面运行在自定义 `dsh-app://` scheme 上，实测 CDP `Fetch`/Playwright `page.route` 与 `context.route` 都不会暂停该 scheme 的请求，因此不能像 Web 宿主回归那样用路由拦截伪造 500。本轮改用产品既有故障路径：移除隔离包内后台并终止本次隔离后台，使宿主真实返回不可用；恢复二进制后重试由宿主自动重连。该方式与 `dsh-recovery-check.mjs` 的故障注入一致，不修改产品实现，也不接触其他用户或代理的进程。失败提示是现有通用不可用文案（“请通过 DSH 桌面应用打开”），在桌面上下文中语义偏通用，但本轮验收范围是“失败可见、草稿保留、重试成功”，未改动该文案。

### 6.3 证据文件

截图均已实际读取核对，非空白帧：

| 文件 | 内容 |
|---|---|
| `/tmp/dsh-issue13-desktop/shots/01-initial.png` | 真实应用初始工作区与侧栏入口 |
| `/tmp/dsh-issue13-desktop/shots/02-native-page.png` | 原生页面标题、四标签、连接状态、模型目录 |
| `/tmp/dsh-issue13-desktop/shots/03-save-failure.png` | 保存失败：弹窗保持、草稿 123/77、修改标记、弹窗内错误 |
| `/tmp/dsh-issue13-desktop/shots/04-save-success.png` | 重试成功：成功反馈、概览“每 123 秒” |
| `/tmp/dsh-issue13-desktop/shots/05-attribution-error.png` | 归因失败可见、无成功报告、批次已完成 |
| `/tmp/dsh-issue13-desktop/shots/06-attribution-success.png` | 正常归因报告 |
| `/tmp/dsh-issue13-desktop/shots/07-models.png` | 两个检测目标与预算 |
| `/tmp/dsh-issue13-desktop/shots/08-tests.png` | 质量题库页 |
| `/tmp/dsh-issue13-desktop/shots/09-history.png` | 检测记录页（6 条 ModelTrace 记录） |

结构化步骤与退出进程证据：`/tmp/dsh-issue13-desktop/desktop-evidence.json`、`/tmp/dsh-issue13-desktop/after-close-ps.txt`（空）、`/tmp/dsh-issue13-desktop/mock-requests.log`。

## 7. 实际运行、沿用证据与未验证项

**本轮实际运行**

- 最终源码构建、两次可重现校验、`go vet`、`go test -race`、25 项插件/UI 测试、`package-check`、`install-check`。
- 以最终 tarball 安装插件的 6 项宿主回归（设置、归因、恢复、profile、生命周期、自动检测）；其中恢复回归的 Go 后台是仓库 `backendBinary()` 选择的副本（通过覆盖配置使用），其余 5 项使用包内后台。
- 最终 tarball 在真实打包 Desktop 的完整窗口操作（第 6 节）。

**沿用证据（未在本轮重跑）**

- Issue #12 的真实 Desktop 完整 GUI 报告 `/tmp/dsh-issue-12-desktop-validation.md` 针对修复前 `b2d5259` 产物，覆盖侧栏、四标签、受控检测、历史与退出清理；本轮不将其冒充 Issue #13 最终包结果。
- Cloudflare Quick Tunnel 与 Go 内嵌旧网页控制台兼容接口未重跑；它们不是原生页面路径的交付依赖。

**未验证项与限制**

- 只有 darwin-arm64 在真实应用运行；darwin-amd64、linux-amd64、linux-arm64、windows-amd64 只做交叉编译、包布局、可执行位与 checksum 检查，未在对应系统启动 DSH。
- 真实窗口由 Playwright Electron 自动驱动，不是人工鼠标操作；关键截图已人工读取。
- 桌面保存失败使用隔离后台移除/终止注入，而非磁盘满、SQLite 写失败或真实 HTTP 500；“忙碌未执行不报成功”只在宿主浏览器回归中覆盖，未在真实窗口重复。
- 桌面窗口未重跑自动检测定时调度、双 profile 共享后台、CLI/Web 并发恢复与权限；这些由第 5 节宿主回归覆盖，不能由窗口结果替代。
- 生产 15 分钟默认间隔未实际等待；短间隔与默认值语义由既有自动检测回归覆盖。
- 首次 `dsh-profile-check` 运行因 DSH 弹层遮罩拦截侧栏点击失败，重跑通过；未修改产品代码。
- 未推送、未发布、未关闭任何 Issue（包括已拒绝自动关闭的 #15）。

## 8. 历史文档更正

`docs/acceptance-issue-12.md` 保留原有验收事实与提交/产物哈希，只做两处表述更正：

1. 第 3 节 CLI 启动日志由误引的 `CLI host detected; the shared desktop backend is not started` 更正为实际字符串 `CLI host detected; the shared desktop backend is not running`，并说明它只描述启动时未找到可连接桌面后台；补修 `1b0a928` 后后续请求会再次只连接。
2. 第 1 节新增“版本范围说明”：验收只针对 DSH `0.2.2-rc.1`（macOS arm64），`engines.dsh >=0.2.0 <0.3.0` 是兼容声明，不是已逐版本验收的范围。

README 同步更新当前状态、Issue #13 验收记录链接、版本范围说明和真实 Desktop 证据边界；包内 README 与仓库一致（第 3 节）。历史 Issue #11/#12 的验收结论、提交与哈希未改写。

## 9. 清理与数据隔离

- 受控模型服务已停止；真实桌面应用已退出；退出后无匹配本次隔离目录的后台/Host 进程。
- 隔离 `DSH_HOME`、`DSH_AGENTS_HOME`、`--user-data-dir` 与工作目录已删除；仅保留 `/tmp/dsh-issue13-desktop` 下的截图、结构化证据、驱动与受控服务脚本（临时证据，可能被系统清理）。
- 未读取、迁移、覆盖或删除用户真实 `~/.dsh` 配置、凭据、profile 或旧数据库；未使用真实凭据或付费模型。
- 其他代理遗留的 Host/后台进程不属于本次验收环境，未计入桌面退出清理结论。

## 10. 复现命令

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
node scripts/dsh-settings-check.mjs
node scripts/native-attribution-check.mjs
node scripts/dsh-recovery-check.mjs
node scripts/dsh-profile-check.mjs
node scripts/dsh-lifecycle-check.mjs
node scripts/dsh-auto-check.mjs
```

`unset DSH_INTELLIGENCE_CHECK_TEST_BINARY` 只作用于脚本入口，不表示恢复回归使用包内后台。`dsh-recovery-check.mjs` 会先调用 `backendBinary()` 选择仓库后台，复制到独立临时目录并重新设置 `DSH_INTELLIGENCE_CHECK_TEST_BINARY`，再通过 `pluginConfigOverride()` 将安装插件的 `binaryPath` 指向副本；其余 5 项未设置覆盖，使用包内后台。第 5 节记录的副本与包内后台哈希一致。

真实 Desktop 复现需要额外的隔离 `DSH_HOME`、按 Desktop 布局预建 `profiles/desktop`、安装最终 tarball，并运行 `/tmp/dsh-issue13-desktop/drive-desktop.mjs`（受控模型服务端口 18766）；该驱动不属于仓库测试。
