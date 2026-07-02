---
alwaysApply: false
globs: "**/*.ts"
---
# 禁止模式

## CODE-001 · 禁止 any
- 触发条件：TS 文件中出现 `any` 类型标注（含 `as any`）。
- 期望行为：用 unknown + 类型守卫，或具体类型；确需宽松处用泛型约束。
- 校验方式：tsc strict + scripts/check-rules.mjs 正则扫描 `: any` / `as any`。

## CODE-002 · 禁止吞错
- 触发条件：catch 块为空或仅 console.log。
- 期望行为：必须转换为 AppError 并带错误码，或显式 rethrow；禁止 silent catch。
- 校验方式：scripts/check-rules.mjs 检测空 catch 或仅含 console 的 catch。

## CODE-003 · 禁止 eval 与动态执行
- 触发条件：代码中出现 eval / new Function / Function()。
- 期望行为：一律禁止；动态逻辑用映射表。
- 校验方式：scripts/check-rules.mjs 正则扫描。

## CODE-004 · 命名约定
- 触发条件：新增标识符时。
- 期望行为：变量/函数 camelCase；类型/接口 PascalCase；Zod schema 以 `xxxSchema` 后缀，类型以裸名词。
- 校验方式：人工/Review。
