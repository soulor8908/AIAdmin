---
alwaysApply: true
---
# 规则元约束（复盘 RETRO-MVP-001 P0 补强）

## META-001 · 无校验不立规
- 触发条件：新增/修改 `.trae/rules/**` 下任意规则文件时。
- 期望行为：每条规则（规则 ID + 触发条件 + 期望行为 + 校验方式四段式）的"校验方式"段必须注明具体工具 + 命令/脚本，且该校验方式必须真实存在于 `scripts/check-rules.mjs` 或 lint/tsc/CI 中。仅靠"人工 Review"的规则不得合入，必须配套机器校验脚本改动。
- 校验方式：`scripts/check-rules.mjs --meta` 扫描 `.trae/rules/**/*.md`，对每条 `## XXX-NNN` 规则块检查"校验方式"段是否含 `check-rules.mjs`/`tsc`/`eslint`/`vitest`/`ci` 关键词之一；缺则报 META-001 违规。

## META-002 · 规则 PR 准入
- 触发条件：PR 改动 `.trae/rules/` 或 `scripts/check-rules.mjs`。
- 期望行为：规则文件改动必须同 PR 内含 `check-rules.mjs` 对应改动（新增规则→新增校验分支）；CI 校验 `check-rules.mjs --meta` 全绿方可合入。
- 校验方式：CI 检测 rules 与 check-rules.mjs 的同 PR 改动关联。
