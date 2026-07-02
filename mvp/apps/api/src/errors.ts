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
};
