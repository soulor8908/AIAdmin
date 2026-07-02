// packages/contracts/src/schemas/transfer.ts —— 调岗事务契约 SSOT（TECH-TRANSFER-001）
// F1 调岗入参：userId + toDepartmentId + oldRoleId + newRoleId
// [约束] oldRoleId !== newRoleId（schema superRefine 检测 → TRANSFER_SAME_ROLE 由 service 层抛）
// [约束] 字段均为 uuid（userId/toDepartmentId/oldRoleId/newRoleId 引用各自域实体 id）
import { z } from 'zod';

/**
 * 调岗入参（F1）。
 * - userId：被调岗用户（须存在且 active）
 * - toDepartmentId：目标部门（须存在）
 * - oldRoleId：要移除的旧角色（须存在且非 builtin）
 * - newRoleId：要分配的新角色（须存在）
 * [约束] oldRoleId !== newRoleId（superRefine → TRANSFER_SAME_ROLE）
 * [advisory] toDepartmentId 允许等于当前部门（同部门换角色，PRD Q8 决策：接受）
 */
export const transferInputSchema = z
  .object({
    userId: z.string().uuid(),
    toDepartmentId: z.string().uuid(),
    oldRoleId: z.string().uuid(),
    newRoleId: z.string().uuid(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.oldRoleId === val.newRoleId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['newRoleId'],
        message: 'newRoleId 不能等于 oldRoleId（TRANSFER_SAME_ROLE）',
      });
    }
  });
export type TransferInput = z.infer<typeof transferInputSchema>;
