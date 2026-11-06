# Issue #13 统一审查修复记录

审查基线：Standards 轴审查范围 `939f1e9..3e00ba2`；Spec 轴审查 HEAD `3e00ba2`。本修复从集成分支 `integration/issue-13-native-fixes` tip `3e00ba2` 出发，只处理已确认的维护项与 README 缺项，不改变产品行为、Go 后端、客户端源码或 bundle。审查输入为 `/tmp/dsh-issue13-review-standards.md` 与 `/tmp/dsh-issue13-review-spec.md`。

## Standards 轴

| # | 审查项 | 核实与处理 | 验证 |
|---|---|---|---|
| 1 | 两套新浏览器脚本重复 Playwright 解析、登录入页流程 | 属实。`scripts/dsh-harness.mjs` 新增共用 `launchChromium`（Playwright 模块加载边界与启动选项）和 `openNativePage(browser, login, {tab})`（登录、点“继续”重试、进入页面、切换指定标签）。`dsh-settings-check.mjs` 与 `native-attribution-check.mjs` 删除各自副本；settings 保留 `.dic-add` 选项等待，attribution 保留页面错误输出。旧脚本 `dsh-profile-check.mjs` / `dsh-auto-check.mjs` 不在本次范围，未改动。 | 设置与归因浏览器回归均通过。 |
| 2 | legacy 测试手写环境保存恢复 | 属实。`plugin/index.test.mjs` 的 `setHome` 替换为通用 `setEnv(updates)`，legacy 覆盖测试用同一次 `setEnv({DSH_HOME, DSH_INTELLIGENCE_CHECK_DATA_DIR})` 保存并在 `finally` 一次恢复，删除 `previousHome`/`previousOverride` 与四行手写恢复。其余测试改用 `setEnv({DSH_HOME: dataDir})`。 | `node --test plugin/*.test.mjs` 全部通过。 |
| 3 | `plugin-check.mjs` 误导变量名 | 属实。`dataDir` 实为 DSH_HOME 派生的预期存储目录，且不再传入 `apply`；改名为 `expectedDataDir`，仅用于进程命令行过滤。 | `node scripts/plugin-check.mjs` 通过。 |
| 4 | recovery 脚本死导入 | 属实。`getState` 导入后未被使用（状态直接 `fetch`）；已从导入删除。 | 恢复回归通过。 |
| 5 | 三套 provider/patch YAML 模板重复 | 属实且可明显简化。`dsh-harness.mjs` 新增 `providerPatch({baseURL, provider, displayName, models, defaultModel})`，把三处一致的 `apiKeyEnv`、`api`、`compat`、`contextWindow`、`maxTokens`、`input` 固定为单一夹具；三处调用点只保留各自的 provider 名、模型列表与默认模型，并继续追加各自的 `pluginConfigOverride()`。新增 compat 字段只需改一处。 | 三套回归均通过。 |

## Spec 轴

| 项 | 结论 |
|---|---|
| (a) 缺失/部分需求 | #18 最终包与真实 Desktop 验收仍待办，不在本次审查修复范围；本分支补齐 README 集成命令与说明中的 `dsh-settings-check.mjs`、`native-attribution-check.mjs`、`dsh-recovery-check.mjs`。#14、#15、#16、#17 未发现功能性缺项。 |
| (b) 未要求的行为/范围扩展 | 未发现。 |
| (c) 表面实现但错误 | 原结论已撤回，属误报。复核确认 `plugin/client-panel.js:265-274` 的 `refresh()` 自行 `catch` 并只更新错误状态，不向 `act()` 抛出；POST `/config` 成功、随后 GET `/state` 失败时弹窗仍关闭并显示成功反馈。本次未修改产品逻辑。 |

## 本轮验证

环境：DSH `0.2.2-rc.1`，隔离 `DSH_HOME`，当前源码构建的 darwin arm64 后台二进制，本地受控模型服务；未调用付费模型，未读写用户旧数据。

| 检查 | 结果 |
|---|---|
| `node --test plugin/*.test.mjs scripts/ui.test.mjs` | PASS，25 项 |
| `node scripts/plugin-check.mjs` | PASS |
| `node scripts/dsh-recovery-check.mjs` | PASS（并发单后台/单调度、失败重试、桌面退出取消与清理、CLI/Web 只连接） |
| `node scripts/native-attribution-check.mjs` | PASS（归因失败可见、成功报告与空状态不回退） |
| `node scripts/dsh-settings-check.mjs` | PASS，5 项（失败保留草稿、忙碌不报成功、轮询不抢焦点、重试生效、聚焦/Escape/关闭） |
| `node scripts/build-client.mjs` 重建 `plugin/client.js` | 哈希与重建前一致（`9c343cf5…c2522`），bundle 无变化 |
