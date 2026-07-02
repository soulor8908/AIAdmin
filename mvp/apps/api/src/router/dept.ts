// apps/api/src/router/dept.ts —— procedure 表：每个 procedure = { input, handler, auth, permission }
// 输入经 Zod 校验（B1 router 层），handler 调 service。
// SEC-001：每个 procedure 必须声明 auth 元数据（本部门管理全 admin）。
// SEC-001（TECH-DEPT-001 扩展）：DeptProcedure 额外声明 permission（dept:read / dept:write）。
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
import type { Procedure } from './user.js';

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

export function createDeptRouter(service: DepartmentService): DeptRouter {
  return {
    tree: {
      input: departmentTreeQuerySchema,
      handler: (_input, ctx) => service.tree(ctx),
      auth: 'admin',
      permission: 'dept:read',
    },
    create: {
      input: createDepartmentInputSchema,
      handler: (input, ctx) => service.create(input, ctx),
      auth: 'admin',
      permission: 'dept:write',
    },
    delete: {
      input: deptDeleteProcedureInputSchema,
      handler: (input, ctx) => service.delete(input.id, ctx),
      auth: 'admin',
      permission: 'dept:write',
    },
    assignUserDepartment: {
      input: assignUserDepartmentInputSchema,
      handler: (input, ctx) =>
        service.assignUserDepartment(input.userId, input.departmentId, ctx),
      auth: 'admin',
      permission: 'dept:write',
    },
  };
}
