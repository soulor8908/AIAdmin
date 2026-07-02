// apps/api/src/router/dept.ts —— procedure 表：每个 procedure = { input, handler, auth, permission }
// 输入经 Zod 校验（B1 router 层），handler 调 service。
// SEC-001：每个 procedure 必须声明 auth 元数据（本部门管理全 admin）。
// SEC-001（TECH-DEPT-001 扩展）：DeptProcedure 额外声明 permission（dept:read / dept:write）。
// D1：写操作（create/delete/assignUserDepartment）经 withAudit 包装，best-effort 旁路记审计日志（F1 跨域自动埋点）。
import { z } from 'zod';
import {
  assignUserDepartmentInputSchema,
  createDepartmentInputSchema,
  departmentTreeQuerySchema,
  type Department,
  type DepartmentTreeResult,
  type User,
} from '@admin/contracts';
import type { DepartmentService } from '../service/dept.js';
import { AuditLogService } from '../service/audit.js';
import { AuditLogRepository } from '../repository/audit.js';
import type { Procedure } from './user.js';
import { withAudit } from './audit.js';

export type { Procedure };

/**
 * 部门域 procedure 形状：在 Procedure 基础上追加 permission 元数据（SEC-001）。
 * permission 取 'dept:read'（查看树）或 'dept:write'（创建/删除部门、维护用户归属）。
 */
export type DeptProcedure<I, O> = Procedure<I, O> & {
  permission: 'dept:read' | 'dept:write';
};

/**
 * delete procedure 入参 = path id (uuid)。
 * 单独导出以便契约测直接对该 schema 跑 safeParse。
 */
export const deptDeleteProcedureInputSchema = z.object({
  id: z.string().uuid(),
});

export type DeptRouter = {
  tree: DeptProcedure<z.infer<typeof departmentTreeQuerySchema>, DepartmentTreeResult>;
  create: DeptProcedure<z.infer<typeof createDepartmentInputSchema>, Department>;
  delete: DeptProcedure<z.infer<typeof deptDeleteProcedureInputSchema>, void>;
  assignUserDepartment: DeptProcedure<z.infer<typeof assignUserDepartmentInputSchema>, User>;
};

/**
 * 创建部门路由。写操作（create/delete/assignUserDepartment）经 withAudit 包装，best-effort 旁路记审计日志。
 * [advisory] auditService 为可选参数，缺省时创建内部 AuditLogService（独立 AuditLogRepository）；
 *             生产环境应传入共享实例以聚合日志，测试桩下缺省即可（best-effort 日志去向不影响测试断言）。
 */
export function createDeptRouter(service: DepartmentService, auditService?: AuditLogService): DeptRouter {
  const audit = auditService ?? new AuditLogService(new AuditLogRepository());
  return {
    tree: {
      input: departmentTreeQuerySchema,
      handler: (_input, ctx) => service.tree(ctx),
      auth: 'admin',
      permission: 'dept:read',
    },
    create: {
      input: createDepartmentInputSchema,
      handler: withAudit(
        (input, ctx) => service.create(input, ctx),
        audit,
        { entityType: 'dept', action: 'create' },
      ),
      auth: 'admin',
      permission: 'dept:write',
    },
    delete: {
      input: deptDeleteProcedureInputSchema,
      handler: withAudit(
        (input, ctx) => service.delete(input.id, ctx),
        audit,
        { entityType: 'dept', action: 'delete', entityIdFromInput: (input) => (input as { id: string }).id },
      ),
      auth: 'admin',
      permission: 'dept:write',
    },
    assignUserDepartment: {
      input: assignUserDepartmentInputSchema,
      handler: withAudit(
        (input, ctx) => service.assignUserDepartment(input.userId, input.departmentId, ctx),
        audit,
        // PRD F1（dept.assignUserDepartment 跨域依赖：归属变更视为 user 的 update）：
        // entity_type=user、entity_id=被分配用户的 id（不是部门 id）
        {
          entityType: 'user',
          action: 'update',
          entityIdFromInput: (input) => (input as { userId: string }).userId,
        },
      ),
      auth: 'admin',
      permission: 'dept:write',
    },
  };
}
