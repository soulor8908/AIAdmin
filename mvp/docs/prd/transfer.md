---
doc_type: PRD-Spec
id: PRD-TRANSFER-001
title: 用户调岗事务（跨域多步原子操作 + 补偿回滚 + 事务感知聚合埋点）
status: draft
owner: ba@team
created: 2026-07-02
extends: PRD-NOTIFICATION-001
prd_ref: RETRO-ROUND6-001
---

# 用户调岗事务（跨域多步原子操作 + 补偿回滚 + 事务感知聚合埋点）

## 背景
前六轮演练（RETRO-ROUND6-001 §5）建议下一轮探索"工作流在更复杂业务（如多步事务、跨域聚合报表、权限继承）的适应性"。前六轮所有写操作均为**单步 service 调用**（create/update/delete/assign/remove/send/markRead），每个 service 方法编排单一 repository 写入，withAudit 在 router 层包装单步 handler。尚未验证的工作流边界：

1. **多步事务编排**：一个业务操作需编排多个跨域 service 调用（user/dept/role 三域联动），任一步骤失败须回滚已执行步骤——现有 service/repository 均无事务/回滚概念（内存 Map 无事务支持）。
2. **补偿回滚机制**：内存实现无 DB 事务，须用"补偿操作"（每步记录逆操作，失败逆序执行）模拟事务回滚——这是新架构模式，未验证 ARCH-001/CODE-002 在补偿逻辑下是否闭合。
3. **事务感知埋点**：现有 withAudit 包装单步 handler（handler 成功→埋点，失败→不埋点）。多步事务下，须保证"事务全部成功才埋点，任一步骤失败回滚后不埋点"——验证 withAudit 在多步事务语义下的正确性（无幽灵审计日志）。
4. **AI-007 端到端验收**：调岗事务的"回滚后状态恢复 + 无幽灵日志"是跨层行为（service 多步编排 + repository 状态变更 + audit 旁路副作用），无法由单层断言覆盖，须端到端验收（注入共享 auditRepo 观测无日志落库 + 注入共享 userRepo/deptRepo 观测状态恢复）。

本期新增 **transfer（调岗）领域** 作为上述四方向的验证载体。调岗 = 改用户部门 + 移除旧角色 + 分配新角色，三步跨域原子操作，是"多步事务"的最小完整场景。

## 业务目标
- **目标1（多步事务编排）**：提供用户调岗能力——一次操作完成"改部门 + 移除旧角色 + 分配新角色"三步跨域变更，调用方感知为单一原子操作。
- **目标2（补偿回滚）**：三步中任一步骤失败，已执行步骤须逆序补偿恢复至调岗前状态；回滚后用户部门/角色与调岗前完全一致。
- **目标3（事务感知聚合埋点）**：调岗三步全部成功后，经 withAudit 记**一条聚合审计日志**（entity_type=user, action=update, changes 含 department_id + role 变更）；任一步骤失败回滚后**不埋点**（无幽灵日志）。
- **目标4（验证工作流适应性）**：验证 ARCH-001（service→service 横向依赖，TransferService 注入 DeptService/RoleService/UserService）、CODE-002（补偿 catch 须非空）、AI-006（受影响测试清单两类标注）、AI-007（端到端验收回滚+无幽灵日志）在多步事务新领域下是否闭合。

## 用户故事
- 作为运营人员，我希望一次性完成用户调岗（改部门+换角色），系统自动保证三步要么全成功要么全回滚，避免出现"部门改了但角色没换"的中间态。
- 作为运营人员，我希望调岗失败时系统自动恢复用户调岗前的部门与角色，无需我手动修正中间态。
- 作为审计人员，我希望调岗成功后自动产生一条聚合审计日志（含部门变更+角色变更），而非三条分散日志，以便一次追溯完整调岗事件。
- 作为审计人员，我希望调岗失败回滚后**不产生**审计日志，避免日志记录了"实际未生效"的变更造成审计误导。
- 作为系统负责人，我希望补偿回滚是 best-effort 之外的可观测行为——若补偿本身失败，须显式告警（非静默吞），以便运维介入修复数据一致性。

## 功能点清单
- [ ] F1：调岗事务编排（TransferService.transfer(input, ctx) 编排：校验 → 改部门 → 移除旧角色 → 分配新角色；三步原子；任一失败回滚）
- [ ] F2：补偿回滚机制（每步执行后记录补偿闭包，失败时逆序执行补偿；补偿失败抛 TRANSFER_COMPENSATION_FAILED 告警，非静默吞）
- [ ] F3：事务感知聚合埋点（transfer 返回 WriteResult<User>，含 department_id + role 变更聚合 changes；router 层 withAudit 包装；事务失败抛异常 → withAudit 不埋点 → 无幽灵日志）

## 数据实体草图
- **调岗入参 TransferInput**：`{ userId: uuid, toDepartmentId: uuid, oldRoleId: uuid, newRoleId: uuid }`
  - `userId`：被调岗用户（须存在且 status=active，否则 USER_NOT_FOUND / USER_ALREADY_DISABLED）。
  - `toDepartmentId`：目标部门（须存在，否则 DEPT_NOT_FOUND）。
  - `oldRoleId`：要移除的旧角色（须存在且非 builtin，否则 ROLE_NOT_FOUND / ROLE_BUILTIN_FORBIDDEN）。
  - `newRoleId`：要分配的新角色（须存在，否则 ROLE_NOT_FOUND）。
  - `oldRoleId !== newRoleId`（否则 TRANSFER_SAME_ROLE，避免无意义操作）。
- **调岗执行步骤（F1，三步跨域原子）**：
  1. **校验阶段**（全部前置，不产生写入）：用户存在+active → 目标部门存在 → 新角色存在 → 旧角色存在+非 builtin → oldRoleId !== newRoleId → 用户当前已分配 oldRoleId（否则 TRANSFER_OLD_ROLE_NOT_ASSIGNED）。
  2. **执行步骤 A**：改用户部门（`from = user.department_id`，调 deptService.assignUserDepartment 或直接 userRepo.updateDepartmentId）。
  3. **执行步骤 B**：移除旧角色（调 roleService.remove(userId, oldRoleId)）。
  4. **执行步骤 C**：分配新角色（调 roleService.assign(userId, newRoleId)）。
- **补偿闭包（F2，每步记录逆操作）**：
  - 步骤 A 补偿：`userRepo.updateDepartmentId(userId, from, now)`（改回原部门）。
  - 步骤 B 补偿：`roleService.assign(userId, oldRoleId, ctx)`（重新分配旧角色）。
  - 步骤 C 补偿：`roleService.remove(userId, newRoleId, ctx)`（移除刚分配的新角色）。
  - 逆序执行：若步骤 C 失败 → 补偿 B + 补偿 A；若步骤 B 失败 → 补偿 A；若步骤 A 失败 → 无需补偿。
- **聚合审计日志（F3，事务成功后一条）**：
  - entity_type=`user`, action=`update`, entity_id=`userId`
  - before：`[{field:'department_id', value:<旧部门id|null>, pii:false}, {field:'role_id', value:<旧角色id>, pii:false}]`
  - after：`[{field:'department_id', value:<新部门id>, pii:false}, {field:'role_id', value:<新角色id>, pii:false}]`
  - operator_id/operator_name：沿用 withAudit 从 ctx 取（admin 桩）。
  - 事务失败 → 不产生此日志（withAudit 的 handler 抛异常，不调 audit.record）。
- **新增错误码（contracts 联动）**：
  - `TRANSFER_SAME_ROLE`：oldRoleId === newRoleId（400，语义冲突，避免无意义操作）。
  - `TRANSFER_OLD_ROLE_NOT_ASSIGNED`：用户当前未分配 oldRoleId（409，前置状态不满足）。
  - `TRANSFER_COMPENSATION_FAILED`：补偿回滚自身失败（500，数据一致性告警，须运维介入）。
  - `TRANSFER_FAILED`：事务失败已回滚（500，聚合错误码，message 含失败步骤与原因；底层校验错误码如 USER_NOT_FOUND/DEPT_NOT_FOUND 等直接传播，不聚合为 TRANSFER_FAILED）。

## 验收标准（Given/When/Then）—— AI-007 端到端验收依据

### F1 调岗事务编排
- **AC-F1-1 正常调岗成功**：GIVEN 用户已分配 oldRole 且有部门 fromDept / WHEN 调岗到 toDept+newRole / THEN 用户 department_id=toDept、oldRole 已移除、newRole 已分配、返回 WriteResult 含聚合 changes。
- **AC-F1-2 用户不存在**：GIVEN userId 不存在 / WHEN 调岗 / THEN 抛 USER_NOT_FOUND（不执行任何写入、无审计日志）。
- **AC-F1-3 用户已禁用**：GIVEN 用户 status=disabled / WHEN 调岗 / THEN 抛 USER_ALREADY_DISABLED（不执行任何写入）。
- **AC-F1-4 目标部门不存在**：GIVEN toDepartmentId 不存在 / WHEN 调岗 / THEN 抛 DEPT_NOT_FOUND（不执行任何写入）。
- **AC-F1-5 新角色不存在**：GIVEN newRoleId 不存在 / WHEN 调岗 / THEN 抛 ROLE_NOT_FOUND（不执行任何写入）。
- **AC-F1-6 旧角色不存在**：GIVEN oldRoleId 不存在 / WHEN 调岗 / THEN 抛 ROLE_NOT_FOUND（不执行任何写入）。
- **AC-F1-7 旧角色 builtin**：GIVEN oldRoleId 为 builtin 角色 / WHEN 调岗 / THEN 抛 ROLE_BUILTIN_FORBIDDEN（不执行任何写入）。
- **AC-F1-8 同角色**：GIVEN oldRoleId === newRoleId / WHEN 调岗 / THEN 抛 TRANSFER_SAME_ROLE（不执行任何写入）。
- **AC-F1-9 旧角色未分配**：GIVEN 用户未分配 oldRoleId / WHEN 调岗 / THEN 抛 TRANSFER_OLD_ROLE_NOT_ASSIGNED（不执行任何写入）。

### F2 补偿回滚
- **AC-F2-1 步骤 B 失败回滚 A**：GIVEN 步骤 A（改部门）成功、步骤 B（移除旧角色）失败（如注入 roleService.remove 抛错）/ THEN 步骤 A 补偿执行（用户 department_id 恢复 fromDept）、抛 TRANSFER_FAILED（含原因）、无审计日志。
- **AC-F2-2 步骤 C 失败回滚 B+A**：GIVEN 步骤 A+B 成功、步骤 C（分配新角色）失败 / THEN 补偿 B（重新分配 oldRole）+ 补偿 A（改回 fromDept）逆序执行、用户状态完全恢复、抛 TRANSFER_FAILED、无审计日志。
- **AC-F2-3 补偿失败告警**：GIVEN 补偿操作自身失败（如注入 userRepo.updateDepartmentId 补偿时抛错）/ THEN 抛 TRANSFER_COMPENSATION_FAILED（非静默吞，message 含补偿失败步骤）、无审计日志。
- **AC-F2-4 回滚后状态一致**：GIVEN 任一执行步骤失败回滚完成 / THEN 用户 department_id、已分配角色列表与调岗前完全一致（端到端断言，注入共享 userRepo + roleRepo 观测）。

### F3 事务感知聚合埋点
- **AC-F3-1 成功后聚合埋点**：GIVEN 调岗三步全部成功 / THEN 审计日志表有且仅有一条 entity_type=user/action=update 的日志、before/after 含 department_id+role_id 变更、无其他调岗相关日志（非三条分散）。
- **AC-F3-2 失败无幽灵日志**：GIVEN 调岗任一步骤失败回滚 / THEN 审计日志表无调岗相关日志（注入共享 auditRepo 断言 items 为空或不含本次 transfer）。
- **AC-F3-3 withAudit 复用**：GIVEN TransferService.transfer 返回 WriteResult<User> / THEN router 层 withAudit 包装复用既有 D1 HOF 模式（不新增埋点机制）。

## Q&A 决策（全 BLOCKING，未回答不进入 Spec）

**Q1 · 调岗事务的步骤定义？**
BLOCKING。三步：A 改部门 + B 移除旧角色 + C 分配新角色。校验全部前置（不产生写入），执行 A→B→C 顺序。是否需调整步骤顺序或增减步骤？

**Q2 · 回滚策略：补偿 vs 快照？**
BLOCKING。方案①补偿（每步记录逆操作闭包，失败逆序执行）；方案②快照（事务开始前快照 user+role 关联实体，失败全局恢复）。本期选哪个？补偿更贴近真实 DB 事务语义且不改 repo 层，推荐①。

**Q3 · 补偿操作的归属与逆序？**
BLOCKING。补偿闭包在 TransferService 内构造（步骤 A 补偿=userRepo.updateDepartmentId 改回、B 补偿=roleService.assign 重新分配、C 补偿=roleService.remove 移除）。失败时逆序：C 失败→补偿 B+A；B 失败→补偿 A；A 失败→无补偿。是否认可？

**Q4 · 埋点时机：事务成功后聚合 vs 每步埋点？**
BLOCKING。方案①聚合（transfer 成功后一条日志，before/after 含 department_id+role_id）；方案②每步埋点（三条日志）。本期选哪个？聚合更符合"一次调岗事件一条审计"语义，推荐①。

**Q5 · 审计日志 entity_type 与 action？**
BLOCKING。entity_type=`user`（调岗主体是用户），action=`update`（用户属性变更，沿用 dept.assignUserDepartment 先例 entity_type=user/action=update）。是否认可？

**Q6 · 校验顺序？**
BLOCKING。用户存在→用户 active→目标部门存在→新角色存在→旧角色存在→旧角色非 builtin→oldRoleId!==newRoleId→用户已分配 oldRoleId。先到先返，不叠加。是否调整？

**Q7 · 事务失败错误码：传播底层 vs 聚合 TRANSFER_FAILED？**
BLOCKING。校验阶段失败（USER_NOT_FOUND/DEPT_NOT_FOUND/ROLE_NOT_FOUND/ROLE_BUILTIN_FORBIDDEN/USER_ALREADY_DISABLED/TRANSFER_SAME_ROLE/TRANSFER_OLD_ROLE_NOT_ASSIGNED）直接传播（调用方需区分具体原因）。执行阶段失败（A/B/C 步骤抛错）已回滚后聚合为 TRANSFER_FAILED（message 含失败步骤+底层原因）。补偿失败 TRANSFER_COMPENSATION_FAILED。是否认可？

**Q8 · 幂等性：调岗到相同部门+角色？**
BLOCKING。oldRoleId !== newRoleId 必须满足（TRANSFER_SAME_ROLE）。但 toDepartmentId 可等于当前部门（改部门无变化但换角色）——步骤 A 仍执行（updateDepartmentId 幂等，改回相同值），是否接受？或校验 toDepartmentId !== 当前部门？推荐接受（允许同部门换角色）。

**Q9 · 补偿失败的告警语义？**
BLOCKING。补偿操作自身失败（如 userRepo.updateDepartmentId 补偿时抛错）→ 抛 TRANSFER_COMPENSATION_FAILED（500），message 含"补偿失败步骤+原失败原因"，**非静默吞**（CODE-002：catch 须非空且非仅 console）。是否认可？

**Q10 · TransferService 依赖注入方式？**
BLOCKING。TransferService 注入 UserService + DepartmentService + RoleService + UserRepository + RoleRepository（补偿闭包需直接调 repo 改回，绕过 service 的 requireAdmin？或补偿也经 service？）。补偿经 service 会触发 requireAdmin（ctx 已是 admin，可通过），但 service 方法可能含额外校验/埋点污染补偿。推荐：补偿直接调 repo（userRepo.updateDepartmentId / roleRepo 操作），绕过 service 层的 requireAdmin 与 withAudit 埋点，保持补偿纯粹。是否认可？

**Q11 · transfer 返回的 WriteResult 形状？**
BLOCKING。TransferService.transfer 返回 `WriteResult<User>`（{entity: 更新后的 User, changes: 聚合 ChangeField[], before: 聚合 ChangeField[]}）。entity 为步骤 A 后的 user 快照；before/after 含 department_id + role_id 变更（role_id 为虚拟字段，类似 role.assign 的 assigned_user_ids 虚拟字段先例）。是否认可？

**Q12 · 新增 contracts 联动？**
BLOCKING。errorCodeSchema 追加 4 码（TRANSFER_SAME_ROLE/TRANSFER_OLD_ROLE_NOT_ASSIGNED/TRANSFER_COMPENSATION_FAILED/TRANSFER_FAILED）；auditLogEntityTypeSchema 不变（沿用 user）；permissionCodeSchema 追加 transfer:write；是否需新增 transfer:read（调岗无读操作，不追加）？errors.ts 补齐 4 码 HTTP 映射。是否认可？

**Q13 · 跨 service 依赖与 ARCH-001？**
BLOCKING。TransferService 注入 DeptService + RoleService + UserService（service→service→service 三层横向依赖，沿用 R6 NotificationService→UserService 先例，ARCH-001 仅禁 service→router 不禁 service→service）。TransferService 也直接注入 UserRepository + RoleRepository（补偿闭包绕过 service 调 repo）。这是否违反 ARCH-001？ARCH-001 约束 service 不得 import router，不禁止 service→repo（已有 ReportService 注入 AuditLogRepository 先例）。是否认可？

## Out of scope
- 真实 DB 事务（PostgreSQL BEGIN/COMMIT/ROLLBACK）—— 本期内存补偿模拟，DB 事务为未来工程化方向。
- 调岗历史记录（调岗轨迹查询）—— 仅记审计日志，无独立 transfer 记录表。
- 批量调岗（一次调岗多人）—— 本期单用户调岗。
- 跨部门层级调岗限制（如只能同级调动）—— 本期无层级限制校验。
- OpenAPI yaml 同步（transfer.openapi.yaml）—— 记为遗留同步项，沿用既有先例。
