// apps/web/src/api/auth.ts —— 鉴权域 endpoint 封装（TECH-WEB-AUTH-USER-001 §2 E1/E2）
//
// 职责：
//   - login(input)：POST /v1/auth/login（skipAuth=true，public 路由），返回 LoginResult
//   - logout()：POST /v1/auth/logout（Bearer 已注入，admin 路由），返回 LogoutResult
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/client），禁止 import apps/api/src/**。
// [约束] D3：LoginInput/LoginResult/LogoutResult 经 z.infer 派生自 contracts。
// [约束] D6：login 用 skipAuth=true（不注入 Bearer，public 路由）；logout 经 client 自动注入 Bearer。
import type { LoginInput, LoginResult, LogoutResult } from '@admin/contracts';
import { request } from './client.js';

/** POST /v1/auth/login —— skipAuth=true（login 路由 public，不注入 Bearer，AC-F1-5）。 */
export function login(input: LoginInput): Promise<LoginResult> {
  return request<LoginResult>('POST', '/v1/auth/login', { body: input, skipAuth: true });
}

/** POST /v1/auth/logout —— Bearer 经 client 自动注入，后端将 token 加入黑名单（TOKEN_REVOKED）。 */
export function logout(): Promise<LogoutResult> {
  return request<LogoutResult>('POST', '/v1/auth/logout', {});
}
