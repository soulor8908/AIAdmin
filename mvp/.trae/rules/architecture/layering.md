---
alwaysApply: true
---
# 分层依赖方向（后端）

## ARCH-001 · 单向依赖
- 触发条件：在 apps/api/src 下新增/修改 import 时。
- 期望行为：依赖方向 controller/router → service → repository → domain；domain 不得 import 任何上层；禁止反向 import。
- 校验方式：scripts/check-rules.mjs 检测 import 方向，违规即报错。

## ARCH-002 · 契约层纯净
- 触发条件：在 packages/contracts/src 下编辑文件时。
- 期望行为：contracts 不得 import apps/ 下任何模块；只导出 Zod schema 与 z.infer 类型。
- 校验方式：scripts/check-rules.mjs 扫描 contracts 内 import 语句。

## ARCH-003 · 跨层只经契约
- 触发条件：前端调用后端能力时。
- 期望行为：前端只能通过 router 调用，类型来自 @admin/contracts；禁止直连 repository。
- 校验方式：scripts/check-rules.mjs 限制 apps/web 仅可 import contracts（本 MVP 暂无 web，预留）。
