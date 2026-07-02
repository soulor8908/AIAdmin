// apps/api/src/router/index.ts —— 聚合 router
import type { UserService } from '../service/user.js';
import { createUserRouter } from './user.js';

export function createRouter(service: UserService) {
  return {
    user: createUserRouter(service),
  };
}

export { createUserRouter, updateUserStatusProcedureInputSchema } from './user.js';
export type { Procedure, UserRouter } from './user.js';
