---
alwaysApply: false
globs: "**/*.ts"
---
# 禁止模式（CODE-001/002/003）

## CODE-001 · 禁止 any
- 触发条件：TS 文件中出现 `any` 类型标注（含 `as any`）。
- 期望行为：用 unknown + 类型守卫，或具体类型；确需宽松处用泛型约束。
- 校验方式：`scripts/check-rules.mjs` CODE-001 分支正则扫描 `: any` 与 `as any`，命中即报错；CI 同步执行。

## CODE-002 · 禁止吞错
- 触发条件：catch 块为空或仅 console。
- 期望行为：必须转换为 AppError 并带错误码，或显式 rethrow；禁止 silent catch。
- 校验方式：`scripts/check-rules.mjs` CODE-002 分支检测空 catch 与仅 console 的 catch（多行容忍），命中即报错。

## CODE-003 · 禁止 eval 与动态执行
- 触发条件：代码中出现 eval / new Function / 裸 Function()。
- 期望行为：一律禁止；动态逻辑用映射表。
- 校验方式：`scripts/check-rules.mjs` CODE-003 分支正则扫描 `eval(`、`new Function(`、裸 `Function(`，命中即报错。
