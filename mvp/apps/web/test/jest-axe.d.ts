// apps/web/test/jest-axe.d.ts —— jest-axe + vitest 类型桥接（TECH-ACCESSIBILITY-DEEPENING-001 D8 [advisory]）
//
// @types/jest-axe 3.5.9 仅 augment jest.Matchers（jest 全局命名空间），vitest 的 expect 类型经
// 独立 Assertion 接口（非 jest.Matchers），导致 `expect(x).toHaveNoViolations()` 在 vitest
// project 模式下 TS 报 "Property 'toHaveNoViolations' does not exist on type 'Assertion<...>'"。
// 运行时经 setup.ts 的 `expect.extend(toHaveNoViolations)` 正确注册 matcher（D8），此处仅补类型声明。
//
// [advisory] S-23 衍生（§7.2 / §10.6）：@types/jest-axe 版本略滞后（deps 声明 axe-core ^3.5.5，
// jest-axe 10.0.0 实际 deps axe-core 4.10.2），skipLibCheck=true 兼容不阻断编译。
// impl-writer 据实测发现 vitest Assertion 类型缺口，补本地 .d.ts augment（[advisory] 范围，§7.2 反向同步）。
import 'vitest';

declare module 'vitest' {
  interface Assertion {
    /** jest-axe matcher：断言 axe 扫描结果 0 WCAG violations（AC-A11y-7）。 */
    toHaveNoViolations(): void;
  }
}
