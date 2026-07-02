---
alwaysApply: false
globs: "**/*.ts"
---
# 命名约定（复盘补强：CODE-004 机器化）

## CODE-004 · 命名约定
- 触发条件：新增/修改 TS 文件中的导出标识符时。
- 期望行为：
  - 变量/函数 camelCase；类型/接口 PascalCase；常量 UPPER_SNAKE。
  - Zod schema（任何 `z.object/z.enum/z.array/z.tuple/z.union/...` 赋值的 export const）必须以 `Schema` 后缀命名。
  - z.infer 派生类型用裸名词（不带 Schema 后缀）。
  - 例外：仅作为内部局部变量（非 export）的 schema 不强制后缀。
- 校验方式：`scripts/check-rules.mjs` CODE-004 分支正则扫描 `export\s+const\s+(\w+)\s*=\s*z\.(object|enum|array|tuple|union|intersection|record)`，对捕获的标识符检查是否以 `Schema` 结尾；不以 Schema 结尾即报 CODE-004 违规。例外清单在 `scripts/check-rules-allowlist.json`（如有）。
