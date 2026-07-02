// packages/contracts/src/schemas/role-inheritance.ts —— 角色继承契约层（SSOT）
// 派生自 Tech-Spec TECH-ROLE-INHERITANCE-001（prd_ref: PRD-ROLE-INHERITANCE-001）。
// 约束：所有类型经 z.infer 派生，禁止手写 TS 类型副本（ARCH-002 / CODE-004）。
// 约束：错误码 SSOT 为 user.ts 的 errorCodeSchema（本文件不重复定义）；roleSchema 复用 role.ts。
import { z } from 'zod';
import { roleSchema, permissionCodeSchema } from './role.js';

/**
 * setParent 入参（F1）：roleId 设置其父角色为 parentRoleId。
 * [约束] roleId / parentRoleId 均为 uuid；superRefine 拒绝 roleId === parentRoleId（自继承）。
 * [约束] SEC-003a：.strict() 拒绝多余字段。
 * [约束] CODE-004：命名后缀 Schema。
 */
export const setParentInputSchema = z
  .object({
    roleId: z.string().uuid(),
    parentRoleId: z.string().uuid(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.roleId === val.parentRoleId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'parentRoleId 不能等于 roleId（自继承禁止）',
      });
    }
  });
export type SetParentInput = z.infer<typeof setParentInputSchema>;

/**
 * unsetParent 入参（F1）：roleId 解除其父角色（置 parent_role_id=null）。
 * [约束] SEC-003a：.strict()。
 */
export const unsetParentInputSchema = z
  .object({
    roleId: z.string().uuid(),
  })
  .strict();
export type UnsetParentInput = z.infer<typeof unsetParentInputSchema>;

/**
 * getInheritanceChain 入参（F2）：roleId 查询其祖先继承链。
 */
export const inheritanceChainInputSchema = z
  .object({
    roleId: z.string().uuid(),
  })
  .strict();
export type InheritanceChainInput = z.infer<typeof inheritanceChainInputSchema>;

/**
 * getInheritanceChain 返回（F2）：祖先角色数组（从直接父角色到根角色，按继承顺序）。
 * [约束] 根角色返回空数组 []（D7 / AC-F2-3）。
 */
export const inheritanceChainResultSchema = z.array(roleSchema);
export type InheritanceChainResult = z.infer<typeof inheritanceChainResultSchema>;

/**
 * getEffectivePermissions 入参（F3）：userId 查询其有效权限码集合（读时聚合）。
 */
export const effectivePermissionsInputSchema = z
  .object({
    userId: z.string().uuid(),
  })
  .strict();
export type EffectivePermissionsInput = z.infer<typeof effectivePermissionsInputSchema>;

/**
 * getEffectivePermissions 返回（F3）：用户有效权限码集合（直接角色 ∪ 沿继承链向上的父角色权限码并集）。
 * [约束] D3：读时聚合，不存储冗余副本。
 * [约束] Q7：去重（Set）+ 排序（sort）保证返回结果确定性。
 */
export const effectivePermissionsResultSchema = z.array(permissionCodeSchema);
export type EffectivePermissionsResult = z.infer<typeof effectivePermissionsResultSchema>;
