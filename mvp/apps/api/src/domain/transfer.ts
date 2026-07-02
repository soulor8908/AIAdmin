// apps/api/src/domain/transfer.ts —— 调岗事务校验纯函数（TECH-TRANSFER-001 §3.3 D3）
// ARCH-001：domain 不得 import 上层（service/repository/router），仅可 import @admin/contracts。
// 校验为纯逻辑（无 IO），归 domain 层；service 层负责查询 deps 快照注入 + 调用 + 抛 AppError。
// 校验顺序（D6，先到先返，不叠加）：
//   用户存在 → 用户 active → 目标部门存在 → 新角色存在 → 旧角色存在 → 旧角色非 builtin
//   → oldRoleId !== newRoleId → 用户已分配 oldRole
import type { ErrorCode, TransferInput } from '@admin/contracts';

/** 校验依赖快照（由 service 层查询注入，纯数据）。 */
export interface TransferValidationDeps {
  userExists: boolean;
  userActive: boolean;
  toDeptExists: boolean;
  newRoleExists: boolean;
  oldRoleExists: boolean;
  oldRoleBuiltin: boolean;
  userHasOldRole: boolean;
}

/** 校验结果：合法返回 ok，非法返回对应 ErrorCode。 */
export type ValidationResult = { ok: true } | { ok: false; errorCode: ErrorCode };

/**
 * 调岗校验纯函数（D3/D6）：按校验顺序先到先返。
 * [约束] 不读写 IO，纯逻辑判定；service 层预先查询 deps 快照注入。
 * [约束] oldRoleId===newRoleId 由 contracts schema superRefine 拦在前置（TRANSFER_SAME_ROLE），
 *        此处仍保留校验分支作 service 层二次守卫（防御 schema 未拦截的直调路径）。
 */
export function validateTransferInput(
  input: TransferInput,
  deps: TransferValidationDeps,
): ValidationResult {
  if (!deps.userExists) return { ok: false, errorCode: 'USER_NOT_FOUND' };
  if (!deps.userActive) return { ok: false, errorCode: 'USER_ALREADY_DISABLED' };
  if (!deps.toDeptExists) return { ok: false, errorCode: 'DEPT_NOT_FOUND' };
  if (!deps.newRoleExists) return { ok: false, errorCode: 'ROLE_NOT_FOUND' };
  if (!deps.oldRoleExists) return { ok: false, errorCode: 'ROLE_NOT_FOUND' };
  if (deps.oldRoleBuiltin) return { ok: false, errorCode: 'ROLE_BUILTIN_FORBIDDEN' };
  if (input.oldRoleId === input.newRoleId) return { ok: false, errorCode: 'TRANSFER_SAME_ROLE' };
  if (!deps.userHasOldRole) return { ok: false, errorCode: 'TRANSFER_OLD_ROLE_NOT_ASSIGNED' };
  return { ok: true };
}
