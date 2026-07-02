---
doc_type: Review-Report
id: REV-USER-001
tech_spec_ref: TECH-USER-001
verdict: block
created: 2026-07-02
---
# 用户管理 · Code Review 报告

评审范围：本次"用户管理"PR 全部新增源文件（apps/api/src 下 8 个文件 + apps/api/test/user.test.ts），对照 `.trae/rules` 四份规则与 `docs/spec/user.tech.md` / `packages/contracts/src/schemas/user.ts` 逐条核查。

## 汇总
- blocker 数：1
- suggestion 数：6
- verdict：block（存在 1 处 CODE-004 命名硬约束违反；修复为单行重命名，修复后可复审合入）
- 三件套门禁：typecheck pass / lint:rules pass / test pass（35 用例）

## 逐规则评审

### ARCH-001 · 单向依赖
- 结论：pass
- 证据：逐文件核对 import 方向，均为单向 `router → service → repository → domain`，无反向依赖。
  - `apps/api/src/domain/user.ts:3` 仅 `import type { User, UserStatus } from '@admin/contracts'`，不 import 任何上层。
  - `apps/api/src/repository/user.ts:3-4` import `@admin/contracts` 与 `../domain/user.js`（repository → domain，合法）。
  - `apps/api/src/service/user.ts:4-14` import `@admin/contracts`、`../repository/user.js`、`../context.js`、`../domain/user.js`、`../errors.js`（service → repository/domain，合法）。
  - `apps/api/src/router/user.ts:4-12` import `@admin/contracts`、`../service/user.js`、`../context.js`（router → service，合法）。
  - `apps/api/src/router/index.ts:2-3` import `../service/user.js`、`./user.js`（合法）。
  - `context.ts` / `errors.ts` 为叶节点模块，仅 import `@admin/contracts` 或无 import。
- 建议：无。

### ARCH-002 · 契约层纯净
- 结论：pass
- 证据：
  - `packages/contracts/src/schemas/user.ts:6` 仅 `import { z } from 'zod'`，无 apps/ 引用。
  - `packages/contracts/src/index.ts:2` 仅 `export * from './schemas/user.js'`。
  - 导出物全部为 Zod schema（`xxxSchema`）与 `z.infer` 派生类型，无业务函数。
- 建议：无。

### ARCH-003 · 跨层只经契约
- 结论：N/A
- 证据：本 MVP 暂无 apps/web，规则预留未触发。

### CODE-001 · 禁止 any
- 结论：pass
- 证据：全量扫描 8 个源文件 + 测试文件，无 `: any` / `as any`。
  - `apps/api/src/router/user.ts:20` 用 `z.ZodType<I, z.ZodTypeDef, unknown>` 显式以 `unknown` 放宽第 3 参（带 coerce/default 的 schema Input/Output 不一致），未使用 any。
  - `apps/api/test/user.test.ts:71,84` 用 `unknown` 类型守卫，未用 any。
  - check-rules.mjs 正则扫描通过。

### CODE-002 · 禁止吞错
- 结论：pass
- 证据：全部源文件与测试文件中不存在任何 `try/catch` 块（service/repository/router 均以抛 `AppError` 表达失败，无 catch 需评估）。vacuously pass。
- 建议：无（但见文末"规则校验缺口"——脚本仅检测空 catch，未覆盖"仅 console 的 catch"）。

### CODE-003 · 禁止 eval 与动态执行
- 结论：pass
- 证据：全量扫描无 `eval(` / `new Function(` / `Function(`。check-rules.mjs 通过。

### CODE-004 · 命名约定
- 结论：blocker
- 证据：`apps/api/src/router/user.ts:28-31` 导出的 Zod schema 命名违反后缀约定：
  ```ts
  export const updateUserStatusProcedureInput = z.object({
    id: z.string().uuid(),
    body: updateUserStatusInputSchema,
  });
  ```
  该标识符是一个 `z.object(...)` schema，且在 `apps/api/test/user.test.ts:21,181,186,194` 与 `apps/api/src/router/index.ts:11` 中以 `.safeParse()` 当 schema 使用。规则 CODE-004 明确："Zod schema 以 `xxxSchema` 后缀"。当前命名 `updateUserStatusProcedureInput`（无 `Schema` 后缀）会让 Reviewer 无法从名字识别其为 schema，且与同文件内 `createUserInputSchema` / `updateUserStatusInputSchema` 的命名风格不一致。
- 建议（必修）：重命名为 `updateUserStatusProcedureInputSchema`，并同步更新 `router/user.ts:28,36,50`、`router/index.ts:11`、`test/user.test.ts` 中全部引用（约 5 处）。修复为单行重命名，影响面小。
- 类型侧命名核对：`User` / `UserStatus` / `CreateUserInput` / `UpdateUserStatusInput` / `ListUserQuery` / `UserListResult` / `ErrorCode` / `ErrorResponse` 均为裸名词，符合"类型以裸名词"；变量/函数均为 camelCase，`UserRepository` / `UserService` / `AppError` 等为 PascalCase。无其他命名问题。

### SEC-001 · 路由默认受保护
- 结论：pass（附 suggestion）
- 证据：三个 procedure（list/create/updateStatus）均无 public 标注，且其 handler 全部进入 `UserService` 的 `requireAdmin(ctx)`（`service/user.ts:20-24,27,39,58`），非 admin 一律 `FORBIDDEN`。无任何 procedure 被意外暴露为公开路由，"默认受保护"意图达成。`errorCodeToHttpStatus`（`errors.ts:16-25`）已预留 `UNAUTHORIZED: 401`，B2 路径由后续 Auth 中间件注入（与 Tech-Spec §context 说明"本 MVP 不接入真实 Auth；ctx.user 由上层注入"一致）。
- 建议（suggestion）：`Procedure` 类型（`router/user.ts:19-22`）无声明式 auth 元数据（如 `auth: 'admin' | 'public'`），权限完全耦合在 service.requireAdmin。若未来某 procedure 忘记调用走了 requireAdmin 的 service，将无声裸奔。建议在 Procedure 上加 `auth` 字段使 SEC-001 可机器校验，公开路由强制显式标注 + 注释理由。

### SEC-002 · 越权校验在 service 层
- 结论：pass
- 证据：`service/user.ts` 三个入口方法第一行均调用 `this.requireAdmin(ctx)`（行 27/39/58），非 admin 抛 `FORBIDDEN`（B3）。`updateStatus` 额外执行 B6 越权校验：`newStatus === 'disabled' && targetId === ctx.user.id` → `USER_DISABLE_SELF_FORBIDDEN`（行 65-67），且该校验先于状态守卫 B7/B8（顺序与 Tech-Spec §状态机迁移规则一致）。未发现仅依赖前端隐藏按钮的越权逻辑。
- 建议：无。

### SEC-003 · PII 脱敏
- 结论：pass（附 suggestion）
- 证据：
  - 成功响应仅返回 `userSchema` 字段（id/name/email/status/created_at/updated_at）与 `userListResultSchema` 结构，不含密码/角色/部门等未声明 PII；`userSchema` 与 `userListResultSchema` 均 `.strict()`，多余字段会被 Zod 拒绝。契约测 `test/user.test.ts:129,138,151` 已校验出参 `parse` 不抛。
  - 本期不实现审计落库（Tech-Spec §Out of scope 明示），故无审计 before-after 需脱敏。
- 建议（suggestion）：`service/user.ts:43` 的 `USER_EMAIL_DUPLICATE` 错误消息 `邮箱已被占用: ${input.email}` 回显了原始 email。虽为调用者自身提交值、且邮箱存在性本就由 B4 的 409 设计性暴露，仍建议为防御性脱敏将 message 改为不含完整 email（如 `邮箱已被占用`），降低日志/链路追踪中的 PII 残留。

### AI-001 · 先读 Spec 再写码
- 结论：pass（附 suggestion）
- 证据：实现与 Tech-Spec 高度一致——
  - 三个 procedure（list/create/updateStatus）与 Spec §API 契约表一一对应；入参/出参 schema 全部来自 contracts，无手写副本。
  - 8 个错误码（`errorCodeSchema`）与 Spec §边界与异常 B1-B8 完全对齐；`errorCodeToHttpStatus` 的 HTTP 映射与 B 表 HTTP 列一致。
  - `service.updateStatus` 校验顺序为 requireAdmin(B3) → findById(B5) → 禁用自身(B6) → transitionStatus(B7/B8)，与 Spec "B5 优先 B6 优先 B7/B8" 完全一致；`test/user.test.ts:275-289` 专门验证"自身且已禁用 → B6 优先 B7"。
  - `create` 默认 `status: 'active'`（`service/user.ts:50`）符合 F2；`list` 的 `totalPages = total===0 ? 0 : ceil(total/pageSize)`（行 34）符合 F1 空列表 totalPages=0。
- 建议（suggestion）：`domain/user.ts:6` 导出 `UserEntity = User`（contracts User 的别名），而 Tech-Spec §DB 变更 明确写出 `export interface UserRow { ... }` 作为 domain DB schema SSOT。实现以别名替代手写 interface（避免 ARCH-002 精神下的手写副本，方向正确），但与 Spec 文字不一致。建议反向同步 Spec：注明 `UserRow` 等价于契约 `User`，或把 domain 导出名对齐为 `UserRow`，消除 Spec↔代码漂移。

### AI-002 · 测试先行
- 结论：pass（附 2 条 suggestion）
- 证据：测试文件头部声明"本文件先于实现产出"，断言有力（`expectAppError` 同时校验 `toBeInstanceOf(AppError)` 与 `err.code`，非空跑；schema 测用 `expect(() => x.parse(result)).not.toThrow()`）。覆盖测试矩阵五类：
  - 单测 · domain 状态机：4 个 case 覆盖 active⇄disabled 合法/非法转移（`test:95-119`）。
  - 契约测 · 出参 schema：list/create/updateStatus 三处 `parse` 校验（`test:124-154`）。
  - 契约测 · 入参 safeParse：page=0、pageSize=101、status 非枚举、email 缺@、name 空串、id 非 uuid、status 非枚举 + 合法样本（`test:156-200`）。
  - 边界：page=0/pageSize=101/status 非法经 procedure 转 VALIDATION_ERROR、邮箱重复、重复禁用/启用、用户不存在、禁用自身、顺序校验 B6>B7、F1 分页（25 条 page=2、空库、status 过滤）（`test:205-325`）。
  - 权限：非 admin 调三 procedure → FORBIDDEN；管理员启用自身成功（`test:330-374`）。
  - 状态机：active→disabled→active 全路径 + 重复状态拒绝（`test:379-418`）。
- 建议（suggestion）：① 测试矩阵"单测 · repository CRUD"一类无独立 `describe` 块，repository 的 `findByEmail` 唯一性、`updateStatus` 不存在返回 undefined、`list` 分页切片均仅通过 service/router 集成测试间接覆盖；建议补 repository 直接单测以隔离定位。② B2（未登录 → UNAUTHORIZED）路径无测试，因 MVP ctx.user 恒存在；建议在 Auth 中间件落地后补 B2 用例，当前可记为已知缺口。

### AI-003 · 禁止越界发挥
- 结论：pass
- 证据：逐项核对无 Spec 外的字段/路由/依赖——
  - 路由仅 list/create/updateStatus，无多余 procedure。
  - `userSchema` 字段与 Spec §DB 变更 完全一致，无多余字段；`createUserInputSchema` 仅 email+name（Q5 决策），无密码/角色/部门。
  - 依赖仅 `@admin/contracts` + `zod`（`apps/api/package.json:9-12`），`service/user.ts:3` 的 `randomUUID` 来自 `node:crypto` 内置，未引入新依赖。
  - 导出符号 `transitionStatus`/`TransitionResult`（domain 状态机）、`UserRepository`/`ListOptions`/`ListResult`（repository CRUD）、`UserService`、`Procedure`/`UserRouter`/`createUserRouter`/`updateUserStatusProcedureInput`、`AppError`/`errorCodeToHttpStatus`、`Ctx`/`CtxUser` 均可在 Spec 中找到语义来源（状态机/CRUD/procedure 表/错误码/上下文）。
  - 唯一与 Spec 文字偏离的是 `UserEntity` vs `UserRow`（见 AI-001 suggestion），属命名/结构偏差而非越界新增。
- 建议：无（UserEntity/UserRow 偏差已在 AI-001 记录）。

### AI-004 · 每次改动必跑三件套
- 结论：pass
- 证据：在 `/workspace/mvp` 实跑：
  - `npx tsc -p tsconfig.json --noEmit` → exit 0（typecheck pass）。
  - `node scripts/check-rules.mjs` → `✅ 规则校验通过（ARCH-001/002, CODE-001/002/003）`，exit 0（lint:rules pass）。
  - `npx vitest run` → `Test Files 1 passed (1)` / `Tests 35 passed (35)`，exit 0（test pass）。

## 越界检查（AI-003）
逐项确认无越界（详见 AI-003 节）：
- 路由：list / create / updateStatus，与 Spec §API 契约表 1:1，无多余 procedure。
- 字段：userSchema / createUserInputSchema / updateUserStatusInputSchema / listUserQuerySchema 字段集与 Spec 一致，无 Spec 外字段。
- 依赖：未新增 npm 依赖；`randomUUID` 为 node 内置。
- 导出符号：全部可在 Spec 找到语义来源。
- 唯一偏差：`domain/user.ts` 导出 `UserEntity`（=User 别名）而非 Spec §DB 变更 文字中的 `UserRow` interface——属命名/结构偏差（且方向上避免手写副本，符合 ARCH-002 精神），非越界新增，记为 suggestion（见 AI-001）。

## 门禁复核（AI-004）
- typecheck：pass（`tsc --noEmit` exit 0）
- lint(rules)：pass（`check-rules.mjs` exit 0，覆盖 ARCH-001/002、CODE-001/002/003）
- test：pass（35 用例全绿，1 个测试文件）

## 规则校验缺口（建议补强 check-rules.mjs）
以下规则虽本次未触发违规，但 `scripts/check-rules.mjs` 存在覆盖盲区，记为 suggestion：
1. **CODE-002 漏检"仅 console 的 catch"**：脚本正则 `catch\s*\([^)]*\)\s*\{\s*\}` 仅匹配空 catch 体，对 `catch (e) { console.log(e) }` 这类"仅 console"吞错不报警，而规则明确将其列为禁止。建议增强为检测 catch 体仅含 console.* 调用。
2. **CODE-003 漏检裸 `Function(`**：脚本仅匹配 `new Function(`，未覆盖规则所述的 `Function(`（无 new）形式。
3. **ARCH-001 仅校验 domain 反向 import**：脚本只扫描 `apps/api/src/domain` 目录，未校验 service/repository/router 之间的反向依赖（如 repository import router、service import router）。规则适用于全链路单向依赖，建议扩展到各层目录。
4. **SEC-* 与 CODE-004 无机器校验**：SEC-001/002/003 与 CODE-004 完全依赖人工 Review。其中 SEC-001 若引入声明式 `auth` 元数据（见 SEC-001 suggestion）即可机器化；CODE-004 的 `xxxSchema` 后缀可用 AST/正则对 `z.object(...)` 赋值的 const 做后缀检查（本次 blocker 即属此类可机器拦截项）。

## 最终结论与合入建议
- verdict：**block**
- 唯一 blocker：`apps/api/src/router/user.ts:28` 的 `updateUserStatusProcedureInput` 违反 CODE-004 命名后缀约定（应为 `updateUserStatusProcedureInputSchema`）。修复为单行重命名 + 5 处引用同步更新，影响面小、无逻辑改动。
- 修复路径：重命名后重跑 `npx tsc --noEmit && node scripts/check-rules.mjs && npx vitest run`，三件套全绿即可复审合入。
- 其余 6 条 suggestion（SEC-001 声明式 auth、SEC-003 错误消息脱敏、AI-002 repository 独立单测与 B2 用例、AI-001 UserEntity/UserRow 对齐、规则校验缺口）不阻断合入，建议在后续迭代或规则基建迭代中跟进。
- 总体评价：分层、契约、状态机、权限校验、测试覆盖质量高，与 Tech-Spec 对齐度好；唯一阻断项为命名约定硬约束违反，属可快速修复的低风险问题。
