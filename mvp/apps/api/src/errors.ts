// apps/api/src/errors.ts —— AppError 基类 + 错误码 → HTTP 映射
// 错误码取自 contracts 的 ErrorCode（SSOT）。
import type { ErrorCode } from '@admin/contracts';

/** 业务层统一错误：携带 ErrorCode，供 router/上层转 errorResponseSchema。 */
export class AppError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

/**
 * 错误码 → HTTP 状态映射（Record<ErrorCode, number> 穷举，新增码必须补齐）。
 * user 域对齐 TECH-USER-001 §边界与异常；role 域对齐 TECH-ROLE-001 §边界与异常。
 */
export const errorCodeToHttpStatus: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  USER_NOT_FOUND: 404,
  USER_EMAIL_DUPLICATE: 409,
  USER_DISABLE_SELF_FORBIDDEN: 403,
  USER_ALREADY_DISABLED: 409,
  USER_ALREADY_ACTIVE: 409,
  // 角色域（TECH-ROLE-001）
  ROLE_NOT_FOUND: 404,
  ROLE_NAME_DUPLICATE: 409,
  ROLE_BUILTIN_FORBIDDEN: 403,
  ROLE_IN_USE: 409,
  USER_ROLE_ALREADY_ASSIGNED: 409,
  // 部门域（TECH-DEPT-001）
  DEPT_NOT_FOUND: 404,
  DEPT_NAME_DUPLICATE: 409,
  DEPT_HAS_CHILDREN: 409,
  DEPT_HAS_USERS: 409, // [advisory] 预留码（B11 本期不触发），仍穷举映射以维持 Record<ErrorCode>
  DEPT_DEPTH_EXCEEDED: 409,
  // 操作日志域（TECH-AUDIT-001）
  AUDIT_LOG_NOT_FOUND: 404, // [advisory] 预留码（B4 本期不触发），仍穷举映射以维持 Record<ErrorCode>
  // 报表域（TECH-AUDIT-ENHANCEMENT-001，D10：校验层语义判定 → 400）
  REPORT_GROUP_BY_REQUIRED: 400,
  REPORT_TIME_RANGE_INVALID: 400,
  // 通知域（TECH-NOTIFICATION-001，§6 边界与异常）
  NOTIFICATION_NOT_FOUND: 404, // B5 通知不存在（区别于 B7 收件人不存在）
  NOTIFICATION_RECIPIENT_NOT_FOUND: 404, // B7 send 时收件人不存在
  NOTIFICATION_RECIPIENT_DISABLED: 409, // B8 send 时收件人禁用（收件人状态冲突，与 USER_ALREADY_* 409 同层级）
  NOTIFICATION_INVALID_TRANSITION: 409, // B6 状态转移/状态守卫操作非法（与 USER_ALREADY_* 409 同层级）
  // 调岗事务域（TECH-TRANSFER-001）
  TRANSFER_SAME_ROLE: 400, // oldRoleId===newRoleId 语义冲突（避免无意义操作）
  TRANSFER_OLD_ROLE_NOT_ASSIGNED: 409, // 用户未分配 oldRole（前置状态不满足）
  TRANSFER_COMPENSATION_FAILED: 500, // 补偿回滚失败（数据一致性告警）
  TRANSFER_FAILED: 500, // 执行阶段失败已回滚（聚合错误码）
  // 角色继承域（TECH-ROLE-INHERITANCE-001）
  ROLE_SELF_INHERITANCE: 400, // 自继承语义冲突（与 TRANSFER_SAME_ROLE 同层）
  ROLE_BUILTIN_PARENT_FORBIDDEN: 403, // 父角色为内置 admin（与 ROLE_BUILTIN_FORBIDDEN 同层）
  ROLE_INHERITANCE_CYCLE: 409, // 继承关系形成环（结构冲突，与 ROLE_IN_USE 同层）
  ROLE_HAS_CHILDREN: 409, // 删除守卫 B8（结构冲突，与 ROLE_IN_USE 同层）
};
