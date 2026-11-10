# Issue tracker：本地 Markdown

需要拆分、分派或持续跟踪的开发工作，使用本仓库 `.scratch/` 中的任务和规格记录。

范围明确的直接修改，以及提交、推送、打包、发布等操作，直接执行并复用已有记录。

## 文件约定

- 每个功能一个目录：`.scratch/<feature>/`。
- 规格：`.scratch/<feature>/spec.md`。
- 实现任务：`.scratch/<feature>/issues/<NN>-<slug>.md`，每个任务一个文件；同一功能内从 `01` 连续编号。
- `State:` 记录开闭状态：`open` 或 `closed`。
- `Status:` 记录 triage 角色，取值见 `triage-labels.md`。
- `Labels:` 保留原始标签和其他标签；分类时同步更新其中的 triage 标签。
- 评论追加在文件底部的 `## Comments` 下，注明作者和时间。
- 父子任务用 `Part of:`、`Sub-issues:` 记录；阻塞关系用 `Blocked by:`、`Blocking:` 记录，均使用本地文件链接。
- 所有 `Blocked by:` 指向的任务关闭后才可开始。
- 关闭任务前，追加结果说明，再将 `State:` 改为 `closed`。

## 历史 GitHub Issues

- 导入记录与编号索引：`.scratch/github-import/README.md`。
- 历史任务：`.scratch/github-import/issues/<NN>-github-issue.md`。
- 原正文、评论中的 `#N` 指向上述索引内的原 GitHub 编号。
- 保留原始标签；缺少 triage 标签时，初始 `Status:` 为 `needs-triage`。
- GitHub 作为历史来源，后续任务更新写入本地文件。

## 操作方式

发布任务时创建文件；获取任务时读取文件；查找时按 `State:`、`Status:` 和 `Labels:` 筛选。
引用新任务时使用文件路径。
