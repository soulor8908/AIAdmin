// apps/web/src/lib/errorMapping.ts —— ErrorCode→中文映射（TECH-WEB-AUTH-USER-001 §11 D11）
//
// 职责：
//   - mapErrorToMessage(code)：查映射表返回中文提示，未映射码返回通用"操作失败，请稍后重试"
//
// [约束] ARCH-003：leaf 层，仅 import @admin/contracts（ErrorCode 类型 + errorCodeSchema SSOT）。
// [约束] D11：映射表键从 [...errorCodeSchema.options] SSOT 派生（AI-005），禁止硬编码全集。
// [约束] AC-F7-2：各码中文提示见 Tech-Spec §11 矩阵。
import { errorCodeSchema, type ErrorCode } from '@admin/contracts';

/**
 * 已知具体提示（部分码，前端实际触发的子集）。
 * 对齐 Tech-Spec §11 错误矩阵。未列出的码使用 FALLBACK。
 * 此处仅列举前端实际遇到的码，全集由 [...errorCodeSchema.options] SSOT 派生（D11）。
 */
const SPECIFIC_MESSAGES: Partial<Record<ErrorCode, string>> = {
  VALIDATION_ERROR: '输入校验失败',
  FORBIDDEN: '无权限执行此操作',
  USER_NOT_FOUND: '用户不存在',
  USER_EMAIL_DUPLICATE: '邮箱已存在',
  USER_DISABLE_SELF_FORBIDDEN: '不能禁用自身账号',
  USER_ALREADY_DISABLED: '用户已是禁用状态',
  USER_ALREADY_ACTIVE: '用户已是启用状态',
  INVALID_CREDENTIALS: '邮箱或密码错误',
  TOKEN_INVALID: '登录已失效，请重新登录',
  TOKEN_EXPIRED: '登录已过期，请重新登录',
  TOKEN_REVOKED: '登录已失效，请重新登录',
  UNAUTHORIZED: '请先登录',
  VERSION_REQUIRED: '操作失败，请稍后重试',
  VERSION_CONFLICT: '数据已被修改，请刷新后重试',
};

/** 未映射码（其余 ROLE/DEPT/NOTIFICATION/TRANSFER 域等本轮不触发）通用提示。 */
const FALLBACK = '操作失败，请稍后重试';

/**
 * 错误码 → 中文用户提示映射表。
 * 键从 [...errorCodeSchema.options] SSOT 派生（AI-005），保证枚举扩展时不漏。
 * 已知码用具体提示，其余码用 FALLBACK（仍非空字符串，覆盖全集）。
 */
const ERROR_MESSAGES: Record<ErrorCode, string> = Object.fromEntries(
  [...errorCodeSchema.options].map((code) => [
    code,
    SPECIFIC_MESSAGES[code as ErrorCode] ?? FALLBACK,
  ]),
) as Record<ErrorCode, string>;

/**
 * ErrorCode → 中文用户提示。
 * 未映射码（ROLE/DEPT 域等）返回通用"操作失败，请稍后重试"（AC-F7-2）。
 */
export function mapErrorToMessage(code: ErrorCode): string {
  return ERROR_MESSAGES[code] ?? FALLBACK;
}
