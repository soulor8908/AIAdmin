// apps/api/src/router/auth.ts —— 鉴权域 procedure 表
// TECH-AUTH-001 F1（login public）/ F4（logout admin）
// SEC-001：login 路由 auth:'public'（不携带 token 即可访问，进入 login 流程）；
//          logout 路由 auth:'admin'（须携带有效 Bearer token，buildCtx 验签后进入 handler）。
// [约束] logout handler 需要 token 字符串（加入黑名单），server.ts buildInput 从 Authorization header
//        提取 token 注入 input；buildCtx 独立验签同一 token 构造 Ctx。
import { z } from 'zod';
import { loginInputSchema, type LoginResult, type LogoutResult } from '@admin/contracts';
import type { AuthService } from '../service/auth.js';
import type { Ctx } from '../context.js';
import type { Procedure } from './user.js';

export type { Procedure };

/** logout 入参：从 Authorization header 提取的 token 字符串（server.ts buildInput 注入）。 */
export const logoutInputSchema = z.object({ token: z.string().min(1) }).strict();
export type LogoutInput = z.infer<typeof logoutInputSchema>;

export type AuthRouter = {
  login: Procedure<z.infer<typeof loginInputSchema>, LoginResult>;
  logout: Procedure<LogoutInput, LogoutResult>;
};

/**
 * 创建鉴权路由。
 * - login：auth:'public'，不携带 token 即可访问（AC-F1-5）
 * - logout：auth:'admin'，须携带有效 Bearer token（AC-F4-4）
 */
export function createAuthRouter(service: AuthService): AuthRouter {
  return {
    // public: 登录入口，无需 token 即可访问（SEC-001 / AC-F1-5）；凭证校验替代鉴权
    login: {
      input: loginInputSchema,
      handler: (input, ctx) => service.login(input, ctx),
      auth: 'public',
    },
    logout: {
      input: logoutInputSchema,
      handler: (input, ctx) => service.logout(input.token, ctx),
      auth: 'admin',
    },
  };
}
