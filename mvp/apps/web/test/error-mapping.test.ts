// apps/web/test/error-mapping.test.ts —— ③类新增错误映射单测（TECH-WEB-AUTH-USER-001 §9.3 #2）
//
// 覆盖 AC：AC-F7-2、AC-ARCH-4
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - 映射表键 SSOT 派生：用 [...errorCodeSchema.options] 遍历，禁止硬编码全集（AI-005，D11）。
//   - 期望「断言级红」：mapErrorToMessage() stub 抛 NOT_IMPLEMENTED，所有断言失败（非导入级红）。
//   - 各码中文提示对齐 Tech-Spec §11 边界矩阵 + PRD AC-F7-2。
import { describe, it, expect } from 'vitest';
import { errorCodeSchema, type ErrorCode } from '@admin/contracts';
import { mapErrorToMessage } from '../src/lib/errorMapping.js';

// SSOT 派生：从 contracts errorCodeSchema 取全集（AI-005，禁止硬编码）
const ALL_CODES = [...errorCodeSchema.options] as ErrorCode[];

describe('errorMapping mapErrorToMessage()', () => {
  // ---------- AI-005 SSOT 派生：映射表键覆盖 errorCodeSchema 全集 ----------
  it('映射表键覆盖 errorCodeSchema 全集（SSOT 派生，AI-005/D11，禁止硬编码）', () => {
    // 对每个 SSOT 码调用 mapErrorToMessage，应返回非空字符串（证明映射表含该键）
    for (const code of ALL_CODES) {
      const msg = mapErrorToMessage(code);
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(0);
    }
  });

  // ---------- AC-F7-2 各码中文提示 ----------
  it('INVALID_CREDENTIALS → "邮箱或密码错误"（AC-F1-2/3）', () => {
    expect(mapErrorToMessage('INVALID_CREDENTIALS')).toBe('邮箱或密码错误');
  });

  it('USER_EMAIL_DUPLICATE → "邮箱已存在"（AC-F3-2）', () => {
    expect(mapErrorToMessage('USER_EMAIL_DUPLICATE')).toBe('邮箱已存在');
  });

  it('USER_DISABLE_SELF_FORBIDDEN → "不能禁用自身账号"（AC-F4-5）', () => {
    expect(mapErrorToMessage('USER_DISABLE_SELF_FORBIDDEN')).toBe('不能禁用自身账号');
  });

  it('USER_ALREADY_DISABLED → 含"禁用"提示（AC-F4-6）', () => {
    expect(mapErrorToMessage('USER_ALREADY_DISABLED')).toContain('禁用');
  });

  it('USER_ALREADY_ACTIVE → 含"启用"提示（AC-F4-6）', () => {
    expect(mapErrorToMessage('USER_ALREADY_ACTIVE')).toContain('启用');
  });

  it('VERSION_CONFLICT → 含"数据已被修改"提示（AC-F4-4）', () => {
    expect(mapErrorToMessage('VERSION_CONFLICT')).toContain('数据已被修改');
  });

  // ---------- ①类显式影响（R14 D9 扩展）----------
  // [R14 impl-writer 改] 原 R12 断言：`expect(msg).toContain('操作失败')`（ROLE_NOT_FOUND 当年未映射→FALLBACK）。
  // R14 D9 扩展 SPECIFIC_MESSAGES 追加 ROLE_NOT_FOUND: '角色不存在'，ROLE_NOT_FOUND 不再走 FALLBACK。
  // 改 setup/断言 matcher 为 toContain('角色不存在') 以对齐扩展后映射（AI-002 已显式列出：受影响文件 +
  // 改动性质=断言 matcher 调整 + 理由=D9 扩展使 ROLE_NOT_FOUND 从 FALLBACK 升级为具体提示）。
  // Reviewer 确认：此为 test-writer 识别的 ①类显式影响，用户在 R14 任务中明确允许调整。
  it('ROLE_NOT_FOUND → "角色不存在"提示（R14 D9 扩展后从 FALLBACK 升级为具体提示，AC-F9-1）', () => {
    const msg = mapErrorToMessage('ROLE_NOT_FOUND');
    expect(msg).toContain('角色不存在');
  });
});
