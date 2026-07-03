// apps/web/src/components/ErrorBanner.tsx —— 内联错误提示组件（TECH-WEB-AUTH-USER-001 §2.1）
//
// 职责：
//   - 渲染 message 文案（空则不渲染）
//
// [约束] ARCH-003：仅 import @admin/contracts（无下游依赖，leaf 组件）。
/** ErrorBanner 组件 props。message：错误提示文案（空则隐藏）。 */
export type ErrorBannerProps = {
  message: string | null;
};

/** ErrorBanner 组件。message 为空 → 返回 null（不渲染 DOM）；非空 → role="alert" 便于 a11y + 测试定位。 */
export function ErrorBanner(props: ErrorBannerProps): JSX.Element | null {
  if (!props.message) return null;
  return <div role="alert">{props.message}</div>;
}
