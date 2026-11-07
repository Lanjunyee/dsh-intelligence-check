---
name: 模型质量检测
description: DSH 插件内“检测工作页”的视觉设计系统
colors:
  accent: "color-mix(in srgb, var(--dsw-alias-label-primary) 70%, #18835f)"
  paper: "var(--dsw-alias-bg-base)"
  ground: "color-mix(in srgb, var(--dic-accent) 5%, var(--dic-paper))"
  selected: "color-mix(in srgb, var(--dic-accent) 11%, var(--dic-paper))"
  border: "color-mix(in srgb, var(--dic-accent) 16%, var(--dic-paper))"
  muted: "color-mix(in srgb, var(--dsw-alias-label-primary) 66%, var(--dic-ground))"
  ink: "var(--dsw-alias-label-primary)"
  ink-secondary: "var(--dsw-alias-label-secondary)"
  layer-1: "var(--dsw-alias-bg-layer-1)"
  layer-2: "var(--dsw-alias-bg-layer-2)"
  success: "color-mix(in srgb, var(--dsw-alias-state-success-primary) 40%, var(--dsw-alias-label-primary))"
  error: "color-mix(in srgb, var(--dsw-alias-state-error-primary) 55%, var(--dsw-alias-label-primary))"
  warning: "color-mix(in srgb, var(--dsw-alias-state-warn-primary) 40%, var(--dsw-alias-label-primary))"
typography:
  page-title:
    fontFamily: "var(--dsw-font-family)"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.35
  section-title:
    fontFamily: "var(--dsw-font-family)"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "var(--dsw-font-family)"
    fontSize: "14px"
  answer:
    fontFamily: "var(--dsw-font-family)"
    fontSize: "15px"
    lineHeight: 1.95
  label:
    fontFamily: "var(--dsw-font-family)"
    fontSize: "13px"
  hint:
    fontFamily: "var(--dsw-font-family)"
    fontSize: "12px"
    lineHeight: 1.7
  code:
    fontFamily: "var(--ds-font-family-code)"
    fontSize: "12px"
    lineHeight: 1.8
  code-answer:
    fontFamily: "var(--ds-font-family-code)"
    fontSize: "13px"
    lineHeight: 1.95
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "9px 14px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "color-mix(in srgb, var(--dic-accent) 88%, var(--dic-paper))"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    size: "40px"
  select:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "9px 11px"
    height: "40px"
  tab:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    rounded: "0"
    padding: "10px 0 13px"
    height: "44px"
  tab-selected:
    textColor: "{colors.accent}"
  question-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "10px"
    height: "46px"
  question-row-selected:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.accent}"
  workspace:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.lg}"
---

# 设计系统：模型质量检测

## Overview

**Creative North Star: “检测答卷”**

界面像一张正在填写的答卷：左侧是待选题目与模型，右侧是留白充足的回答阅读区；操作与选择用深绿标记，配置区以极浅的绿色灰度退后。整体服务于“选模型、选题目、运行、读回答”这条主线，不用装饰性图形分散注意力。

视觉密度中等偏低，层级依靠底色、边框和字重，而不是卡片堆叠或阴影。所有颜色、字体、圆角与浮层均取自 DSH 宿主语义变量或由 `color-mix` 派生，因此明暗主题随宿主自然切换。

**Key Characteristics:**
- 浅绿灰配置区、白色阅读区、深绿操作与选中态。
- 宿主无衬线字体承载正文，等宽字体只用于代码与计数。
- 标准控件尺寸（40px 控件、44px 标签页/摘要行），精确、克制。
- 平面为主，分层靠色调与细边框；浮层才使用宿主抬升。

## Colors

单一深绿强调色，配以宿主纸张色、两级中性灰与低饱和状态色。

### Primary
- **检测深绿**（`color-mix(in srgb, var(--dsw-alias-label-primary) 70%, #18835f)`）：主按钮、选中项文字与下划线、焦点环。它是唯一强调色。

### Neutral
- **纸张白**（`var(--dsw-alias-bg-base)`）：页面与阅读区底色、主按钮文字。
- **配置浅绿灰**（`color-mix(in srgb, var(--dic-accent) 5%, var(--dic-paper))`）：左侧配置区、概览条。
- **选中浅绿**（`color-mix(in srgb, var(--dic-accent) 11%, var(--dic-paper))`）：题目行选中与悬停。
- **边界绿灰**（`color-mix(in srgb, var(--dic-accent) 16%, var(--dic-paper))`）：输入框、工作区分隔线与标签页底线。
- **弱化文字**（`color-mix(in srgb, var(--dsw-alias-label-primary) 66%, var(--dic-ground))`）：提示、字段标签与次级说明。
- **主文字 / 次文字**（`var(--dsw-alias-label-primary)` / `var(--dsw-alias-label-secondary)`）：正文与元信息。
- **层一 / 层二**（`var(--dsw-alias-bg-layer-1)` / `var(--dsw-alias-bg-layer-2)`）：代码块、预览底与开关轨道。

### Status
- **成功 / 错误 / 警告**（分别由宿主 success、error、warn 语义色与主文字混合）：只表达连接、运行与校验状态，不参与装饰。

**宿主同源规则。** 不新增独立配色；除强调色中既有的 `#18835f` 绿色种子外，不写死十六进制。新增色必须由宿主语义变量经 `color-mix` 派生。

## Typography

**正文与标题：** DSH 宿主无衬线字体（`var(--dsw-font-family)`）
**代码与计数：** 宿主等宽字体（`var(--ds-font-family-code)`）

**Character:** 一套字体贯穿界面，靠字号、字重与行高建立层级；等宽字体只出现在代码、追踪计数等需要对齐的位置。

### Hierarchy
- **页面标题**（600，22px，1.35）：顶部产品名。
- **区块标题**（600，17px，1.5）：回答标题、空状态标题。
- **正文**（14px）：通用界面文本，字重和行高继承宿主。
- **回答正文**（400，15px，1.95）：右侧流式回答，长文优先，最大高度 560px 内滚动。
- **标签**（400，13px）：字段名、题目行。
- **提示**（400，12px，1.7）：说明、元信息与免责声明。
- **代码**（400，12px，1.8）：原始提示词、预览代码与计数等普通代码内容。
- **代码回答**（400，13px，1.95）：HTML、SVG 与世界海陆地图题目的原始回答；使用宿主等宽字体，并沿用回答正文的行高比例。与“代码”分开定义，不将两者统一。普通代码内容仍为 12px、1.8 行高。

**宿主字体规则。** 不引入 Web Font，不覆盖宿主字体栈；标题与正文的差异只通过字号和字重表达。

## Layout

页面内边距 28px/32px/40px，主工作区为两栏：左侧固定 264px 配置区，右侧自适应阅读区；整体最小高度 640px，外边一条 1px 边界绿灰线，12px 圆角包裹。配置区与阅读区分别内缩 22–28px。

内容节奏以 8/12/16/24px 为主：标签页下 24px，区块间距 18px，字段内 8px，按钮组 8–12px。顶部标题、连接状态与设置入口同排；四个标签页横向排列，底部 1px 分隔线。

响应式以容器查询为准：可用宽度 ≤740px 时改为上下排列，题目列表折叠为常规选择器，运行按钮移至整行；≤420px 时进一步单列、收紧内边距。页面外层在 ≤820px / ≤520px 时降低留白。

需要横向空间的表格在自身滚动容器内滚动：容器查询 ≤740px 时，640px 最小宽度只应用于带有局部滚动容器的表格（模型监测目标表与模型归因全部候选表），不得撑宽检测页面；无需滚动的候选表按可用宽度排版。

## Elevation & Depth

系统默认平面：没有常驻阴影，层级由白色阅读区、浅绿配置区、1px/0.5px 边框与选中底色表达。只有模态框与展开预览使用宿主抬升与遮罩，保持“浮层才是浮层”的语义。

### Shadow Vocabulary
- **浮层抬升**（`var(--dsw-elevation-prominent)`）：模态框与展开预览的固定层。
- **遮罩**（`var(--dsw-alias-bg-mask-2)`）：模态背景。

**平面分层规则。** 静态内容区不加阴影；需要区分层级时优先用 `ground`、`selected` 与边界绿灰，而不是投影。

## Shapes

控件与题目行使用 6px 圆角；概览条 8px；工作区外框 12px；开关为全圆角胶囊。标签页底部选中标记是 2px 直线，输入框与按钮为 1px 描边，分隔线为 1px 或 0.5px 的宿主边框色。

整体几何是“标准控件 + 一个柔和容器”：只有工作区外框使用 12px，内部保持小圆角，避免层层嵌套的卡片感。

## Components

### Buttons
- **Shape:** 6px 圆角，40px 最小高度，9px 14px 内边距。
- **Primary:** 检测深绿底、纸张白字；用于运行检测等唯一主操作。
- **Icon-only:** 40×40px，透明底、1px 边界绿灰描边，用于复制、下载等次级操作。
- **Hover / Focus:** 悬停时主按钮混入 88% 强调色并向纸张白靠拢，次级按钮使用宿主 hover 背景；键盘焦点统一为 2px 强调色轮廓、外扩 3px。
- **Disabled:** 透明度 0.45，光标恢复默认。

### Tabs
- 44px 最小高度，28px 间距，透明底，无圆角；默认次文字色，选中为强调色加 600 字重，并出现 2px 底部强调线。计数紧随标签，使用 11px 等宽次文字。

### Inputs / Fields
- 输入框与选择器同为 40px 高、6px 圆角、1px 边界绿灰、纸张白底，内边距 9px/11px。
- 字段标签为 13px 弱化文字，与控件间距 8px。
- 焦点使用统一强调色轮廓；占位文字使用弱化文字色。

### Question Row
- 46px 最小高度，10px 内边距，6px 圆角，整行可点击。
- 原生单选按钮视觉隐藏但保留键盘可达；选中行使用选中浅绿底、强调色文字与 600 字重；未选中行悬停同样转为选中浅绿。
- 背景与文字用 160ms ease-out 过渡，`prefers-reduced-motion` 下取消。

### Workspace
- 264px 配置区 + 自适应阅读区，12px 外圆角、1px 边界绿灰外框；配置区右侧 1px 分隔线，底部直角由圆角裁切承接。
- 阅读区依次为回答标题与工具、记录选择、正文、辅助检查与人工评审；空状态居中，最小高度 350px。

## Do's and Don'ts

### Do:
- **Do** 使用宿主语义变量与 `color-mix` 派生色；明暗主题不单独维护。
- **Do** 保持 40px 控件、44px 标签页/摘要行、46px 题目行的高度节奏。
- **Do** 用浅绿灰配置区、白色阅读区、深绿操作与选中态组织“先配置、后阅读”的层级。
- **Do** 让键盘焦点始终可见：2px 强调色轮廓、外扩 3px。
- **Do** 用 160ms ease-out 表达选中与悬停，并尊重 reduced-motion。

### Don't:
- **Don't** 写死十六进制色值（强调色既有的 `#18835f` 种子除外）或引入新的字体。
- **Don't** 为静态区块添加阴影；浮层抬升只用于模态框与展开预览。
- **Don't** 混用多套圆角；控件 6px、概览 8px、工作区 12px 之外不再扩展。
- **Don't** 用装饰图形、图像或图标集替代信息层级；图标只作操作提示。
- **Don't** 改变主操作与次级操作的色彩分工：深绿实心只给唯一主操作。
