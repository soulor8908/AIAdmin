// packages/contracts/src/schemas/auth.ts —— 鉴权域契约层（SSOT）
// 派生自 Tech-Spec TECH-AUTH-001（prd_ref: PRD-AUTH-001）。
// 约束：所有类型经 z.infer 派生，禁止手写 TS 类型副本（ARCH-002 / CODE-004）。
// 约束：错误码 SSOT 为 user.ts 的 errorCodeSchema（跨域共享单一枚举），鉴权相关 4 码已追加其中；
//       本文件不重复定义 errorCodeSchema，避免 export * 重名冲突（详见 Tech-Spec §5.5）。
// 约束：输出 schema 带 .strict()（SEC-003a）；tokenPayloadSchema 为内部验签用，亦 .strict() 拒绝多余字段。
// 约束：不引入新依赖（token 验签用 node:crypto HMAC-SHA256，scrypt 密码哈希，PRD Q2/Q3 零新依赖）。

import { z } from 'zod';

/**
 * 登录入参（POST /v1/auth/login，F1）。
 * [约束] TECH-AUTH-001 D7 B1：email 用 z.string().email()；password 最低 8 位（PRD Q12 决策①）。
 * [约束] TECH-AUTH-001 D8：login 路由 auth:'public'（SEC-001 首个 public 落地），
 *        不携带 token 即可访问（AC-F1-5），缺失 Authorization 不触发 UNAUTHORIZED。
 * [约束] .strict() 拒绝多余字段（SEC-003a）。
 */
export const loginInputSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8),
  })
  .strict();
export type LoginInput = z.infer<typeof loginInputSchema>;

/**
 * 登录成功响应（200，F1）。
 * [约束] TECH-AUTH-001 D1：token 为 HMAC-SHA256 签名的不透明字符串
 *        （base64url(payload) + '.' + base64url(HMAC-SHA256(payload, AUTH_SECRET))，非空）。
 * [约束] TECH-AUTH-001 D1/Q6：expires_at 为 ISO datetime（token 过期时刻，iat + 3600s，1 小时）。
 * [约束] .strict()（SEC-003a），不含 password_hash 等敏感字段。
 */
export const loginResultSchema = z
  .object({
    token: z.string().min(1),
    expires_at: z.string().datetime(),
  })
  .strict();
export type LoginResult = z.infer<typeof loginResultSchema>;

/**
 * 登出成功响应（200，POST /v1/auth/logout，F4）。
 * [约束] TECH-AUTH-001 D4/D11：logout 路由 auth:'admin'，须携带有效 Bearer token；
 *        logout 将当前 token 加入内存黑名单，后续该校验 → TOKEN_REVOKED（401）。
 * [约束] .strict()（SEC-003a）。
 */
export const logoutResultSchema = z
  .object({
    success: z.literal(true),
  })
  .strict();
export type LogoutResult = z.infer<typeof logoutResultSchema>;

/**
 * Token payload（内部验签用，非 HTTP 输入/输出）。
 * [约束] TECH-AUTH-001 D1：token 结构 = base64url(payload_json) + '.' + base64url(HMAC-SHA256(payload, AUTH_SECRET))。
 * [约束] sub = 用户 id（uuid）；role = 'admin'|'user'；iat = 签发秒（unix）；exp = iat + 3600（1 小时，PRD Q6）。
 * [约束] 本 schema 仅供 server.ts 验签解析后校验 payload 结构，不经 HTTP 直接传输；仍 .strict() 拒绝多余字段。
 */
export const tokenPayloadSchema = z
  .object({
    sub: z.string().uuid(),
    role: z.enum(['admin', 'user']),
    iat: z.number().int(),
    exp: z.number().int(),
  })
  .strict();
export type TokenPayload = z.infer<typeof tokenPayloadSchema>;
