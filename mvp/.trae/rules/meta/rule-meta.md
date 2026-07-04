---
alwaysApply: true
---
# 规则元约束
> 历史演进明细见 docs/retro/lessons-learned.md。

## META-001 · 无校验不立规
- 触发条件：新增/修改 `.trae/rules/**` 下任意规则文件时。
- 期望行为：每条规则（规则 ID + 触发条件 + 期望行为 + 校验方式四段式）的"校验方式"段必须注明具体工具 + 命令/脚本，且该校验方式必须真实存在于 `scripts/check-rules.mjs` 或 lint/tsc/CI 中。仅靠"人工 Review"的规则不得合入，必须配套机器校验脚本改动。
- 校验方式：`scripts/check-rules.mjs` META-001 分支扫描 `.trae/rules/**/*.md`，对每条 `## XXX-NNN` 规则块检查"校验方式"段是否含机器校验关键词；缺则报 META-001 违规。

## META-002 · 规则 PR 准入
- 触发条件：PR 改动 `.trae/rules/` 或 `scripts/check-rules.mjs`。
- 期望行为：规则文件改动必须同 PR 内含 `check-rules.mjs` 对应改动（新增规则→新增校验分支）；CI 校验 `check-rules.mjs` 全绿方可合入。
- 校验方式：CI 检测 rules 与 check-rules.mjs 的同 PR 改动关联。

## META-003 · 声明即实现（无声明漂移）
- 触发条件：规则文档"校验方式"段声称由 `check-rules.mjs` 专属分支校验时。
- 期望行为：若规则文档的校验方式段声称用 `check-rules.mjs` 专属分支（措辞含"check-rules.mjs ... <规则ID> ... 分支"），则 `scripts/check-rules.mjs` 中必须存在以该规则 ID 注册的 enforcement 分支（通过 `markEnforcement('<规则ID>')` 调用注册）。声称有专属分支但脚本无对应 markEnforcement 注册 = 声明漂移，报错。
- 校验方式：`scripts/check-rules.mjs` META-003 分支提取所有"校验方式段声称用 check-rules.mjs 专属分支"的规则 ID（精确模式：含 check-rules.mjs + 规则ID + 分支），与脚本内 `markEnforcement('<ID>')` 注册集合做差集；规则文档声称但脚本无注册即报 META-003 漂移。

## META-004 · 实现即声明（无反向缺口）
- 触发条件：`scripts/check-rules.mjs` 新增 `markEnforcement('<ID>')` 注册时。
- 期望行为：脚本中每个 `markEnforcement('<ID>')` 注册必须对应 `.trae/rules` 下一条同名规则 ID 的 `## XXX-NNN` 块。脚本有注册但无规则文档定义 = 反向缺口，报错。
- 校验方式：`scripts/check-rules.mjs` META-004 分支提取脚本内所有 `markEnforcement('<ID>')` 注册的规则 ID，与规则文档 `## XXX-NNN` 集合做差集；脚本有注册但无规则文档即报 META-004 缺口。
