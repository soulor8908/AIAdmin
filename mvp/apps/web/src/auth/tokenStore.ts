// apps/web/src/auth/tokenStore.ts —— localStorage token 读写（TECH-WEB-AUTH-USER-001 §5.1 D12）
//
// 职责：
//   - getToken()：读 localStorage key=admin_token，返回 {token, expires_at} | null
//   - setToken(result)：写 {token, expires_at}
//   - clearToken()：移除 key
//
// [约束] ARCH-003：leaf 层，仅 import @admin/contracts（LoginResult 类型），无下游依赖。
// [约束] D12：仅 localStorage，不写 sessionStorage/cookie（避免双重存储）。token 禁止 console.log。
// [约束] D6：api/client.ts 经此模块读 token（非 AuthContext），避免 api↔auth 循环依赖。
// [约束] SEC-003b：token 不入日志（本模块不 console.log token 字符串）。
import type { LoginResult } from '@admin/contracts';

/** localStorage key（Q1 决策①）。 */
export const TOKEN_STORAGE_KEY = 'admin_token';

/** 存储结构：{token, expires_at}，与 LoginResult 一致。 */
export type StoredToken = { token: string; expires_at: string };

/** 读 token。无 token 返回 null（受保护路由后端返 401 → 拦截跳登录）。 */
export function getToken(): StoredToken | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'token' in parsed &&
      'expires_at' in parsed &&
      typeof (parsed as { token: unknown }).token === 'string' &&
      typeof (parsed as { expires_at: unknown }).expires_at === 'string'
    ) {
      return {
        token: (parsed as { token: string }).token,
        expires_at: (parsed as { expires_at: string }).expires_at,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** 写 token（登录成功后调用）。SEC-003b：不 console.log。 */
export function setToken(result: LoginResult): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(
      TOKEN_STORAGE_KEY,
      JSON.stringify({ token: result.token, expires_at: result.expires_at }),
    );
  } catch {
    // 写入失败（如 storage 满/禁用）静默降级，由后续 401 拦截处理。
  }
}

/** 清 token（登出 / 401 拦截时调用）。 */
export function clearToken(): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // 同上，静默降级。
  }
}
