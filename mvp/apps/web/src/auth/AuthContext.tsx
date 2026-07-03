// apps/web/src/auth/AuthContext.tsx —— 登录态 Context + login/logout action（TECH-WEB-AUTH-USER-001 §5.1）
//
// 职责（impl-writer 落地，本文件为 stub）：
//   - state：{ isAuthenticated, token }（启动时从 tokenStore 读）
//   - action login(input)：调 api.auth.login → 成功 setToken + setState + navigate /users
//   - action logout()：调 api.auth.logout → 成功 clearToken + setState + navigate /login
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/auth + tokenStore），禁止 import apps/api/src/**。
// [约束] D12：token 经 tokenStore 存储，AuthContext 不直接操作 localStorage。
// [约束] §2.2 依赖方向：AuthContext 不 import pages/components（避免循环）。
import { createContext } from 'react';
import type { ReactNode } from 'react';
import type { LoginInput } from '@admin/contracts';

/** AuthContext 值类型。impl-writer 须保证 login/logout action 签名一致。 */
export type AuthContextValue = {
  isAuthenticated: boolean;
  token: string | null;
  login: (input: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
};

/** Context 对象（createContext 为 setup，非实现逻辑；Provider/useAuth 抛 NOT_IMPLEMENTED）。 */
export const AuthContext = createContext<AuthContextValue | null>(null);

/** AuthProvider 组件：包裹应用，提供登录态。stub 抛 NOT_IMPLEMENTED。 */
export function AuthProvider(_props: { children: ReactNode }): JSX.Element {
  throw new Error('NOT_IMPLEMENTED');
}

/** useAuth hook：读取 AuthContext。stub 抛 NOT_IMPLEMENTED。 */
export function useAuth(): AuthContextValue {
  throw new Error('NOT_IMPLEMENTED');
}
