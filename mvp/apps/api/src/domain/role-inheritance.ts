// apps/api/src/domain/role-inheritance.ts —— 角色继承领域层（纯函数无 IO）
// 派生自 Tech-Spec TECH-ROLE-INHERITANCE-001 §3.2 D2 + §3.4 D4。
// ARCH-001：domain 不得 import 上层（service/repository/router），仅可 import @admin/contracts 与同层 domain。
// CODE-001：detectCycle 用 RoleEntity | undefined 类型守卫，无 any。
// 与 role.ts 分离避免 role.ts 膨胀（D4，参考 transfer validateTransferInput 先例）。
import type { ErrorCode } from '@admin/contracts';
import type { RoleEntity } from './role.js';

/**
 * detectCycle 的依赖注入：findById 由 service 层注入（roleRepo.findById 的快照）。
 * 抽象为函数签名以保持纯函数性（domain 不直接 import repository）。
 */
export type FindRoleById = (id: string) => RoleEntity | undefined;

/**
 * 环检测结果（D2）。
 * - hasCycle=true 时 cyclePath 含从 parentRoleId 起到 roleId 形成环的完整路径（供错误 message 含 A→B→A）。
 * - hasCycle=false 时 cyclePath=undefined（无环或链中某角色不存在，上层须抛 ROLE_NOT_FOUND）。
 */
export type CycleDetectionResult = { hasCycle: true; cyclePath: string[] } | { hasCycle: false; cyclePath?: undefined };

/**
 * 环检测算法（D2 · 祖先遍历）：设置 parent_role_id 时，从 parentRoleId 开始向上遍历祖先链，
 * 若途中遇到 roleId 则形成环，拒绝（ROLE_INHERITANCE_CYCLE）。
 *
 * 算法（TECH-ROLE-INHERITANCE-001 §7）：
 *   path = [parentRoleId]
 *   current = findById(parentRoleId)
 *   while current !== undefined:
 *     if current.id === roleId: return { hasCycle: true, cyclePath: [...path, roleId] }
 *     if current.parent_role_id === null: return { hasCycle: false }  // 到达根角色，无环
 *     path.push(current.parent_role_id)
 *     current = findById(current.parent_role_id)
 *   return { hasCycle: false }  // 链中某角色不存在（数据不一致），视为非环（上层须抛 ROLE_NOT_FOUND）
 *
 * @param roleId 待设置父角色的角色 id（被设子角色）
 * @param parentRoleId 待设为父角色的角色 id（新父角色）
 * @param findById roleRepo.findById 的快照（service 注入）
 */
export function detectCycle(
  roleId: string,
  parentRoleId: string,
  findById: FindRoleById,
): CycleDetectionResult {
  const path: string[] = [parentRoleId];
  let current: RoleEntity | undefined = findById(parentRoleId);
  while (current !== undefined) {
    if (current.id === roleId) {
      return { hasCycle: true, cyclePath: [...path, roleId] };
    }
    if (current.parent_role_id === null) {
      return { hasCycle: false };
    }
    path.push(current.parent_role_id);
    current = findById(current.parent_role_id);
  }
  // current === undefined：链中某角色不存在（数据不一致），视为非环（上层须抛 ROLE_NOT_FOUND）
  return { hasCycle: false };
}

/**
 * validateSetParent 依赖快照（D4）：service 层预先查询注入，纯函数不读写 IO。
 * 与 transfer validateTransferInput 模式一致（R7 D3 先例）。
 */
export interface ValidateSetParentDeps {
  /** 目标角色是否存在（roleId） */
  roleExists: boolean;
  /** 父角色是否存在（parentRoleId） */
  parentExists: boolean;
  /** 目标角色是否为内置（roleId） */
  roleIsBuiltin: boolean;
  /** 父角色是否为内置（parentRoleId） */
  parentIsBuiltin: boolean;
  /** 新继承关系是否形成环（detectCycle 结果） */
  hasCycle: boolean;
}

/**
 * validateSetParent 校验纯函数（D4 · 先到先返，不叠加）。
 * 校验顺序（TECH-ROLE-INHERITANCE-001 §5）：
 *   1. 角色存在（roleId）→ ROLE_NOT_FOUND
 *   2. 父角色存在（parentRoleId）→ ROLE_NOT_FOUND
 *   3. 角色非内置（roleId）→ ROLE_BUILTIN_FORBIDDEN
 *   4. roleId !== parentRoleId → ROLE_SELF_INHERITANCE
 *   5. 父角色非内置（parentRoleId）→ ROLE_BUILTIN_PARENT_FORBIDDEN
 *   6. 环检测 → ROLE_INHERITANCE_CYCLE
 *
 * 注：自继承（roleId === parentRoleId）的 schema 层 superRefine 已在 router 入口拦截，
 *     此处保留冗余校验以防御 service 直调场景（service.setParent 不经 router）。
 *
 * @param input { roleId, parentRoleId }
 * @param deps 依赖快照（service 层注入）
 * @returns { ok: true } | { ok: false, errorCode }
 */
export function validateSetParent(
  input: { roleId: string; parentRoleId: string },
  deps: ValidateSetParentDeps,
): { ok: true } | { ok: false; errorCode: ErrorCode } {
  if (!deps.roleExists) return { ok: false, errorCode: 'ROLE_NOT_FOUND' };
  if (!deps.parentExists) return { ok: false, errorCode: 'ROLE_NOT_FOUND' };
  if (deps.roleIsBuiltin) return { ok: false, errorCode: 'ROLE_BUILTIN_FORBIDDEN' };
  if (input.roleId === input.parentRoleId) return { ok: false, errorCode: 'ROLE_SELF_INHERITANCE' };
  if (deps.parentIsBuiltin) return { ok: false, errorCode: 'ROLE_BUILTIN_PARENT_FORBIDDEN' };
  if (deps.hasCycle) return { ok: false, errorCode: 'ROLE_INHERITANCE_CYCLE' };
  return { ok: true };
}
