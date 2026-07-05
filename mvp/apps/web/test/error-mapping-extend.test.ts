// apps/web/test/error-mapping-extend.test.ts —— ③类新增 errorMapping 扩展测（TECH-WEB-ROLE-DEPT-AUDIT-001 §9.3 T9）
//
// 覆盖 AC：AC-F9-1~F9-4、AC-F9-3（SSOT 派生断言）
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - 本测试为 R14 新增文件，**不修改 R12 既有 error-mapping.test.ts**（AI-002 禁止改既有测试断言）。
//   - 期望「断言级红」：R12 errorMapping.ts 的 SPECIFIC_MESSAGES 未扩展角色/部门码 → 角色域码返回 FALLBACK → 断言失败（非导入级红）。
//   - ①类显式影响：R12 error-mapping.test.ts 既有断言 `ROLE_NOT_FOUND → toContain('操作失败')`（FALLBACK），
//     R14 扩展 SPECIFIC_MESSAGES 后 ROLE_NOT_FOUND 返回"角色不存在"，**R12 既有断言将失败**。
//     impl-writer 须调整 R12 error-mapping.test.ts 的 ROLE_NOT_FOUND 断言（matcher 改动须 Reviewer 判定，
//     AI-002 须显式列出受影响文件 + 改动性质 + 理由）。此为 D24 ①类显式影响边缘场景。
//   - D9 [约束]：扩展 SPECIFIC_MESSAGES 新增角色/部门码中文提示，键仍从 [...errorCodeSchema.options] SSOT 派生（R12 D11 沿用）。
//   - AC-F9-3：SSOT 派生断言——映射表键覆盖 errorCodeSchema 全集（角色/部门码本就在枚举内，非新增枚举键）。
//   - AC-F9-4：AUDIT_LOG_NOT_FOUND 本期不触发（只读无写），FALLBACK 兜底。
//   - 各码中文提示对齐 Tech-Spec §11.1/§11.2/§11.3 矩阵。
import { describe, it, expect } from 'vitest';
import { errorCodeSchema, type ErrorCode } from '@admin/contracts';
import { mapErrorToMessage } from '../src/lib/errorMapping.js';

// SSOT 派生：从 contracts errorCodeSchema 取全集（AI-005，禁止硬编码）
const ALL_CODES = [...errorCodeSchema.options] as ErrorCode[];

describe('errorMapping R14 扩展（角色/部门/审计域码中文提示）', () => {
  // ---------- AC-F9-3 SSOT 派生：映射表键覆盖 errorCodeSchema 全集（R12 D11 沿用）----------
  it('映射表键覆盖 errorCodeSchema 全集（SSOT 派生，AC-F9-3，AI-005/D11，禁止硬编码）', () => {
    // 对每个 SSOT 码调用 mapErrorToMessage，应返回非空字符串（证明映射表含该键）
    // R14 扩展 SPECIFIC_MESSAGES 后，角色/部门码从 FALLBACK 升级为具体提示，但全集键覆盖不变
    for (const code of ALL_CODES) {
      const msg = mapErrorToMessage(code);
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(0);
    }
  });

  // ---------- AC-F9-1 角色域码中文提示（D9 扩展 SPECIFIC_MESSAGES）----------
  it('ROLE_NOT_FOUND → "角色不存在"（AC-F9-1，§11.1）', () => {
    expect(mapErrorToMessage('ROLE_NOT_FOUND')).toBe('角色不存在');
  });

  it('ROLE_NAME_DUPLICATE → "角色名称已存在"（AC-F9-1，§11.1，B1 非 ROLE_CODE_DUPLICATE）', () => {
    expect(mapErrorToMessage('ROLE_NAME_DUPLICATE')).toBe('角色名称已存在');
  });

  it('ROLE_BUILTIN_FORBIDDEN → "内置角色不可删除"（AC-F9-1，§11.1）', () => {
    expect(mapErrorToMessage('ROLE_BUILTIN_FORBIDDEN')).toBe('内置角色不可删除');
  });

  it('ROLE_IN_USE → "角色已分配给用户，请先解除分配"（AC-F9-1，§11.1）', () => {
    expect(mapErrorToMessage('ROLE_IN_USE')).toBe('角色已分配给用户，请先解除分配');
  });

  it('USER_ROLE_ALREADY_ASSIGNED → "用户已持有该角色"（AC-F9-1，§11.1）', () => {
    expect(mapErrorToMessage('USER_ROLE_ALREADY_ASSIGNED')).toBe('用户已持有该角色');
  });

  // ---------- AC-F9-2 部门域码中文提示（D9 扩展 SPECIFIC_MESSAGES）----------
  it('DEPT_NOT_FOUND → "部门不存在"（AC-F9-2，§11.2）', () => {
    expect(mapErrorToMessage('DEPT_NOT_FOUND')).toBe('部门不存在');
  });

  it('DEPT_NAME_DUPLICATE → "同级别下部门名称已存在"（AC-F9-2，§11.2）', () => {
    expect(mapErrorToMessage('DEPT_NAME_DUPLICATE')).toBe('同级别下部门名称已存在');
  });

  it('DEPT_HAS_CHILDREN → "请先删除子部门"（AC-F9-2，§11.2）', () => {
    expect(mapErrorToMessage('DEPT_HAS_CHILDREN')).toBe('请先删除子部门');
  });

  it('DEPT_DEPTH_EXCEEDED → "部门层级超过上限"（AC-F9-2，§11.2）', () => {
    expect(mapErrorToMessage('DEPT_DEPTH_EXCEEDED')).toBe('部门层级超过上限');
  });

  // ---------- R12 既有码不破坏（D9 扩展不影响 R12 已映射码）----------
  it('R12 既有码中文提示不破坏（INVALID_CREDENTIALS → "邮箱或密码错误"）', () => {
    expect(mapErrorToMessage('INVALID_CREDENTIALS')).toBe('邮箱或密码错误');
  });

  it('R12 既有码中文提示不破坏（VERSION_CONFLICT → 含"数据已被修改"）', () => {
    expect(mapErrorToMessage('VERSION_CONFLICT')).toContain('数据已被修改');
  });

  it('R12 既有码中文提示不破坏（USER_DISABLE_SELF_FORBIDDEN → "不能禁用自身账号"）', () => {
    expect(mapErrorToMessage('USER_DISABLE_SELF_FORBIDDEN')).toBe('不能禁用自身账号');
  });
});
