// apps/web/src/auth/AuthContext.tsx —— 登录态 Context + login/logout action（TECH-WEB-AUTH-USER-001 §5.1）
//
// 职责：
//   - state：{ isAuthenticated, token }（启动时从 tokenStore 读）
//   - action login(input)：调 api.auth.login → 成功 setToken + setState + navigate /users
//   - action logout()：调 api.auth.logout → 成功 clearToken + setState + navigate /login
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/auth + tokenStore），禁止 import apps/api/src/**。
// [约束] D12：token 经 tokenStore 存储，AuthContext 不直接操作 localStorage。
// [约束] §2.2 依赖方向：AuthContext 不 import pages/components（避免循环）。
// [约束] SEC-003b：token/password 不入日志（本模块不 console.log token 字符串）。
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LoginInput } from '@admin/contracts';
import { login as apiLogin, logout as apiLogout } from '../api/auth.js';
import { clearToken, getToken, setToken } from './tokenStore.js';

/** AuthContext 值类型。测试通过 AuthContext.Provider 注入此值（见 route-guard / login-page / user-list-page 测）。 */
export type AuthContextValue = {
  isAuthenticated: boolean;
  token: string | null;
  login: (input: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
};

/** Context 对象（createContext 为 setup，非实现逻辑；Provider/useAuth 抛 NOT_IMPLEMENTED）。 */
export const AuthContext = createContext<AuthContextValue | null>(null);

/** AuthProvider 组件：包裹应用，提供登录态 + login/logout action。须在 Router 上下文内（用 useNavigate）。 */
export function AuthProvider(props: { children: ReactNode }): JSX.Element {
  const navigate = useNavigate();
  const [state, setState] = useState<{ isAuthenticated: boolean; token: string | null }>(() => {
    const stored = getToken();
    return stored
      ? { isAuthenticated: true, token: stored.token }
      : { isAuthenticated: false, token: null };
  });

  const login = useCallback(
    async (input: LoginInput): Promise<void> => {
      const result = await apiLogin(input);
      setToken(result);
      setState({ isAuthenticated: true, token: result.token });
      navigate('/users', { replace: true });
    },
    [navigate],
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await apiLogout();
    } finally {
      // 即便后端 logout 失败（如网络错），仍清本地态并跳登录，避免卡在已失效登录态
      clearToken();
      setState({ isAuthenticated: false, token: null });
      navigate('/login', { replace: true });
    }
  }, [navigate]);

  const value = useMemo<AuthContextValue>(
    () => ({ isAuthenticated: state.isAuthenticated, token: state.token, login, logout }),
    [state.isAuthenticated, state.token, login, logout],
  );

  return <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>;
}

/** useAuth hook：读取 AuthContext。未在 AuthProvider 内调用 → 抛错（早暴露误用）。 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth 必须在 AuthProvider 内使用');
  }
  return ctx;
}
