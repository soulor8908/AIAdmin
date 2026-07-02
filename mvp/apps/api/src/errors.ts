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

/** 错误码 → HTTP 状态映射（与 Tech-Spec §边界与异常 B 表一一对应）。 */
export const errorCodeToHttpStatus: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  USER_NOT_FOUND: 404,
  USER_EMAIL_DUPLICATE: 409,
  USER_DISABLE_SELF_FORBIDDEN: 403,
  USER_ALREADY_DISABLED: 409,
  USER_ALREADY_ACTIVE: 409,
};
