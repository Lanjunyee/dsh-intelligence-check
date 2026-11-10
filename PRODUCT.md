# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

DSH 插件使用者。首要任务是选择模型、选择测试题、运行检测并查看回答。

## Product Purpose

主动执行模型质量检测，保存原始回答、自动评估与人工评审，帮助使用者观察模型表现。

## Operating Context

主要入口是 DSH 全局侧边栏中的“模型质量检测”，界面在宿主主区域运行，复用宿主模型目录、凭据与主题。同一用户、同一台机器共享后台与检测状态。

## Capabilities and Constraints

保留模型监测、质量题库、模型归因、历史筛选、回答比较、人工评审、导出与 HTML/SVG 预览。自动检测默认关闭，手动检测不要求开启监测。检测结果不拦截业务请求。原始提示词、回答和检测规则保持真实且完整；模型归因只表示行为相似性。

## Product Principles

- 优先缩短选择模型、选择题目、阅读回答的路径。
- 清楚区分手动检测与自动监测。
- 保留原始回答，并区分自动评估与人工评审。
- 遵循宿主的导航、主题和布局约定。

## Evidence on Hand

产品功能与领域约束见 README.md、GLOSSARY.md 及 docs/adr/0002-desktop-panel-and-shared-check-state.md。现有界面源码为 plugin/client-panel.js，生成入口为 plugin/client.js。
