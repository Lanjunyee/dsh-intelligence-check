# dsh-intelligence-check

项目仓库：[Lanjunyee/dsh-intelligence-check](https://github.com/Lanjunyee/dsh-intelligence-check)。

项目正在迁移为 DeepSeek Harness 原生模型质量测试与报告插件，目标是复用宿主模型配置与凭据，保留 Go 后端和独立网页控制台，检测结果不阻断业务请求。迁移设计见 [设计文档](docs/dsh-migration.md)，实现规格见 [Issue #1](https://github.com/Lanjunyee/dsh-intelligence-check/issues/1)。

**当前状态：已完成项目重命名与业务门禁解耦，DSH 宿主适配尚未实现。以下安装与配置说明对应当前的 Magpie 实现，不代表已经支持 DSH。**

当前实现是 Magpie 插件，对指定的模型执行主动质量检测并保存报告；检测运行、失败或异常结果均不拦截业务请求，也不改写业务模型路由。

项目由两部分组成：

- **Magpie 插件**：`plugin/index.mjs` 负责启动后台、注册控制台入口和读取 Magpie 配置。
- **Go 后台**：`cmd/quality-check` 提供本机管理 API、SQLite 状态存储、模型检测和临时远程控制台。管理页面嵌入在 Go 二进制中。

## 工作流程

```text
控制台 -> 手动质量检测 -> 模型网关 -> 保存回答、评估与人工评审
业务客户端 -> Magpie -> 上游模型（不经过检测结果判断）
```

检测是主动测试与报告功能。目标可以加入监测范围，也可以随时手动运行任意题目；检测状态和结果不影响业务请求是否发往上游。

同一目标的并发检测会合并；检测期间不能重复发起同一目标的检测。

## 安装

### 从 Magpie 的安装框添加

在“已有想装的？”输入框填写：

```text
github:Lanjunyee/dsh-intelligence-check
```

仓库包含五个平台的 Go 二进制，插件会按 Magpie 所在机器的系统和架构选择。
供应商显示名为 **dsh-intelligence-check**。更新后请重新安装插件并重新打开管理入口。

### 使用发行包

发行包在 `dist/` 中，按平台提供完整插件目录和已编译的 Go 二进制：

| 平台 | 文件 |
| --- | --- |
| Linux x86_64 | `dsh-intelligence-check-linux-amd64.tgz` |
| Linux ARM64 | `dsh-intelligence-check-linux-arm64.tgz` |
| macOS Intel | `dsh-intelligence-check-darwin-amd64.tgz` |
| macOS Apple Silicon | `dsh-intelligence-check-darwin-arm64.tgz` |
| Windows x86_64 | `dsh-intelligence-check-windows-amd64.tgz` |

解压后，把解压出的**完整目录**添加到 Magpie：

```sh
tar -xzf dsh-intelligence-check-darwin-arm64.tgz
magpie plugin add /absolute/path/to/dsh-intelligence-check-darwin-arm64
```

安装目录需要保持固定并可写。发行包已经包含对应平台的 Go 二进制，运行机器不需要安装 Go 或 Node.js。

### 从源码构建

需要 Go `1.26` 工具链：

```sh
go build -o bin/quality-check ./cmd/quality-check
magpie plugin add /absolute/path/to/dsh-intelligence-check
```

开发目录需要包含 `plugin/`、`bin/quality-check`、`package.json` 和 `third_party/`。Magpie 主进程（桌面应用、`magpie web` 或 `magpie serve`）必须保持运行；插件后台跟随宿主进程生命周期。

## 首次配置

1. 在 Magpie 插件入口打开“本机质量检测控制台”。
2. 点击右上角设置图标，在“连接与预算”中确认网关 URL、Key 和每日请求上限，保存后会验证连接。
3. 点击“刷新模型”，选择完整模型 ID，例如 `provider/model`，添加检测目标。
4. 在质量题库中选择模型和题目，手动运行检测并查看回答与评估结果。

检测目标默认只用于手动运行；加入监测范围的开关不影响业务请求。

插件会优先通过以下方式发现本机网关：

- `MAGPIE_ADDR` 环境变量；
- `$XDG_CONFIG_HOME/magpie/settings.json` 中的监听端口；
- 默认地址 `http://127.0.0.1:3425`。

发现通过回环地址访问网关，并用 Key `magpie` 请求 `/v1/models` 验证连接。`0.0.0.0:端口`、`[::]:端口` 和 `:端口` 会转换为对应的本机地址。启动时在后台发现，不阻塞 Magpie 初始化；网关尚未就绪时每 5 秒重试。远程地址或其他 Key 需要在控制台手动填写。已有配置不会被自动覆盖。

如果仍提示“请配置 Magpie 网关 URL 和 Key”，点击连接设置，填写 **Magpie 所在机器**可访问的网关地址，例如 `http://127.0.0.1:3425`，以及网关 Key（本机默认 `magpie`），再保存。它不是 Cloudflare 控制台域名，也不是上游供应商地址。Docker 中网关不在同一容器时，请填写容器可访问的实际地址与 Key。

控制台提供模型监测、质量题库、模型指纹和检测记录四个视图；支持暗亮主题、手机操作、记录筛选、历史指纹批次和原始回答下载。自动刷新会保留未保存的设置与已展开的回答。

只需要填写 Magpie 网关的 URL 和 Key，不需要重复填写各上游供应商凭据。

## 远程控制台

选择“打开临时远程控制台（Cloudflare）”后，插件会启动 Cloudflare Quick Tunnel，把本机管理页面临时暴露为 HTTPS 地址：

- 一次性 `/open/...` 链接有效 10 分钟；
- 浏览器会话最长 30 分钟；
- 临时通道最长 30 分钟，也可以在页面中提前结束；
- 关闭通道会撤销远程会话，但不会停止检测后台；
- 只开放管理页面，不开放 Magpie 模型 API，网关 Key 不返回浏览器。

插件优先使用 PATH 中已有的官方 `cloudflared`。找不到时，默认下载并校验固定版本 `2026.10.0`，缓存到数据目录的 `runtime/`，不需要 root，也不会修改系统 PATH。自动下载需要访问 GitHub 发行文件和 Cloudflare 隧道服务；可通过 `cloudflaredPath` 指定已有客户端，或关闭自动下载。

远程入口会先等待公网 `/health` 就绪，最长 60 秒，再返回管理链接。
如果出现 `502`，本轮就绪检查失败会关闭通道；检查网络后从插件重新打开。
管理链接从外部页面打开时，使用 `HttpOnly`、`SameSite=Lax` 会话 Cookie 完成重定向；
会话过期后需要从插件取得新链接。

不要只打开临时域名首页，必须使用插件返回的完整 `/open/...` 链接。不要把管理端口直接绑定到公网。

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

其他题目会保存原始回答和 token 用量，在质量题库页面直接展示，也可选择历史回答、复制或下载。失败与截断会显示原因，并保留已返回的回答正文。用户可保存“待确认 / 确认通过 / 标记问题”与审核备注；结论记录在对应回答上，不更改自动评分或模型调用。自动辅助检查展示字符数、逐字复述覆盖率或代码标记等可验证线索，不识别模型身份，也不替代人工审核。后台不会执行模型生成的 HTML、SVG 或 Python。

### 预算与超时

- 默认每个模型每天最多 120 次请求，可在控制台设置为 1–10000；
- `milk` 异常时独立复测一次，两次调用分别保存记录；
- 单次请求 `max_tokens` 为 8192；
- 单轮总超时为 180 秒；
- 网关调用失败、超时、空回答、截断、无效响应或预算耗尽会标记为“检测不可用”；
- 传输失败与取消不自动复测。

这些题目只是行为与能力线索，不是模型身份认证、供应商认证或通用智商排名。单题失败不能证明模型被替换；知识题有时效性，复述指纹也可能随版本变化。

### 题库反馈与更新

质量测试支持流式正文（网关返回普通 JSON 时仍兼容）、等待时间和取消；取消或连接中断保留已返回正文，生成中不会执行预览。HTML 可切换代码块、选择手机/平板/桌面宽度、页内放大，并可选择明确标注的 HTML + CSS/JS 组合结果；原始回答不修改。离开题库会停止预览。历史支持题目、模型、结果、审核状态筛选，双回答对比与筛选结果 JSON 导出。清理需确认，检测期间不可清理；只移除回答与审核，保留已消耗预算计数，不影响模型调用。

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

控制台提供独立的 **ModelTrace 模型指纹** 检测。选择已启用监测的模型，点击“运行三条指纹挑战”，后台通过同一 Magpie 网关发送三次独立数字选择请求。每条要求生成 292–332 个 1–355 范围内的整数。

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

检测目标列表展示模型和当日已用请求数；“监测”开关记录自动检测范围，当前版本的所有题目仍需手动触发。

可执行操作：

| 操作 | 作用 |
| --- | --- |
| 重新检测 | 立即运行默认题目，计入预算 |
| 关闭监测 | 关闭该目标的自动检测范围，不影响手动检测 |
| 删除检测目标 | 从列表移除并保留历史回答和审核；检测中不可删除 |

检测目标的状态和评估结果只写入检测记录，不控制业务请求，也不改变 Magpie 的供应商配置、API 地址或 Key。

## 插件选项

可以在 Magpie 插件配置中传入：

```json
{
  "dataDir": "/srv/dsh-intelligence-check/data",
  "gatewayURL": "http://127.0.0.1:3425",
  "gatewayKey": "magpie",
  "binaryPath": "/srv/dsh-intelligence-check/bin/quality-check",
  "cloudflaredPath": "/usr/local/bin/cloudflared",
  "autoInstallCloudflared": true
}
```

字段说明：

- `dataDir`：SQLite、检测记录和 Cloudflare 缓存目录。默认 `~/.config/dsh-intelligence-check`；
- `gatewayURL`、`gatewayKey`：用于首次自动连接配置，不覆盖控制台已有设置；
- `binaryPath`：指定 Go 后台二进制；
- `cloudflaredPath`：指定官方 `cloudflared`；
- `autoInstallCloudflared`：设为 `false` 时禁止自动下载 Cloudflare 客户端。

数据目录会以私有权限创建，SQLite 中保存网关凭据、历史结果和检测目标。停用、退出或重启不会清除数据；卸载插件也不会自动删除数据目录，请按需手动备份或清理。

同一个 `dataDir` 只允许一个检测后台运行。多个 Magpie 实例必须使用独立的插件目录和 `dataDir`。

## 限制与兼容性

- 当前适配仍依赖 Magpie 的插件系统；DSH 原生插件接入由后续迁移票实现；
- 检测结果不参与业务请求放行、拒绝、暂停或模型切换；
- 网关 Key 需要有权限调用 `/v1/models` 和 `/v1/chat/completions`；
- 检测使用非流式或流式 Chat Completions，由 Magpie 负责上游协议转换；
- 发行脚本生成 Linux、macOS 和 Windows 的交叉编译包，实际部署仍需检查网络、文件权限和 Magpie 版本；
- Cloudflare Quick Tunnel 是临时通道，不保证公网可用性或稳定性。

## 开发与验收

运行 Go 测试和插件测试：

```sh
go test -race ./...
go vet ./...
node --test plugin/*.test.mjs
```

构建发行包和校验清单：

```sh
node scripts/build-release.mjs
node scripts/package-check.mjs
```

可选的集成检查：

```sh
MAGPIE_BINARY=/absolute/path/to/magpie MAGPIE_BUN=/absolute/path/to/bun node scripts/gateway-integration.mjs
MAGPIE_BINARY=/absolute/path/to/magpie node scripts/install-check.mjs
node scripts/plugin-check.mjs
node scripts/cloudflare-check.mjs
node scripts/browser-check.mjs
node scripts/auth-browser-check.mjs
```

其中：

- `gateway-integration.mjs` 验证真实 Magpie 管理页面加载完整插件后自动发现、验证并保存网关；需要 Node.js 24，`MAGPIE_BUN` 指向已有 Bun，测试使用独立的临时配置；
- `install-check.mjs` 验证发行包解压、插件注册和宿主退出清理；
- `cloudflare-check.mjs` 验证临时 HTTPS 入口、会话交换和关闭；
- `browser-check.mjs` 需要 Playwright，可通过 `PLAYWRIGHT_MODULE` 指定模块位置。
- `auth-browser-check.mjs` 使用真实浏览器验证从外部页面打开管理链接、票据重定向和会话刷新。

运行时检测链路的 Go 测试使用受控模型响应，覆盖手动 milk、评分、独立复测、预算、取消、记录持久化和传输边界；不依赖业务请求被拦截。

## 目录结构

```text
cmd/quality-check/       Go 后台入口
internal/check/          状态、检测传输边界、HTTP 控制台和存储
internal/check/web/      嵌入 Go 二进制的管理页面
plugin/index.mjs         Magpie 插件入口
plugin/cloudflared-runtime.mjs  Cloudflare 客户端发现、下载和校验
scripts/                 构建、集成和客户端验收脚本
third_party/cloudflared/ Cloudflare 客户端许可文件
```

## 许可

本项目采用 MIT License。Cloudflare 客户端相关许可随包保留在 `third_party/cloudflared/LICENSE`；ModelTrace 许可保留在 `third_party/modeltrace/LICENSE`。
页面内置 Space Grotesk、Space Mono 字体和 Lucide 图标，无需运行时 CDN；许可分别保留在 `third_party/fonts/` 和 `third_party/lucide/LICENSE`。
