// apps/web/src/pages/UserListPage.tsx —— F2/F3/F4 用户列表页（TECH-WEB-AUTH-USER-001 §6.2）
//
// 职责（impl-writer 落地，本文件为 stub）：
//   - 首次加载：api.users.list({page:1, pageSize:20})（D14，AC-F2-1）
//   - 渲染：每行 UserRow（name/email/status + 启停按钮 + version 隐藏用于 If-Match）
//   - 分页/筛选：改 state → useEffect 触发 list（AC-F2-2/3/4）
//   - 空状态："暂无用户"（AC-F2-5）；分页信息："共 X 条，第 Y/Z 页"（AC-F2-6）
//   - 加载态：loading 文案（AC-F2-7，D16）
//   - 启停：调 updateUserStatus（versioned=true, expectedVersion=user.version）
//     - VERSION_CONFLICT：client 自动重试（D9）；重试仍冲突显示"数据已被修改"（AC-F4-4）
//     - USER_DISABLE_SELF_FORBIDDEN：显示"不能禁用自身账号"（AC-F4-5）
//     - USER_ALREADY_DISABLED/ACTIVE：显示对应提示（AC-F4-6）
//   - 登出按钮：调 useAuth().logout()（AC-F6-2）
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/users + auth/AuthContext + components）。
// [约束] D3：User/UserListResult/ListUserQuery 经 z.infer 派生。
// [约束] §5.3：用 useState 管理本地状态，无 Redux/Zustand（D5）。
import type { User, UserListResult, ListUserQuery, UserStatus } from '@admin/contracts';

/** UserListPage 组件。stub 抛 NOT_IMPLEMENTED（断言级红）。 */
export function UserListPage(): JSX.Element {
  throw new Error('NOT_IMPLEMENTED');
}

/** 导出类型（contracts 派生），供测试引用。 */
export type { User, UserListResult, ListUserQuery, UserStatus };
