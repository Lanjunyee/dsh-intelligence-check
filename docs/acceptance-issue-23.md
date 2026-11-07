# Issue #23 修复验收记录

记录日期：2026-11-07。范围：窄屏模型归因候选表溢出、检测工作页代码排版文档不一致，以及相应的原生页面回归。本文只记录本次修复与验证；不改动日常 DSH 配置、安装包或已有检测记录。

## 1. 结论

- 390px 原生检测页展开“全部候选”后，页面滚动宽度从修复前的 654px（clientWidth 390px）恢复为 390px；候选表 640px 内容保留在 362px 宽的局部横向滚动容器内，18 个候选的数量、排序、模型、家族与闭集概率均与报告一致。
- 模型监测目标表继续使用自己的滚动容器：390px 下表格 640px、容器 362px、`overflow-x: auto`；滚动到右端后“操作”列按钮仍可达。宽屏、缩窄、再恢复三种状态均未出现页面横向溢出；宽屏下候选表实际占满 936px 可用容器，而非固定 640px。
- 浅色与深色主题沿用宿主语义色。页面正文文字对比度分别为 18.90:1 和 17.45:1；候选表与监测表的单元格文字同为 18.90:1 / 17.45:1，表头文字为 5.80:1 / 12.11:1。上述数值按表格 `th`、`td` 的实际计算颜色与页面背景计算。
- HTML、SVG、世界海陆地图三类原始回答在真实页面中计算为宿主等宽字体、13px、25.35px 行高；普通代码内容（提示词原文）为 12px、21.6px 行高。
- `DESIGN.md` 的机器可读排版定义与正文、`.impeccable/design.json` 扩展元数据及 `.impeccable` 页面记录已明确区分“代码”和“代码回答”。
- 客户端 bundle 由源码生成，连续重建哈希一致；现有客户端/UI 测试与原生归因回归通过。改动未推送、未合并 main、未更新安装包。

## 2. 基线与环境

| 项 | 值 |
|---|---|
| Issue | #23（无原生子任务、无 blocked_by 依赖） |
| 修复基线 | `88f540d`（`integration/issue-23` 中包含检测工作页改版的基线） |
| 收尾基线 | `87e6844`（`integration/issue-23` 上 #23 的初始修复提交） |
| 工作分支 | `worktree-agent-a483061520292a93a` |
| 平台 | macOS 27.2（Darwin 27.2.0），arm64 |
| Node / Go / DSH | Node `v26.13.0`；Go `1.27.3 darwin/arm64`；DSH `0.2.2-rc.1` |
| 浏览器 | Playwright bundled `chrome-headless-shell`（`chromium_headless_shell-1243`） |
| 模型 | 仅本机回环受控 OpenAI 兼容服务；未使用真实凭据、付费模型或外部服务 |

## 3. 实现摘要

- 模型归因“全部候选”表加入现有 `.dic-table-wrap` 局部滚动容器；容器查询 ≤740px 时，640px 最小宽度从所有表格收窄为仅作用于滚动容器内的表格。
- 为滚动容器所在的网格项补充 `min-width: 0`，使候选表宽度由容器承接，而不是把页面撑宽。
- `DESIGN.md` 新增机器可读 `typography.code-answer`（宿主等宽字体、13px、1.95 行高），正文层级说明其只适用于 HTML、SVG 与世界海陆地图原始回答；普通代码内容保持 12px、1.8。
- `.impeccable/design.json` 以引用基础 token 的方式补充代码回答适用范围和可滚动表格元数据；`.impeccable/surfaces/plugin-client-panel-js.md` 同步响应式与排版说明，不重复定义一套规范。普通代码条目不再把标签计数包含在 12px/1.8 范围内，计数沿用 Components 中已记录的 11px 等宽次文字。
- 新增 `scripts/native-work-page-check.mjs`，复用隔离 DSH 宿主、登录、原生页面入口和受控模型服务；`package.json` 增加 `test:native-work-page`，README 集成命令与能力说明同步补充。受控 OpenAI 兼容 SSE 服务抽取为 `scripts/dsh-harness.mjs` 的小型共用边界，两个原生回归脚本各自提供模型列表与回答逻辑。

## 4. 原生页面回归

命令：

```sh
export PLAYWRIGHT_MODULE=/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/playwright
export PLAYWRIGHT_EXECUTABLE=/Users/jxq/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell
npm run test:native-work-page
```

结果：`native work page check passed`。

| 检查 | 实测 |
|---|---|
| 展开全部候选，390px | 页面 clientWidth 390px / scrollWidth 390px（修复前 scrollWidth 654px）；宿主内容宽度处于 ≤740px 条件 |
| 候选表局部滚动 | 表格 640px；容器 clientWidth 362px、scrollWidth 640px、`overflow-x: auto`；页面不再溢出 |
| 候选完整性 | 18 行；逐行模型名、家族、闭集概率与受控回答经统一指纹库重算的报告一致 |
| 宽屏 / 缩窄 / 恢复 | 宽屏 1000px / 1000px，候选表 936px 占满 936px 容器；390px 展开候选 390px / 390px；恢复宽屏 1000px / 1000px，候选表 936px 占满 936px 容器 |
| 模型监测表，390px | 表格 640px；容器 362px / 640px、`overflow-x: auto`；页面 390px / 390px |
| 监测表操作可达 | 滚动到 `scrollLeft = 278` 后，删除按钮 x=336px、宽 40px，位于 390px 视口内 |
| 浅色主题 | 页面背景 `rgb(255,255,255)`、正文 `rgb(15,17,21)`，对比度 18.90:1；候选表与监测表表头 `rgb(97,102,107)`、对比度 5.80:1，单元格文字对比度 18.90:1 |
| 深色主题 | 页面背景 `rgb(21,21,23)`、正文 `rgb(249,250,251)`，对比度 17.45:1；候选表与监测表表头 `rgb(207,211,214)`、对比度 12.11:1，单元格文字对比度 17.45:1 |
| 代码回答（HTML / SVG / 地图） | 三者均为宿主 `--ds-font-family-code`、13px、计算行高 25.35px |
| 普通代码内容（提示词原文） | 12px、计算行高 21.6px |

回归脚本使用原生页面真实 DOM 计算宽度并读取渲染文本，不以匹配 CSS 选择器或样式字符串替代可见行为。浅色与深色主题还通过同一原生入口实际截图并逐张目视检查：候选表与监测表的表头、单元格文字、背景和行边界清晰可辨，横向滚动前后页面均保持 390px 宽。截图保存于仓库外 `/Users/jxq/agent_work/dsh-issue23-screenshots/`：

- `narrow-light-candidate.png` / `narrow-light-candidate-right.png`，`narrow-dark-candidate.png` / `narrow-dark-candidate-right.png`：候选表左侧列与右侧闭集概率列；
- `narrow-light-monitor-left.png` / `narrow-light-monitor-right.png`，`narrow-dark-monitor-left.png` / `narrow-dark-monitor-right.png`：监测表左右两侧列与操作按钮；
- `wide-light-candidate-table.png`：宽屏下候选表占满可用宽度；
- `wide-light-candidate.png`：宽屏原生页面整体。

## 5. 其他验证

| 命令 | 结果 |
|---|---|
| `node --test plugin/*.test.mjs scripts/ui.test.mjs` | PASS，26 项 |
| `node scripts/native-attribution-check.mjs`（相同 Playwright 环境） | PASS，共用受控服务后现有归因失败/成功/空状态未回退 |
| `node scripts/native-work-page-check.mjs`（最终版本） | PASS，`native work page check passed` |
| `node scripts/build-client.mjs` 连续两次 | 均生成 85,405 B；SHA-256 均为 `91d9eeb4a794d4f8cd272e0bbfdb0e4afe692530008fa3eb5e84d306165e64e8` |
| `node -e "JSON.parse(...)"` 校验 `.impeccable/design.json` | PASS，JSON 可解析 |

本次未改动 Go 后端，因此未重跑 `go test ./...`；该结果不属于本次收尾改动的验证范围。

## 6. 限制与未执行项

- 验证入口是隔离 `DSH_HOME` 中的原生 Web 宿主页面，不是真实打包 Desktop 窗口人工点检；Issue 的主要测试接缝即为该原生页面浏览器入口。
- 截图来自 headless `chrome-headless-shell`、1280×720 宽屏与 390×900 窄屏视口；窄屏候选表与监测表分别截取了局部横向滚动的左右两端，未覆盖真实桌面应用窗口的缩放与主题菜单操作。
- 浅色/深色通过宿主在 `body` 上使用的 `data-ds-dark-theme` 属性切换，未操作桌面应用主题菜单。
- 未替换日常插件安装、未构建或安装发行包、未推送、未合并 main、未创建外部评论；这些均不在本任务范围内。
