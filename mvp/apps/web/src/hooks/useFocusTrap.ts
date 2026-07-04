// apps/web/src/hooks/useFocusTrap.ts —— modal 焦点陷阱 + ESC 关闭 + focus restore 共享 hook（TECH-ACCESSIBILITY-DEEPENING-001 D1/D5/D6）
//
// 职责（R23 AC-A11y-2/3/4）：
//   - focus trap：Tab/Shift+Tab 在 modal 内可聚焦元素间循环（首↔末），不逃逸到背景 DOM（WCAG 2.1.2 No Keyboard Trap）
//   - ESC 关闭：keydown Escape 触发 onClose（submitting 状态下阻止，对齐既有 onClose 按钮 disabled={submitting}，AC-A11y-2）
//   - focus restore：modal 关闭时 focus 回触发按钮（document.activeElement 记录于 hook 挂载时，AC-A11y-4，WCAG 2.4.3 Focus Order）
//   - 初次 focus：modal 打开后 focus 第一个可聚焦元素（AC-A11y-3）
//
// [约束] D1：自定义 hook（不引入 react-focus-lock，避免 S-23 第三次触发核验）
// [约束] D5：ESC 监听绑 modal 根元素（非 document），避免背景 DOM ESC 误触发
// [约束] D6：useRef 记录 document.activeElement + cleanup focus 回触发按钮
// [约束] R22 D3 协同：用 ref 缓存最新 onClose/submitting，避免 effect 频繁重建 listener（稳定引用，避免列表行 re-render）
// [约束] React.StrictMode 双调用 effect 幂等：triggerRef 记录 + cleanup focus restore 可重复执行（参照 R22 D2 ref 守卫模式）
import { useEffect, useRef } from 'react';

/** useFocusTrap 选项。onClose 为 optional 时（EffectivePermissionsPanel/InheritanceChainPanel）不启用 trap。 */
export interface UseFocusTrapOptions {
  /** ESC 触发的关闭回调（若 undefined 则不启用 trap，AC-A11y-2/4）。 */
  onClose?: (() => void) | undefined;
  /** 是否启用 trap（modal 是否打开，AC-A11y-3）。 */
  enabled: boolean;
  /** submitting 状态下阻止 ESC（对齐 onClose 按钮 disabled={submitting}，AC-A11y-2）。 */
  submitting: boolean;
}

/**
 * 查询 modal 内可聚焦元素（a[href] / button / input / select / textarea / [tabindex] 非 -1）。
 * 排除 disabled + 排除隐藏（offsetParent === null，WCAG 2.4.3 Focus Order）。
 */
function getFocusables(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.offsetParent !== null);
}

/**
 * modal 焦点陷阱 + ESC 关闭 + focus restore 共享 hook（D1/D5/D6）。
 *
 * @param rootRef modal 根元素 ref（role="dialog" 容器）
 * @param options onClose / enabled / submitting
 */
export function useFocusTrap(
  rootRef: React.RefObject<HTMLElement>,
  options: UseFocusTrapOptions,
): void {
  const { onClose, enabled, submitting } = options;
  // 用 ref 缓存最新 onClose/submitting，避免 effect 频繁重建 listener（R22 D3 useCallback 稳定引用协同）
  const onCloseRef = useRef(onClose);
  const submittingRef = useRef(submitting);
  onCloseRef.current = onClose;
  submittingRef.current = submitting;

  // 记录 modal 打开时的触发按钮（focus restore 目标，D6）
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!enabled) return;
    // onClose optional（EffectivePermissionsPanel/InheritanceChainPanel）：无 onClose 则不启用 trap/ESC
    if (!onCloseRef.current) return;
    const root = rootRef.current;
    if (!root) return;

    // 记录触发按钮（modal 打开前的焦点元素，D6）
    triggerRef.current = document.activeElement as HTMLElement | null;

    // 初次 focus 第一个可聚焦元素（AC-A11y-3）
    const focusables = getFocusables(root);
    focusables[0]?.focus();

    const handleKeyDown = (e: KeyboardEvent): void => {
      // ESC 关闭（submitting 阻止，AC-A11y-2，D5）
      if (e.key === 'Escape') {
        if (!submittingRef.current) {
          onCloseRef.current?.();
        }
        return;
      }
      if (e.key !== 'Tab') return;
      // Tab/Shift+Tab 循环（AC-A11y-3，WCAG 2.1.2 No Keyboard Trap）
      const current = getFocusables(root);
      if (current.length === 0) return;
      const first = current[0]!;
      const last = current[current.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    // ESC 监听绑 modal 根元素（非 document），避免背景 DOM ESC 误触发（D5）
    root.addEventListener('keydown', handleKeyDown);
    return () => {
      root.removeEventListener('keydown', handleKeyDown);
      // focus restore（D6，AC-A11y-4）：modal 关闭后 focus 回触发按钮
      const trigger = triggerRef.current;
      if (trigger && typeof trigger.focus === 'function') {
        trigger.focus();
      } else {
        // triggerRef 为 null 时回退 document.body.focus（非空指针，避免 focus 丢失到 <html>）
        document.body.focus();
      }
    };
  }, [enabled, rootRef]);
}
