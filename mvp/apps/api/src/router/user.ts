// apps/api/src/router/user.ts —— procedure 表：每个 procedure = { input, handler }
// 输入经 Zod 校验（B1 router 层），handler 调 service。
import { z } from 'zod';
import {
  createUserInputSchema,
  listUserQuerySchema,
  updateUserStatusInputSchema,
  type User,
  type UserListResult,
} from '@admin/contracts';
import type { UserService } from '../service/user.js';
import type { Ctx } from '../context.js';

/**
 * Procedure 形状。
 * input 用 z.ZodType<I, ZodTypeDef, unknown> 以兼容带 coerce/default 的 schema
 * （其 Input 类型与 Output 不一致，故第 3 参放宽为 unknown）。
 */
export type Procedure<I, O> = {
  input: z.ZodType<I, z.ZodTypeDef, unknown>;
  handler: (input: I, ctx: Ctx) => Promise<O>;
  auth: 'admin' | 'public';
};

/**
 * updateStatus procedure 入参 = path id (uuid) + body updateUserStatusInputSchema。
 * 单独导出以便契约测直接对该 schema 跑 safeParse。
 */
export const updateUserStatusProcedureInputSchema = z.object({
  id: z.string().uuid(),
  body: updateUserStatusInputSchema,
});

export type UserRouter = {
  list: Procedure<z.infer<typeof listUserQuerySchema>, UserListResult>;
  create: Procedure<z.infer<typeof createUserInputSchema>, User>;
  updateStatus: Procedure<z.infer<typeof updateUserStatusProcedureInputSchema>, User>;
};

export function createUserRouter(service: UserService): UserRouter {
  return {
    list: {
      input: listUserQuerySchema,
      handler: (input, ctx) => service.list(input, ctx),
      auth: 'admin',
    },
    create: {
      input: createUserInputSchema,
      handler: (input, ctx) => service.create(input, ctx),
      auth: 'admin',
    },
    updateStatus: {
      input: updateUserStatusProcedureInputSchema,
      handler: (input, ctx) => service.updateStatus(input.id, input.body.status, ctx),
      auth: 'admin',
    },
  };
}
