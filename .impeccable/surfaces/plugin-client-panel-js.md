---
version: 1
slug: "plugin-client-panel-js"
primary_target: "plugin/client-panel.js"
related_targets: ["plugin/client.js"]
---

# 原生检测工作页

## Scope

目标：plugin/client-panel.js 及生成的 plugin/client.js。Mode: Operate。主要用户任务：选择模型、选择题目、运行检测、阅读回答、预览与人工评审。保留全部功能、数据接口、提示词与检测规则。

## Direction contract

THESIS: 将手动测试作为默认入口。题目直接可见，回答优先，预算与自动监测不占据正文上方的大块空间。

OWN-WORLD: 借鉴答卷的清晰层级。宿主 sans 字体，浅绿色工作区、白色阅读区、深绿色操作和选择态；暗色主题沿用宿主语义色并降低绿色底色亮度。标准按钮、select、题目单选组和功能 tabs。

STORY: 打开质量题库，左侧选择已添加的模型及测试题，运行后右侧查看流式原始回答；回答下方完成辅助检查与人工评审。首次使用可直接跳到添加检测目标。

FIRST VIEWPORT: 顶部紧凑产品标题、连接状态和设置入口；下方四个 tabs。主工作区左侧约 270px，包含模型选择、七道题目和运行按钮；右侧自适应宽度，包含回答标题、记录选择、复制下载及正文。签名交互是题目选中行与当前回答标题同步，切换记录保持阅读区结构稳定。操作反馈以 160ms 状态转换呈现，尊重 reduced-motion。

FORM: 检测工作页，候选序号 3，用户已在可视化选择页选定 worksheet；seed:649c828e58e5be8e。固定参考草图：.impeccable/mocks/decision/worksheet.html。其余候选依次为阅读批注、送审稿、检测答卷、公共导览、图书目录、实验报告、连续影像；仅借鉴字体、色彩、密度和一个状态交互，布局使用标准产品模式。代码优先，无批准的图像 comp。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Responsive and states

在主内容可用宽度不足时改为上下排列；题目列表缩成常规选择器以免先滚过全部题目才能看到回答。回答空状态、运行中、失败、截断、无目标、长模型名与长正文均要可操作。预算信息移至模型监测页，手动测试提示监测可关闭。
