# DeepSeek Harness 插件迁移设计

本文件记录设计讨论中已经确认的范围。迁移已实现并通过真实 DSH 隔离 profile 整体验收（见 [Issue #11 验收记录](acceptance-issue-11.md)）；本文件保留原始设计边界。

> **已被 ADR 0002 取代的部分**：Issue #12 起，页面改为 DSH 原生侧边栏入口与主区域页面（不再以独立网页控制台为主入口）；数据改为用户级 `$DSH_HOME/dsh-intelligence-check` 跨 profile 共享，同一用户同机只运行一套后台；后台只由桌面宿主启动，单独 CLI/Web 宿主不启动。下文涉及“不同 profile 隔离”、控制台入口和按 profile 子进程的描述仅作历史记录，以 [ADR 0002](adr/0002-native-desktop-panel-shared-backend.md) 和 [Issue #12 验收记录](acceptance-issue-12.md) 为准。

## 产品范围

- 唯一宿主为 DeepSeek Harness（DSH），使用其原生插件接口。
- 产品提供主动模型测试与报告；检测成功、失败或执行中均不阻断业务模型请求。
- 保留现有题库、手动测试、新检测历史、人工评审、HTML/SVG 预览与 ModelTrace。
- 旧版数据原样保留，不导入新插件。
- 保留 Go 后端、SQLite 与独立网页控制台，由插件提供控制台入口并管理后端启动与退出。（Issue #12 起独立网页仅作为兼容接口，主入口为原生页面。）
- 同一 profile 的各会话共享数据；不同 profile 的配置、历史、评审和后台实例隔离。（Issue #12 起改为用户级共享，见 ADR 0002。）

## 模型与自动检测

检测目标是宿主中的 provider + model 组合，同名模型不能跨 provider 合并。宿主插件读取模型目录，并使用 `ctx.llm.stream()` 执行主动测试，复用 adapter 配置与凭据。控制台不再要求填写 Magpie 网关或 API key。

自动检测默认关闭。使用者开启后，仅对明确加入监测的模型定时执行 milk 基础题；默认间隔 15 分钟，可调整。其余质量题与 ModelTrace 手动发起。定时检测仅在宿主与插件后台运行期间生效，不依赖业务会话触发。

## 实现边界

1. 原生插件通过 `apply(ctx, config)` 挂载，按官方 bundle 格式分发。
2. 插件管理 profile 对应的 Go 子进程及模型调用桥接。卸载与退出时清理监听器、取消进行中的调用并停止子进程。
3. Go 后端保留题库、检测调度、结果与评审存储、管理 API 和网页。将现有直接调用网关的传输边界替换为宿主桥接，保留网页的实时回答展示。
4. 桥接传递模型身份、题目与生成参数，以及回答增量、完成状态和可用的 token 用量；宿主未报告用量时不能伪造为零用量。
5. 删除 Magpie 专属 provider 注册、OAuth 入口借用、网关发现、请求门禁脚本生成、日志触发和探针模型前缀绕过。
6. 控制台使用宿主公开的入口机制提供网页链接；不以命令能自动聚焦宿主侧栏为前提。沿用现有控制台授权方式。

桥接协议和具体模块拆分属于实现选择，无须为当前范围引入通用插件框架。

## 验收场景

- 在真实 DSH profile 安装后可启动插件、打开控制台，并获取宿主模型目录。
- 手动检测指定 provider + model 时显示回答与结果；同名模型按提供方分别记录。
- 现有题库、人工评审、历史、导出、HTML/SVG 预览和 ModelTrace 继续可用。
- 默认不自动检测；启用后仅对监测目标按配置间隔执行 milk。
- 检测异常不阻断业务对话；关闭或卸载插件后不遗留定时任务和后台进程。
- 两个 profile 的配置与历史互不影响；旧版数据不被覆盖。（Issue #12 起两个 profile 共享同一用户级数据与后台，旧版数据仍不被读取或覆盖。）

## 一手资料

以下接口依据 2026-11-05 对目标仓库 master 的调查；DSH 处于 developer preview，实施时应记录实际验证的提交和版本。

- [原生插件入口](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.md)
- [Bundle 分发](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)
- [插件生命周期](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/framework/index.md)
- [插件命令与 profile 安装](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md)
- [LLM API 与模型路由](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm/README.md)
- [生成参数与模型类型](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm/src/types.ts)
- [流式回答、用量与取消](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/llm-streaming.md)
- [宿主命令注册](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/commands.md)
- [宿主 Web 路由](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/web-server.md)

相关决定见 [ADR 0001](adr/0001-native-dsh-plugin-with-go-backend.md) 与 [ADR 0002](adr/0002-native-desktop-panel-shared-backend.md)，领域术语见 [GLOSSARY](../GLOSSARY.md)。
