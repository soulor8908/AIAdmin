// apps/web/src/components/AppLayout.tsx —— 应用主布局（生产化阶段新增）
//
// 职责：
//   - 左侧固定 Sidebar（品牌 + 导航 + 登出）
//   - 顶部 Header（页面标题 + 用户态）
//   - 主内容区（children）
//
// 设计原则：
//   - 语义化 class（.app-layout / .app-sidebar / .app-header / .app-content）
//   - 样式经 CSS 变量派生自 index.css（单源可维护）
//   - 移动端响应式：暂不实现（admin 系统桌面优先），未来可加 sidebar collapse
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.js';

/** 侧边栏导航项配置（与路由表 1:1 对齐 App.tsx）。 */
const NAV_ITEMS: ReadonlyArray<{ to: string; label: string }> = [
  { to: '/users', label: '用户' },
  { to: '/roles', label: '角色' },
  { to: '/departments', label: '部门' },
  { to: '/audit-logs', label: '审计' },
  { to: '/notifications', label: '通知' },
  { to: '/reports', label: '报表' },
  { to: '/transfer', label: '调岗' },
];

/** 根据当前路径解析 Header 标题。 */
function resolveHeaderTitle(pathname: string): string {
  const item = NAV_ITEMS.find((n) => pathname.startsWith(n.to));
  return item?.label ?? '管理后台';
}

/** AppLayout 组件 props。 */
export type AppLayoutProps = {
  children: ReactNode;
};

/**
 * AppLayout —— 应用主布局。
 *
 * 左侧固定 Sidebar（含品牌 + 7 入口导航 + 登出按钮），顶部 sticky Header（当前页面标题），
 * 主内容区 children。仅在已登录路由渲染（RouteGuard 保证）。
 */
export function AppLayout({ children }: AppLayoutProps): JSX.Element {
  const { logout } = useAuth();
  const location = useLocation();
  const headerTitle = resolveHeaderTitle(location.pathname);

  return (
    <div className="app-layout">
      <aside className="app-sidebar">
        <div className="app-sidebar-brand">AIAdmin</div>
        <ul className="app-sidebar-nav">
          {NAV_ITEMS.map((item) => {
            const isActive = location.pathname.startsWith(item.to);
            return (
              <li key={item.to} className="app-sidebar-item">
                <Link
                  to={item.to}
                  className={`app-sidebar-link${isActive ? ' active' : ''}`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="app-sidebar-footer">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => logout()}
            style={{ width: '100%' }}
          >
            登出
          </button>
        </div>
      </aside>
      <div className="app-main">
        <header className="app-header">
          <h1 className="app-header-title">{headerTitle}</h1>
        </header>
        <main className="app-content">{children}</main>
      </div>
    </div>
  );
}

/** Toast 类型 + 全局 Toast 状态（极简实现，无 Context，用模块级订阅）。 */
export type ToastVariant = 'success' | 'error' | 'info';

/** Toast 项。 */
export type ToastItem = {
  id: number;
  message: string;
  variant: ToastVariant;
};

type ToastListener = (toasts: ToastItem[]) => void;

let toastSeq = 0;
let toastList: ToastItem[] = [];
const toastListeners = new Set<ToastListener>();

/** 推送一条 toast。variant 默认 info，3.5s 自动消失。 */
export function showToast(message: string, variant: ToastVariant = 'info'): void {
  const id = ++toastSeq;
  toastList = [...toastList, { id, message, variant }];
  toastListeners.forEach((l) => l(toastList));
  setTimeout(() => dismissToast(id), 3500);
}

/** 关闭一条 toast。 */
export function dismissToast(id: number): void {
  toastList = toastList.filter((t) => t.id !== id);
  toastListeners.forEach((l) => l(toastList));
}

/** ToastContainer —— 渲染全局 toast 列表（挂在 AppLayout 顶层）。 */
export function ToastContainer(): JSX.Element {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  useEffect(() => {
    const listener: ToastListener = (next) => setToasts(next);
    toastListeners.add(listener);
    return () => {
      toastListeners.delete(listener);
    };
  }, []);
  if (toasts.length === 0) return <></>;
  return (
    <div className="toast-container" role="region" aria-label="通知">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.variant}`} role={t.variant === 'error' ? 'alert' : 'status'}>
          <span>{t.message}</span>
          <button
            type="button"
            className="toast-close"
            aria-label="关闭"
            onClick={() => dismissToast(t.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

/** ConfirmDialog props。 */
export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * ConfirmDialog —— 危险操作二次确认弹窗。
 *
 * 用于删除角色 / 解除父角色 / 删除通知 / 调岗 等不可逆操作。
 * variant=danger 时确认按钮为红色，强化风险提示。
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  variant = 'primary',
  onConfirm,
  onCancel,
}: ConfirmDialogProps): JSX.Element | null {
  if (!open) return null;
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="modal" style={{ maxWidth: '400px' }}>
        <div className="modal-header">
          <h2 className="modal-title" id="confirm-title">
            {title}
          </h2>
        </div>
        <div className="modal-body">
          <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>{message}</p>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            {cancelText}
          </button>
          <button
            type="button"
            className={variant === 'danger' ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={onConfirm}
            autoFocus
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
