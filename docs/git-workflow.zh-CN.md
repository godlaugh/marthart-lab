# MathArt Lab Git 管理说明

MathArt Lab 从当前 1.0 本地交付状态开始独立管理。源码保留在原来的 `studio/` 目录，应用路径不变。外层目录是 REA 的仓库，两个仓库拥有独立的提交历史。

在本项目内运行 Git 命令。可以用 `git rev-parse --show-toplevel` 确认当前仓库根目录，以免把提交放到外层 REA。

## 版本控制范围

- 纳入：应用源码、已有 2.0 保留实现、测试与 fixtures、开发和验证脚本、依赖锁文件、项目文档。
- 留在本机：依赖目录、编译结果、应用与压缩包、运行缓存、原始验收输出和参考软件分析产物。
- `docs/release-1.0-validation.zh-CN.md` 是验收时点的阅读版快照。后续代码变化需要相应验证；历史通过记录不会自动为新提交背书。

## 日常开发

初始提交位于 `codex/initial-import` 分支。每个后续改动可以建立独立分支：

```sh
git status
git switch -c codex/describe-your-change
# 编辑代码，并运行与改动相关的检查
git diff
git add <本次改动的文件>
git diff --cached --check
git commit -m "fix: describe the change"
```

提交说明使用 Conventional Commits，例如 `fix:`、`feat:`、`docs:`、`test:`、`chore:`。避免在未检查文件清单时直接暂存所有文件。

通用检查入口：`npm test`、`npm run build`、`npm run desktop:test`。桌面应用修改还应运行相应的实际应用验证；专项历史研究脚本的本地证据依赖见 README。

## 远程备份

初次设置仅建立本地仓库和提交，尚未配置远程仓库，也没有上传代码。本地 Git 可以查看历史和回退，但不能代替另一台设备或远程仓库上的备份。后续确定远程仓库地址与可见范围后，再配置并推送。
