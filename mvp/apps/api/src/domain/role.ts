// apps/api/src/domain/role.ts —— 领域层：常量 + 实体类型别名（纯函数无 IO）
// ARCH-001：domain 不得 import 上层（service/repository/router），仅可 import @admin/contracts。
// 角色无状态机（Tech-Spec §状态机），故本文件只产出领域常量与实体类型别名。
import { permissionCodeSchema, type Role, type UserRole, type PermissionCode } from '@admin/contracts';

/** 角色实体类型别名（与契约 roleSchema 的 Role 一致，SSOT 在 contracts，禁止手写副本）。 */
export type RoleEntity = Role;

/** 用户-角色关联实体类型别名（与契约 userRoleSchema 的 UserRole 一致）。 */
export type UserRoleEntity = UserRole;

/**
 * 内置 admin 角色名（F5/Q4）：系统初始化时幂等 seed 一条 name='admin' 的记录。
 * [约束] name 全局唯一，故 create 时与该名冲突 → ROLE_NAME_DUPLICATE。
 */
export const BUILTIN_ADMIN_ROLE_NAME = 'admin';

/**
 * 权限码全集：等于 permissionCodeSchema 枚举全体（Q4：内置 admin 持有全部权限码）。
 * 由 contracts 的枚举 SSOT 派生（advisory：启动时按枚举重算，避免枚举扩展时漂移）。
 * 枚举扩展时（随新模块 PRD）admin 的 permission_codes 自动覆盖。
 */
export const ALL_PERMISSION_CODES: PermissionCode[] = [...permissionCodeSchema.options];
