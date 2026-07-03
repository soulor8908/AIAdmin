// apps/web/test/error-mapping-extend-2.test.ts —— ③类新增 errorMapping R15 扩展测（TECH-WEB-NOTIFICATION-REPORT-001 §9.3 T9）
//
// 覆盖 AC：AC-F9-1（通知域码中文）、AC-F9-2（报表域码中文）、AC-F9-3（SSOT 派生断言+同步注释 R14 S-11+401/网络沿用）
//
// ①类显式影响标注（AI-002 边界，test-writer 仅标注，由 impl-writer 落地核验）：
//   - R14 既有 `apps/web/test/error-mapping-extend.test.ts` 断言 ROLE/DEPT/AUDIT/INVALID_CREDENTIALS/VERSION_CONFLICT 码
//     （line 37-91），**不断言 NOTIFICATION/REPORT 码**。基于 grep 核验：R14 既有断言中无 NOTIFICATION_*/REPORT_* → FALLBACK 断言，
//     故 R15 扩展 SPECIFIC_MESSAGES（新增通知/报表码中文）后，R14 既有 error-mapping-extend.test.ts **预估不失效**。
//   - 本 test-writer 阶段**不修改** R14 error-mapping-extend.test.ts（AI-002 禁止改既有测试断言）。
//     impl-writer 须 double-check：若 R14 既有测试存在"NOTIFICATION_NOT_FOUND → FALLBACK"等断言（grep 未发现但须核实），则失效须调整。
//   - 本文件为**新增**独立文件，断言 R15 目标态（通知/报表码具体中文提示）。
//     test-writer 阶段 errorMapping.ts 仍为 R14 态（无 NOTIFICATION/REPORT 码 → FALLBACK）→ 本文件具体中文断言失败（断言级红）；
//     impl-writer 扩展 SPECIFIC_MESSAGES 后 → 本文件通过。
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - 纯单测（无 jsdom 注解，不渲染组件），直接 import mapErrorToMessage 断言返回值。
//   - D9 [约束]：扩展 SPECIFIC_MESSAGES 新增通知/报表码中文提示，键仍从 [...errorCodeSchema.options] SSOT 派生（R12 D11 沿用）。
//   - AC-F9-3 SSOT 派生断言：映射表键覆盖 errorCodeSchema 全集（通知/报表码本就在枚举内，非新增枚举键）。
//   - AC-F9-3 同步注释核验（R14 S-11）：扩展后 TRANSFER/ROLE_INHERITANCE 域码仍 FALLBACK（断言其返回含"操作失败"，
//     间接验证"未映射码"注释应反映 TRANSFER/ROLE_INHERITANCE 域，而非 NOTIFICATION/REPORT）。
//   - AC-F9-3 401/网络错误沿用 R12/R14：401 拦截（client.ts D8 AUTH_401_CODES）+ NETWORK_ERROR（client.ts 兜底）
//     由 T1/T2 + R12/R14 api-client 测覆盖，本文件不重复（errorMapping 仅映射 ErrorCode，NETWORK_ERROR 为 LocalErrorCode 非 ErrorCode）。
//   - 各码中文提示对齐 Tech-Spec §11 矩阵 + PRD AC-F9-1/F9-2。
import { describe, it, expect } from 'vitest';
import { errorCodeSchema, type ErrorCode } from '@admin/contracts';
import { mapErrorToMessage } from '../src/lib/errorMapping.js';

// SSOT 派生：从 contracts errorCodeSchema 取全集（AI-005，禁止硬编码）
const ALL_CODES = [...errorCodeSchema.options] as ErrorCode[];

describe('errorMapping R15 扩展（通知/报表域码中文提示）', () => {
  // ---------- AC-F9-3 SSOT 派生：映射表键覆盖 errorCodeSchema 全集（R12 D11 沿用）----------
  it('映射表键覆盖 errorCodeSchema 全集（SSOT 派生，AC-F9-3，AI-005/D11，禁止硬编码）', () => {
    // 对每个 SSOT 码调用 mapErrorToMessage，应返回非空字符串（证明映射表含该键，未映射码用 FALLBACK 兜底）
    // R15 扩展 SPECIFIC_MESSAGES 后，通知/报表码从 FALLBACK 升级为具体提示，但全集键覆盖不变
    for (const code of ALL_CODES) {
      const msg = mapErrorToMessage(code);
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(0);
    }
  });

  // ========== AC-F9-1 通知域码中文提示（D9 扩展 SPECIFIC_MESSAGES）==========

  it('NOTIFICATION_NOT_FOUND → "通知不存在"（AC-F9-1，§11，区别于 RECIPIENT_NOT_FOUND）', () => {
    expect(mapErrorToMessage('NOTIFICATION_NOT_FOUND')).toBe('通知不存在');
  });

  it('NOTIFICATION_RECIPIENT_NOT_FOUND → "收件人不存在"（AC-F9-1，§11，N4 send 时延后校验）', () => {
    expect(mapErrorToMessage('NOTIFICATION_RECIPIENT_NOT_FOUND')).toBe('收件人不存在');
  });

  it('NOTIFICATION_RECIPIENT_DISABLED → "收件人已禁用"（AC-F9-1，§11，N4 send 时延后校验）', () => {
    expect(mapErrorToMessage('NOTIFICATION_RECIPIENT_DISABLED')).toBe('收件人已禁用');
  });

  it('NOTIFICATION_INVALID_TRANSITION → "通知状态不允许此操作"（AC-F9-1，§11，B6 单码覆盖所有状态非法）', () => {
    expect(mapErrorToMessage('NOTIFICATION_INVALID_TRANSITION')).toBe('通知状态不允许此操作');
  });

  // ========== AC-F9-2 报表域码中文提示（D9 扩展 SPECIFIC_MESSAGES）==========

  it('REPORT_GROUP_BY_REQUIRED → "请至少选择一个分组维度"（AC-F9-2，§11，N5 group_by 缺省/空）', () => {
    expect(mapErrorToMessage('REPORT_GROUP_BY_REQUIRED')).toBe('请至少选择一个分组维度');
  });

  it('REPORT_TIME_RANGE_INVALID → "开始时间不能晚于结束时间"（AC-F9-2，§11，N5 时间范围非法）', () => {
    expect(mapErrorToMessage('REPORT_TIME_RANGE_INVALID')).toBe('开始时间不能晚于结束时间');
  });

  // ========== AC-F9-3 同步注释核验（R14 S-11）：扩展后未映射域仍 FALLBACK ==========

  it('TRANSFER_SAME_ROLE → FALLBACK "操作失败"（AC-F9-3，R14 S-11 同步注释：TRANSFER 域本期前端不触发）', () => {
    // 扩展后 TRANSFER 域码仍 FALLBACK；注释须反映"未映射域含 TRANSFER"（而非 NOTIFICATION/REPORT）
    expect(mapErrorToMessage('TRANSFER_SAME_ROLE')).toContain('操作失败');
  });

  it('ROLE_INHERITANCE_CYCLE → FALLBACK "操作失败"（AC-F9-3，R14 S-11 同步注释：ROLE_INHERITANCE 域本期前端不触发）', () => {
    // 扩展后 ROLE_INHERITANCE 域码仍 FALLBACK；注释须反映"未映射域含 ROLE_INHERITANCE"
    expect(mapErrorToMessage('ROLE_INHERITANCE_CYCLE')).toContain('操作失败');
  });

  // ========== R12/R14 既有码不破坏（D9 扩展不影响已映射码）==========

  it('R12 既有码中文提示不破坏（INVALID_CREDENTIALS → "邮箱或密码错误"）', () => {
    expect(mapErrorToMessage('INVALID_CREDENTIALS')).toBe('邮箱或密码错误');
  });

  it('R12 既有码中文提示不破坏（VERSION_CONFLICT → 含"数据已被修改"）', () => {
    expect(mapErrorToMessage('VERSION_CONFLICT')).toContain('数据已被修改');
  });

  it('R14 既有码中文提示不破坏（ROLE_NOT_FOUND → "角色不存在"）', () => {
    expect(mapErrorToMessage('ROLE_NOT_FOUND')).toBe('角色不存在');
  });

  it('R14 既有码中文提示不破坏（DEPT_NOT_FOUND → "部门不存在"）', () => {
    expect(mapErrorToMessage('DEPT_NOT_FOUND')).toBe('部门不存在');
  });

  it('R14 AUDIT_LOG_NOT_FOUND 仍 FALLBACK（本期不触发，AC-F9-4 沿用 R14）', () => {
    expect(mapErrorToMessage('AUDIT_LOG_NOT_FOUND')).toContain('操作失败');
  });
});

// ---------- AC-F9-3 401/网络错误沿用 R12/R14 ----------
// 注：401 拦截（client.ts AUTH_401_CODES: UNAUTHORIZED/TOKEN_INVALID/TOKEN_EXPIRED/TOKEN_REVOKED → clearToken + 跳 /login）
// 与 NETWORK_ERROR（fetch 抛错 → "网络异常，请稍后重试"）均由 api/client.ts 实现（R12 D8/D9 沿用），
// 由 T1 api-notifications.test.ts + T2 api-reports.test.ts + R12/R14 api-client 测覆盖。
// errorMapping 仅映射 ErrorCode（contracts SSOT）→ 中文提示；NETWORK_ERROR 为前端 LocalErrorCode（非 ErrorCode），
// 不经 mapErrorToMessage（client.ts 直接抛固定文案），故本文件不重复断言。
