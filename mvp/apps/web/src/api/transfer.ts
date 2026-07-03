// apps/web/src/api/transfer.ts —— 调岗域 endpoint 封装（TECH-WEB-TRANSFER-INHERITANCE-001 §4.2.1）
//
// 职责：
//   - transferUser(input)：POST /v1/users/:userId/transfer（**非 versioned**，T4，不传 If-Match）
//     body={toDepartmentId, oldRoleId, newRoleId}（userId 在 path，对齐 server.ts buildInput path+body 合并）
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/client），禁止 import apps/api/src/**。
// [约束] D3：全部类型经 z.infer 派生自 contracts。
// [约束] D8：transfer 非 versioned（T4，server.ts L249-261 defineRoute 第 5 参缺省 false），不传 If-Match。
// [约束] R13 S-1：本文件为类型派生操作（input 类型经 z.infer 派生），不调 safeParse。
//                调用方（自由文本/选择器混合表单 TransferForm）负责 safeParse 校验后再传入。
// [约束] D17（R14 S-8）：函数命名对齐本 Spec §4.2.1 声明（transferUser）。
//
// [test-writer stub] AI-002 test-first：本文件为 stub，函数体抛 NOT_IMPLEMENTED，测试期断言级红
//   （api-transfer.test.ts mock global.fetch 期望 request 发出，stub 抛错 → fetch 未调用 → 断言失败）。
//   impl-writer 阶段落地真实实现（见 Spec §4.2.1 实现提示）。
import type { TransferInput } from '@admin/contracts';
import { request } from './client.js';

/**
 * POST /v1/users/:userId/transfer —— 调岗事务性单端点（**非 versioned**，T4，不传 If-Match）。
 * body={toDepartmentId, oldRoleId, newRoleId}（userId 在 path，对齐 server.ts buildInput path+body 合并风格）。
 * 事务失败抛 TRANSFER_FAILED（聚合码，message 含失败步骤+底层原因，T1）；校验阶段错误码
 * USER_NOT_FOUND/DEPT_NOT_FOUND/ROLE_NOT_FOUND/ROLE_BUILTIN_FORBIDDEN/TRANSFER_OLD_ROLE_NOT_ASSIGNED
 * 直接传播不聚合（T1）。前端无重试（非 versioned，无 409 重试路径，D8）。
 *
 * 注意：input 含 userId（用于拼 path），但 body 仅含 toDepartmentId/oldRoleId/newRoleId（T4）。
 */
export function transferUser(input: TransferInput): Promise<void> {
  return request<void>('POST', `/v1/users/${input.userId}/transfer`, {
    body: {
      toDepartmentId: input.toDepartmentId,
      oldRoleId: input.oldRoleId,
      newRoleId: input.newRoleId,
    },
  });
}
