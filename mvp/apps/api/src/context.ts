// apps/api/src/context.ts —— 调用上下文（模拟鉴权）
// 本 MVP 不接入真实 Auth；ctx.user 由上层注入，role 决定 SEC-002 越权校验结果。

/** 调用者身份。 */
export interface CtxUser {
  id: string;
  role: 'admin' | 'user';
}

/** 调用上下文：模拟已认证用户的请求级上下文。 */
export interface Ctx {
  user: CtxUser;
}
