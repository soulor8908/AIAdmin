// apps/web/src/components/ErrorBanner.tsx —— 内联错误提示组件（TECH-WEB-AUTH-USER-001 §2.1）
//
// 职责（impl-writer 落地，本文件为 stub）：
//   - 渲染 message 文案（空则不渲染）
//
// [约束] ARCH-003：仅 import @admin/contracts（无下游依赖，leaf 组件）。
/** ErrorBanner 组件 props。message：错误提示文案（空则隐藏）。 */
export type ErrorBannerProps = {
  message: string | null;
};

/** ErrorBanner 组件。stub 抛 NOT_IMPLEMENTED（断言级红）。 */
export function ErrorBanner(_props: ErrorBannerProps): JSX.Element {
  throw new Error('NOT_IMPLEMENTED');
}
