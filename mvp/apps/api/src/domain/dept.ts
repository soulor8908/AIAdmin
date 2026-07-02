// apps/api/src/domain/dept.ts —— 领域层：常量 + 实体类型别名（纯函数无 IO）
// ARCH-001：domain 不得 import 上层（service/repository/router），仅可 import @admin/contracts。
// 部门无状态机（Tech-Spec §状态机），故本文件只产出领域常量与实体类型别名。
import type { Department } from '@admin/contracts';

/** 部门实体类型别名（与契约 departmentSchema 的 Department 一致，SSOT 在 contracts，禁止手写副本）。 */
export type DepartmentEntity = Department;

/**
 * 部门最大层级深度（Q4：根=1，最多 3 层）。
 * [约束] 层级不存储，由 parent_id 链路推导（根=1，每深入一层 +1）；
 *        create 时按目标父部门层级推导新部门层级，超过本常量拒绝（DEPT_DEPTH_EXCEEDED）。
 * [约束] 层级上限常量放 domain 层而非 contracts（contracts 只导出 Zod schema 与 z.infer 类型，ARCH-002）。
 */
export const MAX_DEPARTMENT_DEPTH = 3;
