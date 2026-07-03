// apps/web/src/auth/tokenStore.ts —— localStorage token 读写（TECH-WEB-AUTH-USER-001 §5.1 D12）
//
// 职责（impl-writer 落地，本文件为 stub）：
//   - getToken()：读 localStorage key=admin_token，返回 {token, expires_at} | null
//   - setToken(result)：写 {token, expires_at}
//   - clearToken()：移除 key
//
// [约束] ARCH-003：leaf 层，仅 import @admin/contracts（LoginResult 类型），无下游依赖。
// [约束] D12：仅 localStorage，不写 sessionStorage/cookie（避免双重存储）。token 禁止 console.log。
// [约束] D6：api/client.ts 经此模块读 token（非 AuthContext），避免 api↔auth 循环依赖。
import type { LoginResult } from '@admin/contracts';

/** localStorage key（Q1 决策①）。 */
export const TOKEN_STORAGE_KEY = 'admin_token';

/** 存储结构：{token, expires_at}，与 LoginResult 一致。 */
export type StoredToken = { token: string; expires_at: string };

/** 读 token。无 token 返回 null（受保护路由后端返 401 → 拦截跳登录）。 */
export function getToken(): StoredToken | null {
  throw new Error('NOT_IMPLEMENTED');
}

/** 写 token（登录成功后调用）。 */
export function setToken(_result: LoginResult): void {
  throw new Error('NOT_IMPLEMENTED');
}

/** 清 token（登出 / 401 拦截时调用）。 */
export function clearToken(): void {
  throw new Error('NOT_IMPLEMENTED');
}
