// apps/api/src/router/index.ts —— 聚合 router
import type { UserService } from '../service/user.js';
import type { RoleService } from '../service/role.js';
import { createUserRouter } from './user.js';
import { createRoleRouter } from './role.js';

export function createRouter(userService: UserService, roleService: RoleService) {
  return {
    user: createUserRouter(userService),
    role: createRoleRouter(roleService),
  };
}

export { createUserRouter, updateUserStatusProcedureInputSchema } from './user.js';
export type { Procedure, UserRouter } from './user.js';
export { createRoleRouter, roleDetailProcedureInputSchema, listUserRolesProcedureInputSchema } from './role.js';
export type { RoleRouter } from './role.js';
