# Issue tracker：GitHub

任务和规格保存在 `Lanjunyee/dsh-intelligence-check` 的 GitHub Issues，使用 `gh` 操作，显式指定 `--repo Lanjunyee/dsh-intelligence-check`。

## 操作约定

- 发布任务或规格：创建 GitHub issue。
- 获取任务：用 `gh issue view` 读取正文、标签和评论。
- 查找任务：用 `gh issue list`，按状态和标签筛选。
- 多行正文或评论：写入临时文件，通过 `--body-file` 提交。
- 父子任务：使用 GitHub 原生 sub-issues；不可用时，在子任务顶部写 `Part of #<父任务编号>`，并在父任务维护任务列表。
- 阻塞关系：使用 GitHub 原生 issue dependencies；不可用时，在被阻塞任务顶部写 `Blocked by: #<编号>`。所有阻塞任务关闭后才可开始。
- 关闭任务：先评论说明结果，再关闭 issue。
- 首次写入前核实目标仓库；当前保留的原项目 upstream 不作为任务发布目标。

## Pull requests as a triage surface

**PRs as a request surface: no.**
