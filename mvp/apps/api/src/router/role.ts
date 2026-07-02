// apps/api/src/router/role.ts —— procedure 表：每个 procedure = { input, handler, auth }
// 输入经 Zod 校验（B1 router 层），handler 调 service。
// SEC-001：每个 procedure 必须声明 auth 元数据（本角色管理全 admin）。
import { z } from 'zod';
import {
  assignRoleInputSchema,
  createRoleInputSchema,
  listRoleQuerySchema,
  type Role,
  type RoleListResult,
  type UserRole,
} from '@admin/contracts';
import type { RoleService } from '../service/role.js';
import type { Procedure } from './user.js';

export type { Procedure };

/**
 * detail / delete procedure 入参 = path id (uuid)。
 * 单独导出以便契约测直接对该 schema 跑 safeParse。
 */
export const roleDetailProcedureInputSchema = z.object({
  id: z.string().uuid(),
});

/**
 * listUserRoles procedure 入参 = path userId (uuid)。
 * 单独导出以便契约测直接对该 schema 跑 safeParse。
 */
export const listUserRolesProcedureInputSchema = z.object({
  userId: z.string().uuid(),
});

export type RoleRouter = {
  list: Procedure<z.infer<typeof listRoleQuerySchema>, RoleListResult>;
  create: Procedure<z.infer<typeof createRoleInputSchema>, Role>;
  detail: Procedure<z.infer<typeof roleDetailProcedureInputSchema>, Role>;
  delete: Procedure<z.infer<typeof roleDetailProcedureInputSchema>, void>;
  assign: Procedure<z.infer<typeof assignRoleInputSchema>, UserRole>;
  listUserRoles: Procedure<z.infer<typeof listUserRolesProcedureInputSchema>, UserRole[]>;
  remove: Procedure<z.infer<typeof assignRoleInputSchema>, void>;
};

export function createRoleRouter(service: RoleService): RoleRouter {
  return {
    list: {
      input: listRoleQuerySchema,
      handler: (input, ctx) => service.list(input, ctx),
      auth: 'admin',
    },
    create: {
      input: createRoleInputSchema,
      handler: (input, ctx) => service.create(input, ctx),
      auth: 'admin',
    },
    detail: {
      input: roleDetailProcedureInputSchema,
      handler: (input, ctx) => service.getById(input.id, ctx),
      auth: 'admin',
    },
    delete: {
      input: roleDetailProcedureInputSchema,
      handler: (input, ctx) => service.delete(input.id, ctx),
      auth: 'admin',
    },
    assign: {
      input: assignRoleInputSchema,
      handler: (input, ctx) => service.assign(input.userId, input.roleId, ctx),
      auth: 'admin',
    },
    listUserRoles: {
      input: listUserRolesProcedureInputSchema,
      handler: (input, ctx) => service.listUserRoles(input.userId, ctx),
      auth: 'admin',
    },
    remove: {
      input: assignRoleInputSchema,
      handler: (input, ctx) => service.remove(input.userId, input.roleId, ctx),
      auth: 'admin',
    },
  };
}
