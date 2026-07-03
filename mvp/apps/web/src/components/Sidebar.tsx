// apps/web/src/components/Sidebar.tsx —— 侧边栏导航（TECH-WEB-ROLE-DEPT-AUDIT-001 §6.8）
//
// 职责：
//   - 入口：用户（/users）、角色（/roles）、部门（/departments）、审计（/audit-logs）+ 登出按钮（Q8 决策①，AC-F8-1）
//   - 入口可达：点击跳转对应路由（AC-F8-2）
//   - 登出：调 useAuth().logout()（沿用 R12 AC-F6-2，AC-F8-4）
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（auth/AuthContext）+ react-router-dom。
// [约束] D16：侧边栏导航（Q8 决策①）。
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.js';

/** Sidebar 组件 props（无 props，用 useAuth + react-router Link）。 */
export type SidebarProps = Record<string, never>;

/** Sidebar 组件。4 入口（用户/角色/部门/审计）+ 登出按钮。 */
export function Sidebar(): JSX.Element {
  const { logout } = useAuth();
  return (
    <nav>
      <ul>
        <li>
          <Link to="/users">用户</Link>
        </li>
        <li>
          <Link to="/roles">角色</Link>
        </li>
        <li>
          <Link to="/departments">部门</Link>
        </li>
        <li>
          <Link to="/audit-logs">审计</Link>
        </li>
      </ul>
      <button type="button" onClick={() => logout()}>
        登出
      </button>
    </nav>
  );
}
