// apps/web/src/api/auth.ts —— 鉴权域 endpoint 封装（TECH-WEB-AUTH-USER-001 §2 E1/E2）
//
// 职责（impl-writer 落地，本文件为 stub）：
//   - login(input)：POST /v1/auth/login（skipAuth=true，public 路由），返回 LoginResult
//   - logout()：POST /v1/auth/logout（Bearer 已注入，admin 路由），返回 LogoutResult
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/client），禁止 import apps/api/src/**。
// [约束] D3：LoginInput/LoginResult/LogoutResult 经 z.infer 派生自 contracts。
import type { LoginInput, LoginResult, LogoutResult } from '@admin/contracts';

/** POST /v1/auth/login —— skipAuth=true（login 路由 public，不注入 Bearer）。 */
export async function login(_input: LoginInput): Promise<LoginResult> {
  throw new Error('NOT_IMPLEMENTED');
}

/** POST /v1/auth/logout —— Bearer 已注入，后端将 token 加入黑名单。 */
export async function logout(): Promise<LogoutResult> {
  throw new Error('NOT_IMPLEMENTED');
}
