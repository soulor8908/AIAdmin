---
alwaysApply: true
---
# 分层依赖方向（后端）
> 历史演进明细见 docs/retro/lessons-learned.md。

## ARCH-001 · 单向依赖（覆盖全部四层）
- 触发条件：在 apps/api/src 下新增/修改 import 时。
- 期望行为：依赖方向 router → service → repository → domain；四层各自不得反向 import 上层：
  - domain 不得 import service/repository/router。
  - repository 不得 import service/router。
  - service 不得 import router。
  - 横向：同层之间允许（如同 service 互调），但推荐通过 domain 协作。
- 校验方式：`scripts/check-rules.mjs` ARCH-001 分支按目录分层扫描——对每个层目录文件，检查是否 import 了更高层目录路径（`../service`、`../router`、`apps/api/src/router` 等）；违规即报。

## ARCH-002 · 契约层纯净
- 触发条件：在 packages/contracts/src 下编辑文件时。
- 期望行为：contracts 不得 import apps/ 下任何模块；只导出 Zod schema 与 z.infer 类型。
- 校验方式：`scripts/check-rules.mjs` ARCH-002 分支扫描 contracts 内 import 语句。

## ARCH-003 · 跨层只经契约
- 触发条件：前端调用后端能力时。
- 期望行为：前端只能通过 router 调用，类型来自 @admin/contracts；禁止直连 repository。
- 校验方式：`scripts/check-rules.mjs` ARCH-003 分支扫描 `apps/web/src/**/*.{ts,tsx}` 的 import 语句，禁止 import `apps/api/src/**`（repository/service/domain/router/server）与 `@admin/api` 包，仅允许 `@admin/contracts` + 第三方依赖 + apps/web 内部模块；违规即报错 exit≠0。
