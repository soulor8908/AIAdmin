// apps/api/src/router/index.ts —— 聚合 router
import type { UserService } from '../service/user.js';
import type { RoleService } from '../service/role.js';
import type { DepartmentService } from '../service/dept.js';
import { createUserRouter } from './user.js';
import { createRoleRouter } from './role.js';
import { createDeptRouter } from './dept.js';

export function createRouter(
  userService: UserService,
  roleService: RoleService,
  deptService: DepartmentService,
) {
  return {
    user: createUserRouter(userService),
    role: createRoleRouter(roleService),
    dept: createDeptRouter(deptService),
  };
}

export { createUserRouter, updateUserStatusProcedureInputSchema } from './user.js';
export type { Procedure, UserRouter } from './user.js';
export { createRoleRouter, roleDetailProcedureInputSchema, listUserRolesProcedureInputSchema } from './role.js';
export type { RoleRouter } from './role.js';
export { createDeptRouter, deptDeleteProcedureInputSchema } from './dept.js';
export type { DeptRouter, DeptProcedure } from './dept.js';
export { createAuditRouter } from './audit.js';
export type { AuditRouter, AuditProcedure } from './audit.js';
export { createReportRouter } from './report.js';
export type { ReportRouter, ReportProcedure } from './report.js';
export { createNotificationRouter, notificationIdProcedureInputSchema, updateNotificationProcedureInputSchema } from './notification.js';
export type { NotificationRouter, NotificationProcedure } from './notification.js';
export { createTransferRouter, transferProcedureInputSchema } from './transfer.js';
export type { TransferRouter, TransferProcedure } from './transfer.js';
