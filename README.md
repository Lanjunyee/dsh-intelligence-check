# dsh-intelligence-check

项目仓库：[Lanjunyee/dsh-intelligence-check](https://github.com/Lanjunyee/dsh-intelligence-check)。

项目已迁移为 DeepSeek Harness 原生模型质量测试与报告插件，复用桌面应用的模型配置与凭据，保留 Go 后端与 SQLite，检测结果不阻断业务请求。入口已从斜杠命令与独立网页控制台迁入 DSH 全局侧边栏，并在主区域展示原生检测页面；同一用户、同一台机器的所有工作目录与 profile 共享检测状态和一套后台。设计见 [ADR 0002](docs/adr/0002-desktop-panel-and-shared-check-state.md)，实现规格见 [Issue #12](https://github.com/Lanjunyee/dsh-intelligence-check/issues/12)。

**当前状态：Issue #12 已实现，Issue #13 的四项修复已合入并从最终源码交付。原生侧边栏入口与主区域页面、用户级共享存储、单后台与桌面配置权威、桌面退出清理、CLI 不启动后台、题库/手动检测/自动检测/历史/人工评审/导出/HTML/SVG 预览/ModelTrace 均已接入；Issue #12 在真实 DSH `0.2.2-rc.1` Web 宿主和真实打包 Desktop 应用中完成验收，Issue #13 最终包另在真实打包 Desktop 中完成设置失败/重试/焦点、归因失败可见、基本页面与退出清理验收（见 [Issue #12 验收记录](docs/acceptance-issue-12.md) 与 [Issue #13 验收记录](docs/acceptance-issue-13.md)）。**

当前实现是 DSH 原生 Cordis 插件，对指定的模型执行主动质量检测并保存报告；检测运行、失败或异常结果均不拦截业务请求，也不改写业务模型路由。

项目由两部分组成：

- **DSH 插件**：`plugin/index.mjs` 在 DSH 桌面宿主中启动唯一的共享 Go 后台，`plugin/client.js` 把“模型质量检测”注册到全局侧边栏并打开主区域原生页面；模型目录与检测调用经插件桥接到桌面宿主的 `ctx.llm.stream()`，复用桌面 provider 配置与凭据。单独启动 CLI 不启动检测后台。
- **Go 后台**：`cmd/quality-check` 提供本机管理 API、SQLite 状态存储、模型检测、临时远程控制台和原有嵌入页面。共享后台由桌面宿主管理，页面通过宿主同源路由访问。

## 工作流程

```text
DSH 侧边栏 -> 主区域原生检测页面 -> 手动/定时质量检测 -> 插件桥接 -> 桌面宿主模型调用 -> 保存回答、评估与人工评审
业务客户端 -> DSH -> 上游模型（不经过检测结果判断）
```

检测是主动测试与报告功能。目标可以加入监测范围，也可以随时手动运行任意题目；检测状态和结果不影响业务请求是否发往上游。

同一用户、同一台机器的所有 DSH 工作目录与 profile 共享检测配置、监测目标、记录、人工评审及一套后台。多个入口同时使用时不会因数据目录锁出现第二个入口不可用；只有一套自动检测调度。切换页面或关闭检测面板不停止自动检测；退出 DSH 桌面应用时插件后台及活动任务一起结束。

## 界面预览

[质量题库](assets/screenshots/quality-bank.png)、[检测记录](assets/screenshots/history.png)与[模型归因](assets/screenshots/model-attribution.png)的截图由隔离的 DSH Web 宿主实际渲染，使用本地受控演示模型生成数据，用于展示功能与布局。市场展示顺序由根目录 `screenshots.json` 声明。

## 安装

本包以 DSH 官方 bundle 分发：`package.json` 声明 `dsh.bundle.patch`、`dsh.bundle.platforms` 与 `dsh.client`（`platform: web`），`cordis.patch.yml` 插入 `dsh-intelligence-check` 插件行，`exports["./client"]` 提供原生页面 bundle。`engines.dsh` 声明兼容范围 `>=0.2.0 <0.3.0`，但实际验收只在 DSH `0.2.2-rc.1`（macOS arm64）完成；该声明不是已逐版本验证的范围。包清单的 `icon` 指向 `assets/plugin-icon.png`（小于 256 KiB），完整图标资源仍随包分发。

### 从发行包安装（使用者无需 Go）

从 [最新发行版](https://github.com/Lanjunyee/dsh-intelligence-check/releases/latest) 下载 `dsh-intelligence-check.tgz` 通用包，或选择 `dsh-intelligence-check-<platform>-<arch>.tgz` 分平台包。通用包内置五个平台的 Go 后台并自动选择当前平台；分平台包只含对应后台。安装时不需要 Go、pnpm 或现场编译：

```sh
# 先启动一次 DSH 桌面应用并完全退出，初始化其固定 profile
dsh plugin --profile desktop add /absolute/path/to/dsh-intelligence-check.tgz
```

DSH 桌面应用固定使用 `$DSH_HOME/profiles/desktop`（默认 `~/.dsh/profiles/desktop`），因此必须安装到 `desktop` profile；安装到其他 profile 不会出现在桌面应用侧边栏。请使用桌面应用“管理 dsh 命令”安装的 `dsh` 命令执行上述安装；独立 npm CLI 可能拒绝管理保留的 `desktop` profile。

安装后启动 **DSH 桌面应用**，在全局侧边栏选择“模型质量检测”，完整页面会在主区域打开。不需要斜杠命令、复制链接或外部浏览器。

如希望同时从 CLI/Web 宿主查看同一状态，可把插件安装到该宿主使用的 profile（例如 `web`）。该实例只连接桌面应用已运行的共享后台，不启动也不接管后台；桌面应用未运行时页面显示后台不可用。

| 平台 | 安装包 |
| --- | --- |
| macOS Apple Silicon | `dsh-intelligence-check-darwin-arm64.tgz` |
| macOS Intel | `dsh-intelligence-check-darwin-amd64.tgz` |
| Linux x86-64 | `dsh-intelligence-check-linux-amd64.tgz` |
| Linux ARM64 | `dsh-intelligence-check-linux-arm64.tgz` |
| Windows x86-64 | `dsh-intelligence-check-windows-amd64.tgz` |

通用包包含五个 `bin/quality-check-<platform>-<arch>` 后台（Windows 为 `.exe`）；每个分平台包只含本平台 `bin/quality-check`（Windows 为 `.exe`）。插件按宿主平台优先选择带平台后缀的后台，分平台包内回退到 `bin/quality-check`；也可用 `binaryPath` 覆盖。

共享数据位于 `$DSH_HOME/dsh-intelligence-check/`（未设置 `DSH_HOME` 时为 `~/.dsh/dsh-intelligence-check/`），由同一用户的全部工作目录与 profile 共同使用。新版从空数据开始，不读取、迁移或合并旧 profile 数据；旧数据不会被删除，也无需为迁移备份。单独启动 `dsh` CLI（包括 `dsh web`）只加载页面，不启动或接管检测后台；桌面应用的共享后台正在运行时，该页面连接并显示同一状态，否则显示后台不可用。

卸载：`dsh plugin --profile desktop remove dsh-intelligence-check`。卸载不会删除用户级共享数据目录。

### 开发检出

```sh
# 先启动一次 DSH 桌面应用并完全退出，初始化固定 profile
dsh plugin --profile desktop add /absolute/path/to/dsh-intelligence-check
node scripts/build-client.mjs
```

然后重新启动 DSH 桌面应用，从侧边栏打开原生页面。桌面应用固定使用 `profiles/desktop`，安装到其他 profile 不会进入桌面侧边栏。仅运行 `dsh --profile <name>`（CLI/Web 宿主）不会启动或接管共享后台；桌面后台正在运行时它只连接并读取同一状态。原生页面 bundle 由 `plugin/client-core.mjs`、`plugin/client-panel.js` 与 ModelTrace 评分核心生成，修改源码后需重新执行 `node scripts/build-client.mjs`。

### 从源码构建

需要 Go `1.26` 或更高工具链；只有维护者构建发行包时需要：

```sh
go build -o bin/quality-check ./cmd/quality-check
```

### 发行包与校验

```sh
node scripts/build-release.mjs
node scripts/package-check.mjs
```

产物在 `dist/`：五个平台的 `quality-check-<platform>-<arch>` 后台、五个分平台 bundle tarball、通用包 `dsh-intelligence-check.tgz`、`manifest.json` 与 `SHA256SUMS`。校验：

```sh
cd dist && shasum -a 256 -c SHA256SUMS
```

`manifest.json` 记录每个产物的平台、大小与 SHA-256。发行包通过 GitHub Releases 分发，已收录于[插件市场](https://awesome-dsh-plugin.com/zh/p/Lanjunyee/dsh-intelligence-check/)，不发布 npm；当前只在 macOS arm64 上执行真实平台安装，其余平台产物由交叉编译生成并通过布局与校验检查。

## 首次配置

1. 启动 DSH 桌面应用，在全局侧边栏点击“模型质量检测”，主区域打开原生检测页面。
2. 默认打开“质量题库”。首次使用点击“添加检测目标”，或通过“管理检测目标”进入“模型监测”，从桌面应用的模型目录选择提供方和模型并添加。
3. 回到质量题库，在左侧选择模型和题目，点击“运行所选题目”；右侧显示原始回答，可切换回答记录、复制、下载、查看 HTML/SVG 预览及保存人工评审。窄窗口自动改为上下布局。手动测试无需开启自动监测。
4. 如需定时检测，在“模型监测”页打开目标的“自动监测”开关，再通过右上角设置配置自动检测与间隔。自动检测默认关闭，默认间隔 900 秒（15 分钟）；设置中也可调整每日每模型请求上限。

自动检测开启后，后台只对已打开“监测”的目标按间隔执行 milk，不依赖业务对话，其余质量题与 ModelTrace 仍需手动运行。关闭自动检测或移除监测目标后不再产生后续定时调用；配置在用户级共享数据目录中保存，切换工作目录或 profile、重启桌面应用后继续生效。关闭检测面板或切换到其他 DSH 页面不会停止已开启的自动检测；重新打开页面即可查看结果。检测不拦截业务请求。

## 内部 Go 控制台（兼容保留）

产品入口是 DSH 原生页面，不再是独立网页控制台。Go 后台仍保留原有嵌入页面与临时 Cloudflare 通道接口，供既有检查脚本和直接调用管理 API 的维护者使用；DSH 插件不再签发控制台链接或提供远程入口。以下行为仅适用于直接调用该接口的既有检查：

- 一次性 `/open/...` 链接有效 10 分钟；
- 浏览器会话最长 30 分钟；
- 临时通道最长 30 分钟，也可以在页面中提前结束；
- 关闭通道会撤销远程会话，但不会停止检测后台；
- 只开放管理页面，不开放模型调用接口，宿主凭据不返回浏览器。

插件优先使用 PATH 中已有的官方 `cloudflared`。找不到时，默认下载并校验固定版本 `2026.10.0`，缓存到数据目录的 `runtime/`，不需要 root，也不会修改系统 PATH。自动下载需要访问 GitHub 发行文件和 Cloudflare 隧道服务；可通过 `cloudflaredPath` 指定已有客户端，或关闭自动下载。

远程入口会先等待公网 `/health` 就绪，最长 60 秒，再返回管理链接。
如果出现 `502`，本轮就绪检查失败会关闭通道；检查网络后，维护者使用后台启动时输出的控制令牌调用 `POST /api/console` 重新签发入口。
管理链接从外部页面打开时，使用 `HttpOnly`、`SameSite=Lax` 会话 Cookie 完成重定向；
会话过期后需要维护者通过管理 API 重新签发链接。

不要只打开临时域名首页，必须使用管理 API 返回的完整 `/open/...` 链接。不要把管理端口直接绑定到公网。

## 检测规则

内置 7 道题：

| ID | 题目 | 自动评估 |
| --- | --- | --- |
| `milk` | 牛奶推理 | 是 |
| `repeat` | 逐字复述 | 否，人工评价 |
| `japan` | 日本首相 | 否，人工评价 |
| `person` | 人物知识 | 否，人工评价 |
| `html` | HTML/SVG 动画 | 否，人工评价 |
| `svg` | SVG 创作 | 否，人工评价 |
| `map` | 世界海陆地图 | 否，人工评价 |

提示词正文按源码原样发送，保留字符、标点、空格和空行。题目文本有 SHA-256 回归测试；代码围栏、语言标记和评价说明不会追加到发送正文。

自动评估只使用 `milk`：最终答案为 `46.24`，或最后一个带 `inches`/`inch`/`英寸` 单位的数字为 `46.24` 时通过。首次答案异常会独立复测一次；两次都未通过时记录为“未通过”。

其他题目会保存原始回答和 token 用量，在质量题库页面直接展示，也可选择历史回答、复制或下载。失败与截断会显示原因，并保留已返回的回答正文。用户可保存“待确认 / 确认通过 / 标记问题”与评审备注；结论记录在对应回答上，不更改自动评分或模型调用。自动辅助检查展示字符数、逐字复述覆盖率或代码标记等可验证线索，不识别模型身份，也不替代人工评审。后台不会执行模型生成的 HTML、SVG 或 Python。

### 预算与超时

- 默认每个模型每天最多 120 次请求，可在控制台设置为 1–10000；
- `milk` 异常时独立复测一次，两次调用分别保存记录；
- 单次请求 `max_tokens` 为 8192；
- 手动与自动质量检测的单轮总超时为 10 分钟（包括 `milk` 异常复测）；ModelTrace 每道挑战的调用超时为 10 分钟；
- 宿主模型调用失败、超时、空回答、截断、无效响应或预算耗尽会标记为“检测不可用”；
- 传输失败与取消不自动复测。

这些题目只是行为与能力线索，不是模型身份认证、供应商认证或通用智商排名。单题失败不能证明模型被替换；知识题有时效性，复述指纹也可能随版本变化。

### 题库反馈与更新

质量测试支持流式正文、等待时间和取消；取消或连接中断保留已返回正文，生成中不会执行预览。HTML 可切换代码块、选择手机/平板/桌面宽度、页内放大，并可选择明确标注的 HTML + CSS/JS 组合结果；原始回答不修改。离开题库会停止预览。历史支持题目、模型、结果、评审状态筛选，双回答对比与筛选结果 JSON 导出。清理需确认，检测期间不可清理；只移除回答与评审，保留已消耗预算计数，不影响模型调用。

HTML 预览额外移除声明式自动刷新、外链导航、表单目标和 base 标签，并使用不含同源、顶层导航或弹窗权限的沙箱。允许任意内联脚本时，浏览器不能可靠禁止 iframe 自身的脚本导航，因而这不是完整的离线执行环境；只预览可信回答，不要在预览中输入敏感信息。网络 API、外部资源和管理页访问限制仍生效。

SVG 题中的完整 SVG 可直接静态预览，不执行脚本、外部资源或动画。HTML 题可在隔离的 iframe 中实时预览模型生成的页面、内联 JavaScript、Canvas 和动画，并可停止或重新加载；轮询不会重启动画。预览不开放管理页面、Cookie 或存储访问权限，禁止网络 API 请求、外部脚本、嵌套页面、表单提交和弹窗。依赖 CDN 或外部图片的回答可能无法完整显示；不可信脚本仍可能消耗浏览器资源，必要时停止预览或关闭页面。原始回答保持不变，可查看、复制与下载。关闭监测只影响自动检测范围，仍可手动运行质量题和指纹挑战；删除目标后测试选择器同步移除，再添加后同步更新。

欢迎实际测试后反馈：哪些题目现在仍然好用，哪些已经失效、答案有争议，或容易误判？现有题库不保证对所有模型版本、渠道和系统提示词都有效，请结合页面中的原始回答自行确认。

如果你有**更新、可用的测试题**，或发现更适合推理、翻译、知识、复述等能力的题目，请[提交题库反馈 Issue](https://github.com/Lanjunyee/dsh-intelligence-check/issues/new?template=question-bank.yml)。维护者会审核后手动添加或更新，不会自动把社区题目纳入自动评估。

提交时请提供：

- 题目原文与来源；原创题目请注明。
- 测试的模型、版本或日期、渠道，以及是否使用额外系统提示词。
- 原始回答、预期答案或人工评价标准。
- 为什么认为它有效；有多次测试或不同模型的对照结果更好。
- 已知限制，例如知识时效性、不同合理答案或可能的误判。

请勿提交 API Key、管理链接、私人对话或其他敏感信息。无需为反馈专门重复付费测试，已有的匿名化结果即可。

### ModelTrace 模型指纹

控制台提供独立的 **ModelTrace 模型指纹** 检测。选择已启用监测的模型，点击“运行三条指纹挑战”，后台经宿主桥接发送三次独立数字选择请求。每条要求生成 292–332 个 1–355 范围内的整数。

- 每轮预留 3 次当日预算，不足时不发请求；没有自动复测；
- 每条请求最多 180 秒，三条顺序执行；关闭浏览器不会中断后台采集；
- 保存每条挑战原文、原始回答、token 用量和批次，刷新页面后仍可查看；
- 三条回答都有效才展示归因；拒答、截断、调用失败或有效数字不足不会被当作模型异常；
- 浏览器本地使用 ModelTrace 原版评分算法及固定候选库，展示候选模型排名和家族概率；
- 不改变已有检测记录或评分。

当前候选库含 GPT、Claude 两个家族的 18 个模型。概率是库内候选的闭集概率：
即使真实模型不在库里，也会归到某个最相似候选，因此不能据此认证身份或自动封锁模型。
渠道系统提示词和协议转换也可能改变输出分布。

来源为 `xqy2006/ModelTrace`，固定提交和资源校验值见 `third_party/modeltrace/README.md`；
采用 MIT 许可，评分代码与候选库嵌入 Go 二进制，无需 Python、外部评分服务或运行时下载。

## 目标与人工操作

检测目标列表展示模型和当日已用请求数；“监测”开关决定是否加入定时自动检测范围。自动检测固定执行 milk；其余题目与 ModelTrace 仍需手动触发。

可执行操作：

| 操作 | 作用 |
| --- | --- |
| 重新检测 | 立即运行默认题目，计入预算 |
| 关闭监测 | 关闭该目标的自动检测范围，不影响手动检测 |
| 删除检测目标 | 从列表移除并保留历史回答和评审；检测中不可删除 |

检测目标的状态和评估结果只写入检测记录，不控制业务请求，也不改变宿主的 provider 配置或凭据。

## 插件选项

可以在 profile 的 `cordis.patch.yml` 中为插件行传入：

```yaml
- id: dsh-intelligence-check
  config:
    binaryPath: /srv/dsh-intelligence-check/bin/quality-check
```

- `binaryPath`：指定 Go 后台二进制；省略时按平台选择包内 `bin/quality-check-<platform>-<arch>`。

数据目录仅由宿主 `DSH_HOME` 或宿主默认用户目录决定，固定为用户级 `$DSH_HOME/dsh-intelligence-check/`（默认 `~/.dsh/dsh-intelligence-check/`）。不接受 profile 目录覆盖，也不再接受插件 `config.dataDir` 或 `DSH_INTELLIGENCE_CHECK_DATA_DIR` 覆盖；遗留的覆盖设置不再生效，不会改变共享目录选择。这样可保证同一用户同机共享、避免第二套后台争用数据目录锁。停用、退出或重启不会清除数据；卸载插件也不会自动删除共享数据目录，请按需手动清理。新版不读取、迁移、覆盖或删除旧版按 profile 保存的数据。

同一用户同机只运行一套检测后台与自动检测调度。首个桌面宿主实例持有数据目录锁并成为模型目录权威；其他 profile 的宿主读取同一连接并复用该后台，不覆盖桌面模型配置。持有实例退出后，仍在运行的桌面宿主会重新选举并继续使用同一 SQLite 状态。

## 限制与兼容性

- 原生侧边栏入口、主区域页面、用户级共享存储、单后台、桌面退出清理、官方 bundle/五平台分发、宿主模型目录与桥接、以及默认关闭的定时 milk 自动检测已实现；
- 检测后台只由 DSH 桌面宿主启动。单独启动 CLI 或 `dsh web` 不启动或接管后台，只连接已运行的桌面后台；没有桌面后台时页面显示后台不可用；
- 自动检测只在桌面宿主后台运行期间执行，不提供宿主退出后的守护进程或停机补跑；关闭、禁用、卸载或退出时停止后续定时调用并取消活动调用；
- 检测结果不参与业务请求放行、拒绝、暂停或模型切换；
- 检测目标来自桌面应用的模型目录，模型调用经插件桥接到 `ctx.llm.stream()`，复用桌面 provider 配置与凭据；其他 profile 不会覆盖该目录；
- 五个平台的发行包由最终集成源码交叉编译并通过布局与 checksum 检查；只有 macOS arm64 在本机执行了真实 DSH 安装与宿主验收。Issue #12 的真实打包 Desktop 验收针对当时的产物，覆盖侧栏、四标签、受控检测、历史与退出清理；Issue #13 最终包另在真实打包 Desktop 中完成设置保存失败保留草稿与重试、轮询焦点、归因失败可见、基本页面及退出清理验收。操作为自动驱动而非人工鼠标，详见验收记录；
- Issue #12 与 Issue #13 的产物与验收记录分别见 [Issue #12 验收记录](docs/acceptance-issue-12.md) 与 [Issue #13 验收记录](docs/acceptance-issue-13.md)。
- Cloudflare Quick Tunnel 是临时通道，不保证公网可用性或稳定性；DSH 原生入口不依赖该通道。

## 开发与验收

运行 Go 测试和插件测试：

```sh
go test -race ./...
go vet ./...
node scripts/build-client.mjs
node --test plugin/*.test.mjs
node --test scripts/ui.test.mjs
```

`plugin/client.test.mjs` 校验原生页面的注册契约、各标签页渲染和共享纯函数；`scripts/ui.test.mjs` 校验 Go 内嵌页面的既有资源。

构建发行包和校验清单：

```sh
node scripts/build-client.mjs
node scripts/build-release.mjs
node scripts/package-check.mjs
node scripts/install-check.mjs
node scripts/install-check.mjs --universal
```

可选的集成检查（使用隔离 `DSH_HOME`；`DSH_PLUGIN_PACKAGE` 指定要安装的 tarball 或检出目录，`DSH_INTELLIGENCE_CHECK_TEST_BINARY` 指定当前源码构建的后台）：

```sh
DSH_PLUGIN_PACKAGE=/absolute/path/to/dist/dsh-intelligence-check-darwin-arm64.tgz node scripts/dsh-profile-check.mjs
DSH_PLUGIN_PACKAGE=/absolute/path/to/dist/dsh-intelligence-check-darwin-arm64.tgz node scripts/dsh-lifecycle-check.mjs
DSH_PLUGIN_PACKAGE=/absolute/path/to/dist/dsh-intelligence-check-darwin-arm64.tgz node scripts/dsh-auto-check.mjs
DSH_INTELLIGENCE_CHECK_TEST_BINARY=/absolute/path/to/quality-check node scripts/dsh-profile-check.mjs
DSH_INTELLIGENCE_CHECK_TEST_BINARY=/absolute/path/to/quality-check node scripts/dsh-recovery-check.mjs
DSH_INTELLIGENCE_CHECK_TEST_BINARY=/absolute/path/to/quality-check node scripts/dsh-settings-check.mjs
DSH_INTELLIGENCE_CHECK_TEST_BINARY=/absolute/path/to/quality-check node scripts/native-attribution-check.mjs
PLAYWRIGHT_MODULE=/absolute/path/to/playwright PLAYWRIGHT_EXECUTABLE=/absolute/path/to/chrome-headless-shell npm run test:native-work-page
node scripts/plugin-check.mjs
node scripts/cloudflare-check.mjs
node scripts/browser-check.mjs
node scripts/auth-browser-check.mjs
```

集成脚本通过 `DSH_INTELLIGENCE_CHECK_DESKTOP=1` 模拟桌面宿主的后台生命周期头；真实桌面应用依赖宿主注入的 `DSH_CLIENT_VERSION` 判定。脚本不会启动用户自己的桌面实例，也不会读写用户旧 profile 数据。

其中：

- `build-client.mjs` 把原生页面源码与 ModelTrace 评分核心组装为 DSH 模块加载器要求的 `plugin/client.js`；
- `build-release.mjs` 交叉编译五个平台后台，用 `npm pack` 生成五个分平台包与一个包含全部后台的通用包，并写入 `manifest.json` 与 `SHA256SUMS`；
- `package-check.mjs` 检查包标识、`dsh.bundle`/`dsh.client` 声明、`./client` 导出、截图、图标大小、分平台与通用包布局、可执行位、checksum 与无 Go 源码；
- `install-check.mjs` 解压当前平台发行包并验证插件与客户端 bundle 可加载、后台可启动和清理；加 `--universal` 检查通用包；
- `dsh-profile-check.mjs` 使用隔离 `DSH_HOME` 和真实 DSH profile 验证原生侧边栏页面、用户级共享状态、单后台、桌面模型目录权威、跨 profile 会话、CLI/Web 仅连接不启动、HTML/SVG 预览、人工评审、ModelTrace、桌面退出/接管清理与 HMR 重载；浏览器可用时通过 Playwright 点击侧边栏并操作主区域页面；
- `dsh-lifecycle-check.mjs` 使用真实宿主桥接验证完整/缺用量/错误/截断/取消/独立复测/同名目标隔离/取消后重跑与重启持久化；
- `dsh-auto-check.mjs` 使用隔离 `DSH_HOME` 和本地受控模型服务，以短间隔验证自动检测默认关闭、仅监测目标 milk、无业务对话触发、关闭/移除停止、并发合并、预算与清理、重启配置及退出取消；浏览器可用时通过原生页面开启自动检测并设置间隔，关闭页面后继续观察定时调用；
- `dsh-recovery-check.mjs` 使用隔离 `DSH_HOME`、真实 Go 后台和进程观测验证并发恢复只产生单后台、单调度，失败后可重试，桌面退出取消活动检测并清理，CLI/Web 仅连接不启动、不接管、不推送模型目录；
- `dsh-settings-check.mjs` 使用隔离 `DSH_HOME`、真实 DSH profile、本地受控模型服务和 Playwright 路由拦截，验证设置保存失败保留草稿与修改标记、忙碌未执行不报成功、后台轮询不抢占输入焦点、失败后重试生效，以及首次聚焦、Escape 和关闭按钮交互；
- `native-attribution-check.mjs` 使用隔离 `DSH_HOME`、本地受控模型服务和真实浏览器验证模型归因失败在模型指纹页可见，正常报告与空状态语义不变；
- `native-work-page-check.mjs`（`npm run test:native-work-page`）使用隔离 `DSH_HOME`、本地受控模型服务和真实浏览器验证检测工作页：390px 下展开全部候选后页面不被撑宽、候选表与模型监测表在各自容器内滚动、浅深主题可读，并核对代码回答排版；需要 Playwright，可用 `PLAYWRIGHT_MODULE` 指定模块位置、`PLAYWRIGHT_EXECUTABLE` 指定浏览器可执行文件；
- `plugin-check.mjs` 验证已安装包的原生插件启动共享后台、提供页面 API 并清理进程；
- `cloudflare-check.mjs` 验证 Go 后台临时 HTTPS 入口、会话交换和关闭（内部兼容接口）；
- `browser-check.mjs` 使用真实隔离 DSH profile、宿主配置的受控 OpenAI 兼容服务和 Playwright，验证七题原文、provider + model 路由、实时增量、历史/评审/导出/下载/复制、HTML/SVG 隔离预览、手动 ModelTrace、回答/评估/用量持久化与业务会话并行；`PLAYWRIGHT_MODULE` 可指定模块位置；
- `auth-browser-check.mjs` 使用真实浏览器验证 Go 内嵌页面的管理链接、票据重定向和会话刷新（内部兼容接口）。

运行时检测链路的 Go 测试使用受控模型响应，覆盖手动 milk、评分、独立复测、预算、取消、记录持久化和传输边界；不依赖业务请求被拦截。

## 目录结构

```text
cmd/quality-check/       Go 后台入口（桌面共享实例、连接文件与生命周期）
internal/check/          状态、检测传输边界、HTTP 控制台和用户级共享存储
internal/check/web/      嵌入 Go 二进制、仅作为兼容入口的管理页面
internal/check/web/modeltrace/  ModelTrace 评分核心（构建时内联到原生页面）
plugin/index.mjs         DSH 原生 Cordis 插件入口：桌面判定、共享后台、同源代理
plugin/backend.mjs       Go 后台进程启动、所有权/接管、控制台链接签发与退出回收
plugin/client-core.mjs   原生页面纯函数（标签、用量、日期、评分呈现）
plugin/client-panel.js   原生侧边栏入口与主区域页面（React）
plugin/client.js         构建产物：DSH 模块加载器工厂 bundle
scripts/build-client.mjs 组装原生页面 bundle
scripts/                 构建、集成和客户端验收脚本
cordis.patch.yml         DSH bundle 的插件行
plugin/cloudflared-runtime.mjs  Cloudflare 客户端发现、下载和校验
third_party/cloudflared/ Cloudflare 客户端许可文件
```

## 许可

本项目采用 MIT License。Cloudflare 客户端相关许可随包保留在 `third_party/cloudflared/LICENSE`；ModelTrace 许可保留在 `third_party/modeltrace/LICENSE`。
页面内置 Space Grotesk、Space Mono 字体和 Lucide 图标，无需运行时 CDN；许可分别保留在 `third_party/fonts/` 和 `third_party/lucide/LICENSE`。
