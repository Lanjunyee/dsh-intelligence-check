---
name: 模型质量检测
description: DSH 插件内“模型质量检测”工作页的 Code 风格视觉设计系统
colors:
  paper: "var(--dsw-alias-bg-base)"
  panel: "color-mix(in srgb, var(--dsw-alias-label-primary) 2.5%, var(--dsw-alias-bg-base))"
  surface: "color-mix(in srgb, var(--dsw-alias-label-primary) 4%, var(--dsw-alias-bg-base))"
  hover: "color-mix(in srgb, var(--dsw-alias-label-primary) 6%, var(--dsw-alias-bg-base))"
  selected: "color-mix(in srgb, var(--dsw-alias-label-primary) 9%, var(--dsw-alias-bg-base))"
  border: "color-mix(in srgb, var(--dsw-alias-label-primary) 12%, var(--dsw-alias-bg-base))"
  border-soft: "color-mix(in srgb, var(--dsw-alias-label-primary) 7.5%, var(--dsw-alias-bg-base))"
  ink: "var(--dsw-alias-label-primary)"
  ink-secondary: "var(--dsw-alias-label-secondary)"
  ink-muted: "color-mix(in srgb, var(--dsw-alias-label-primary) 64%, var(--dsw-alias-bg-base))"
  focus: "var(--dsw-alias-label-primary)"
  success: "color-mix(in srgb, var(--dsw-alias-state-success-primary) 55%, var(--dsw-alias-label-primary))"
  error: "color-mix(in srgb, var(--dsw-alias-state-error-primary) 62%, var(--dsw-alias-label-primary))"
  warning: "color-mix(in srgb, var(--dsw-alias-state-warn-primary) 62%, var(--dsw-alias-label-primary))"
typography:
  page-title:
    fontFamily: "var(--dsw-font-family)"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
  section-title:
    fontFamily: "var(--dsw-font-family)"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.45
  subheading:
    fontFamily: "var(--dsw-font-family)"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.5
  modal-title:
    fontFamily: "var(--dsw-font-family)"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.45
  body:
    fontFamily: "var(--dsw-font-family)"
    fontSize: "13px"
  answer:
    fontFamily: "var(--dsw-font-family)"
    fontSize: "15px"
    lineHeight: 1.75
  label:
    fontFamily: "var(--dsw-font-family)"
    fontSize: "13px"
  hint:
    fontFamily: "var(--dsw-font-family)"
    fontSize: "12px"
    lineHeight: 1.65
  micro:
    fontFamily: "var(--dsw-font-family)"
    fontSize: "11px"
    lineHeight: 1.5
  code:
    fontFamily: "var(--ds-font-family-code)"
    fontSize: "13px"
    lineHeight: 1.7
rounded:
  segment: "2px"
  option: "7px"
  corner: "8px"
  control: "9px"
  panel: "10px"
  container: "12px"
  composer: "14px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  2xl: "14px"
  3xl: "16px"
  4xl: "20px"
  5xl: "24px"
  6xl: "28px"
  7xl: "32px"
  8xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "38px"
  button-primary-hover:
    backgroundColor: "color-mix(in srgb, var(--dsw-alias-label-primary) 86%, var(--dsw-alias-bg-base))"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "38px"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.control}"
    size: "38px"
  menu-trigger:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "6px 10px"
    height: "40px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
    height: "40px"
  tab:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.corner}"
    padding: "0 10px"
    height: "32px"
  tab-selected:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.ink}"
  composer:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.composer}"
    padding: "10px 12px 8px"
  status:
    textColor: "{colors.ink-secondary}"
---

# 设计系统：模型质量检测

## Overview

**Creative North Star: “宿主工作台”**

这个界面不是一张独立的品牌页面，而是 DSH 宿主里的一张工作台：纸张色底、极浅的面板与细边界、低对比的次级文字，以及唯一一处深色反转的主操作。它借用本机 Claude Desktop Code 界面的中性灰阶语言，让插件看起来像宿主自带的工具，而不是嵌入进来的另一套产品。

视觉重心从旧版的“绿色检测答卷”转到“居中的回答阅读列 + 底部 Code 形操作区”。质量题库只保留一条 760px 的阅读列，模型与题目收进底部操作区；监测、指纹与记录页则使用 1040px 的内容区放置表格与分组。层级依赖字重、留白、底色差（文字色的 2.5%–12% 混合）与 1px/0.5px 边界，而不是卡片堆叠、彩色强调或投影。

所有颜色、字体、圆角与浮层都从宿主语义变量派生，浅色与深色主题随宿主自动切换；界面不维护第二套主题色。

**Key Characteristics:**
- 中性灰阶，没有独立强调色；唯一的高对比是一个深色实心主操作。
- 宿主 sans 承担界面与自然语言回答；等宽字体只用于代码、计数、ID 与概率。
- 紧凑标题（14/15px）、32px 页签、38/40px 控件，层级靠留白与字重。
- 质量题库是 760px 居中阅读列加底部 Code 形操作区；管理页是 1040px 内容区。
- 平面为主；阴影只属于菜单、模态框与展开预览。

## Colors

一套由宿主文字色叠在宿主底色上生成的中性灰阶；页面底色始终是宿主纸张色，层级靠 2.5%–12% 的文字色覆盖度建立。

### Primary

本系统没有独立强调色。主操作采用最深文字色作底、页面底色作字（`var(--dsw-alias-label-primary)` / `var(--dsw-alias-bg-base)`），因此“强调”来自对比反转，而不是第二个色相。

### Neutral
- **纸张底**（`var(--dsw-alias-bg-base)`）：页面、质量题库阅读区、主操作文字色。
- **面板**（文字色 2.5%）：顶部概览、设置弹窗、菜单浮层底色。
- **抬高面**（文字色 4%）：底部操作区、状态区、归因控制区、记录正文块。
- **悬停面**（文字色 6%）：按钮、页签、菜单项与记录行的悬停底色。
- **选中面**（文字色 9%）：当前页签、菜单选中项、文本选区。
- **边界**（文字色 12%）：输入框、菜单触发器、按钮、浮层外框。
- **柔边界**（文字色 7.5%）：表格分隔线、折叠行、预览外框、分组线。
- **主文字 / 次文字**（`var(--dsw-alias-label-primary)` / `var(--dsw-alias-label-secondary)`）：正文与元信息。
- **弱化文字**（文字色 64%）：占位符、字段标签、空状态说明、计数。

### Status
- **成功**（宿主 success 55% + 主文字）：连接正常、检测通过、评审通过、记录结果与评审状态文字。
- **错误**（宿主 error 62% + 主文字）：连接中断、检测失败、清理按钮、错误横幅。
- **警告**（宿主 warn 62% + 主文字）：截断、运行中、空回答、后台健康异常。

**宿主派生规则。** 不引入新的色相或第二套主题色；除预览画布必须的 `#fff` 外，不写死十六进制。所有界面颜色必须由 `--dsw-alias-label-primary`、`--dsw-alias-label-secondary` 与 `--dsw-alias-bg-base` 混合；状态文字使用宿主 success/error/warn 语义色的 55%/62% 混合，6px 状态点与失败分段直接使用宿主状态色。

**单点高对比规则。** 同一视图只允许一个深色实心主操作（质量题库的“运行”、设置的“保存设置”、指纹页的“运行三条指纹挑战”）。其余操作一律透明底加 1px 边界；不要把多个按钮做成同等视觉权重。

## Typography

**Display Font:** 无独立展示字体，沿用宿主界面字体
**Body Font:** DSH 宿主无衬线字体（`var(--dsw-font-family)`）
**Label/Mono Font:** 宿主等宽字体（`var(--ds-font-family-code)`）

**Character:** 一套宿主 sans 同时承担界面与自然语言回答，字号克制在 11–16px；等宽只在代码、计数、模型 ID 与概率这些需要保真或对齐的位置出现。

### Hierarchy
- **页面标题**（600，14px，1.4）：顶栏产品名“模型质量检测”。
- **区块标题**（600，15px，1.45）：回答标题、ModelTrace、检测记录、空状态标题。
- **小节标题**（600，13px，1.5）：记录内的“原始回答”“提示词原文”、设置分组标题。
- **正文**（400，13px）：通用界面文本、字段值、菜单项、表格内容。
- **回答正文**（400，15px，1.75）：自然语言回答、对比卡与记录展开正文。
- **标签**（400，13px）：字段名、题目名、设置行标签。
- **提示**（400，12px，1.65）：说明、元信息、时间、错误原因、免责声明。
- **微型标签**（400，11px，1.5）：页签计数、表格列名、概览标签、菜单说明。
- **代码**（400，13px，1.7，等宽）：原始提示词、预览代码与代码回答统一使用这一档。

**紧凑标题规则。** 标题最大只到弹窗的 16px；页面标题 14px、区标题 15px、小节 13px。不要用 display 级字号制造层级，层级由字重、间距与容器边界承担。

**等宽专用规则。** 等宽字体只用于代码、计数、模型 ID、概率、字节与 token 数；自然语言回答与界面说明绝不用等宽。

**统一代码排版规则。** 普通代码内容与代码回答共用 13px/1.7 的宿主等宽体，不再维护“代码 12px、代码回答 13px”的两档旧约定。

## Layout

顶栏是一行三列网格：左侧品牌与连接状态、中间四个页签、右侧刷新与设置。顶栏内边距 10px 20px 8px，页签间距 2px；页签本体 32px 高、左右 10px 内边距、8px 圆角。

质量题库是纵向满高布局：`.dic-conversation` 独立滚动，阅读列与底部操作区都以 760px 为上限居中。阅读列内边距 28px 20px 32px、行间距 14px；底部操作区是 flex 流中的固定行，不覆盖正文，外层 8px 20px 14px，内层 10px 12px 8px、14px 圆角、4% 文字色抬高面。操作区字段为 1.25fr / 1fr 两列，运行按钮 36px 高、8px 圆角。

监测、指纹与记录页使用 `.dic-section`：最大 1040px、居中、20px 行间距、28px 0 40px 内边距。概览条是 `auto-fit minmax(150px, 1fr)` 的一体化面板，组与组之间用 1px 柔边界分隔；监测目标表与归因候选表各在自己的滚动容器内横向滚动。

容器查询以 `.dic-page` 的 inline-size 为基准，而不是视口宽度；实际验证覆盖 1440px 桌面、390px 移动、1280×600 与 390×560 低高度，以及各断点两侧（861/860、741/739、481/479）。

- **≤860px**：顶栏改为两行，品牌与操作在第一行、页签在第二行并左对齐；检测记录从六列摘要切换为卡片摘要（时间为左上，结果与评审靠右，模型独占一行，题目与用量在末行），并显示“评审：”前缀。
- **≤740px**：阅读列与操作区收窄内边距；评审字段、归因报告、回答对比、记录对比选择器改为单列；历史筛选四列变两列并让导出/清理等宽铺满；归因操作区改单列；候选行由三列变两列、进度条移到名称下方；表格启用 640px（候选）/720px（监测目标）的最小宽度。
- **≤560px**：底部操作区两个菜单改单列，运行按钮占满整行；监测页添加目标表单改单列；概览条改两列，最后一项跨两列；设置行改单列。
- **≤480px**：页签间距归零、左右内边距收到 7px、字号 12px，并隐藏页签装饰图标，四个入口仍同屏可读。
- **≤420px**：顶栏、阅读列与操作区进一步收紧；操作区圆角降为 12px；回答工具栏占满整行；空状态降低最小高度；菜单浮层宽度收到 320px。

**阅读列规则。** 质量题库的回答与底部操作区共用 760px 上限并居中；只有监测、指纹、记录这类管理内容才使用 1040px。不要把管理表格的宽度带进阅读列。

**操作区不覆盖规则。** 底部操作区是布局中的一行，不是浮层；长回答只在中部阅读区滚动，评审表单、菜单与预览不得被它遮挡。

## Elevation & Depth

系统默认平面。静态层级由纸张底、2.5%/4% 抬高面、6%/9% 状态面以及 12%/7.5% 边界表达，没有常驻阴影。

### Shadow Vocabulary
- **菜单浮层**（`var(--dsw-elevation-prominent)`）：模型、题目与批次菜单向上展开时使用。
- **模态框**（`var(--dsw-elevation-prominent)`）：检测设置弹窗。
- **展开预览**（`var(--dsw-elevation-prominent)`）：固定的预览画布。
- **遮罩**（`var(--dsw-alias-bg-mask-2)`）：模态框背景。

**浮层专属规则。** 阴影只用于真正离开文档流的浮层：菜单、模态框、固定预览。静态分区、卡片、表格与底部操作区一律不加阴影；需要区分层级时先用抬高面与柔边界。

## Shapes

控件圆角停在 7–10px：菜单选项 7px，页签、横幅与代码块 8px，按钮、输入框、菜单触发器 9px，概览与状态卡 10px。容器用 12px（窄屏操作区）与 14px（底部操作区、模态框）；只有开关轨道与状态点是全圆角。

边界以 1px 实线为主，表格行与折叠行使用 0.5px 柔边界；页签选中态是 9% 文字色的圆角底，不再使用旧版的 2px 下划线。滚动条为细轨道，滑块使用 12% 边界色。折叠 disclosure 是 6px 的 1.5px 边框小箭头，展开时旋转 45°；进度分段是 6px 高、2px 圆角的短条。

**小圆角规则。** 控件保持在 7–10px；12/14px 只留给底部操作区与模态框；不要给按钮做胶囊形，也不要给静态区块加 16px 以上的大圆角。胶囊只属于开关轨道与状态点。

## Components

### Buttons
- **Shape:** 38px 最小高度，9px 圆角，8px 12px 内边距，图标与文字间距 6px。
- **Primary:** 主文字色实心底、纸张色文字，用于每屏唯一的主操作；悬停时为 86% 主文字色 + 14% 纸张色。
- **Secondary:** 透明底、1px 边界、主文字色；悬停转 6% 文字色面。
- **Icon-only:** 38×38px，透明底；顶栏、回答工具栏与表格行内使用 32–34px 的透明变体，必须带 `aria-label`。
- **Danger:** 错误色文字与错误色 42% 混合的描边，只用于“清理筛选记录”这类不可逆操作。
- **Disabled:** 透明度 0.4，光标恢复默认。
- **Focus:** 2px 实线 `--dic-focus`，外扩 2px。

### Tabs
四个工作页签常驻顶栏中部，32px 最小高度、8px 圆角、2px 间距。默认次文字色；选中态为 9% 文字色底、主文字色、字重 500。页签计数紧随文字，11px 等宽、弱化文字色。≤480px 隐藏页签图标、间距归零、左右内边距 7px、字号 12px，保留全部四个文字入口，不把入口藏进菜单。

### Menus
模型、题目与批次选择使用向上展开的菜单。触发器 40px 高、9px 圆角、1px 边界、纸张色底，左侧 11px 弱化说明（“模型”“题目”）、右侧 13px 当前值，长名称单行省略。浮层宽 `min(340px, 100vw - 32px)`、最大高 `min(430px, 60vh)`、10px 圆角、面板色底与宿主抬升阴影，距触发器 6px；选项 7px 圆角、7px 10px 内边距，选中项用 9% 文字色底。≤420px 浮层宽 320px。

### Inputs / Fields
输入框、选择器与菜单触发器同为 40px 高、9px 圆角、1px 边界、纸张色底。字段标签 12px 弱化文字，与控件间距 6px；占位符用弱化文字色。设置弹窗中的数值输入使用 4% 抬高面、无描边，原生复选框以主文字色作为 accent-color。焦点统一为 2px 主文字色轮廓、外扩 2px。

### Detector Composer（signature）
底部操作区复刻 Code 输入区的外形：整块 14px 圆角、4% 抬高面、1px 边界，内部左侧“模型”菜单、右侧“题目”菜单，底行左侧 11px 运行说明；右侧在运行中出现独立的“取消”按钮，主操作始终保持原位并显示“正在检测…”。运行按钮 36px 高、8px 圆角；无检测目标时主操作改为“添加检测目标”并切到监测页。菜单浮层向上展开，短视口内自身滚动；≤560px 两个菜单单列、运行整行；≤420px 圆角 12px。操作区不接收自由文本，不遮挡阅读列。

### Status & Feedback
记录与结果状态使用 11px/500 的文字而非胶囊底色（指纹批次状态为 12px/600），颜色与文字同时表达：通过＝成功色，失败/不可用＝错误色，运行中/截断/空回答＝警告色，取消/待评审＝次文字色。页面级错误横幅用错误色 7% 底、错误色文字；警告横幅用警告色 8% 底；成功反馈 4 秒后自动消退，错误反馈保留到下一次操作。连接状态是 6px 圆点加文字：正常宿主 success，连接中与服务异常宿主 warn，中断宿主 error。

**状态双通道规则。** 任何状态都不能只靠颜色表达；颜色旁必须有“通过/失败/已取消/截断/待人工评价”等可见文字。

### Overview Panel
监测页顶部概览是一块 10px 圆角、面板色底、柔边界外框的一体化面板；内部按 `auto-fit minmax(150px, 1fr)` 分组，每组 66px 最小高度、11px 14px 内边距、组间 1px 柔边界。标签 11px 弱化、数值 14px/500 主文字，说明 11px 弱化。≤560px 改两列，最后一项跨两列。

### Tables & History
表格铺满内容区，表头 11px 弱化文字、下边 1px 柔边界，单元格 12px 内边距、行间 0.5px 柔边界。监测目标表列宽 15% / 37% / 17% / 16% / 15%，模型名换行不截断；需要横向空间的表格在自身滚动容器内滚动，容器查询 ≤740px 时目标表最小 720px、候选表最小 640px。

检测记录在宽内容区是六列摘要：时间 118px、模型自适应、题目 136px、结果 92px、评审 108–136px、用量 82px，行高 42px，行末有 6px disclosure 箭头，展开旋转 45°。模型列单行省略并提供完整 `title`；人工评审始终显示文字。≤860px 改为卡片摘要并隐藏列头。展开正文中，自然语言回答 15px/1.75，代码回答 13px/1.7 等宽，正文最大高 420px 并在自身容器内滚动；提示词与预览代码同为 13px/1.7。

### Comparison
回答对比在宽内容区是两张等宽卡片，选择器与卡片都在 ≤740px 改单列。卡片头部为模型名与状态，元信息用 12px 提示文字，正文按自然语言/代码分别排版；选择项按“秒级时间 / 模型 / 题目 / 结果”排列，ModelTrace 的多次挑战在题目后附“挑战 N”。

### Settings Dialog
设置弹窗宽 `min(560px, 100%)`（通用模态底为 520px）、20px 内边距、14px 圆角、面板色底与宿主抬升阴影，遮罩使用宿主 mask。标题 16px/600；分组标题 13px/600，组间 1px 柔边界；设置行是“说明 + 控件”两列，≤560px 单列。开关轨道 30×18px、全圆角，开启时主文字色轨道、纸张色圆点。Escape、关闭按钮、焦点返回与草稿保留行为不变。

### Model Attribution
指纹页依次为操作区、批次状态区与归因结果。操作区与状态区都是 14px 内边距、10px 圆角、4% 抬高面；三段进度条 6px 高、2px 圆角，完成用主文字色、失败用宿主错误色、取消用次文字色。归因结果的最相似候选 16px/600，概率 14px 等宽；候选相似度三列（名称 / 160px 条 / 64px 百分比），≤740px 改两列并把进度条移到名称下方。限制说明是区块末尾的 12px 可见脚注。

### Preview
HTML/SVG 预览使用白色画布（`#fff`）与 1px 柔边界、8px 圆角，图片固定 340px 高并居中留白；内嵌 iframe 440px 高。展开预览固定在视口内、14px 内边距、宿主大圆角与抬升阴影。白色只属于预览画布，不进入界面底色。

## Do's and Don'ts

### Do:
- **Do** 从宿主语义变量派生所有颜色；浅色与深色只维护一套混合公式。
- **Do** 每屏只保留一个深色实心主操作，其余操作使用透明底加 1px 边界。
- **Do** 保持 32px 页签、38px 按钮、40px 输入与菜单触发器的高度节奏。
- **Do** 让质量题库的阅读列与底部操作区共用 760px 上限，管理页使用 1040px。
- **Do** 让键盘焦点始终可见：2px 主文字色轮廓、外扩 2px。
- **Do** 用 160ms ease-out 表达悬停、选中、开关与 disclosure，并在 reduced-motion 下全部取消。
- **Do** 状态同时给出颜色与文字，表格只在自身容器内横向滚动。

### Don't:
- **Don't** 恢复旧版的绿色强调色、浅绿配置区或 264px 两栏工作区。
- **Don't** 引入第二个色相、第二套主题色或新的 Web Font。
- **Don't** 给静态区块、表格或底部操作区加阴影；抬升只属于菜单、模态框与展开预览。
- **Don't** 用 display 级大标题或 22px 页面标题；标题上限是弹窗的 16px。
- **Don't** 用等宽字体排自然语言回答，或把代码回答单独降回 12px。
- **Don't** 把页签选中态做成 2px 下划线；它是 9% 文字色的圆角底。
- **Don't** 用颜色作为状态的唯一载体，或给图标按钮省略可访问名称。
