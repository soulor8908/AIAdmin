// apps/web/src/lib/errorMapping.ts —— ErrorCode→中文映射（TECH-WEB-AUTH-USER-001 §11 D11）
//
// 职责（impl-writer 落地，本文件为 stub）：
//   - mapErrorToMessage(code)：查映射表返回中文提示，未映射码返回通用"操作失败，请稍后重试"
//
// [约束] ARCH-003：leaf 层，仅 import @admin/contracts（ErrorCode 类型 + errorCodeSchema SSOT）。
// [约束] D11：映射表键从 [...errorCodeSchema.options] SSOT 派生（AI-005），禁止硬编码全集。
// [约束] AC-F7-2：各码中文提示见 Tech-Spec §11 矩阵。
//
// stub 说明：mapErrorToMessage() 抛 NOT_IMPLEMENTED（断言级红）。impl-writer 须用 SSOT 派生映射表。
import type { ErrorCode } from '@admin/contracts';

/**
 * ErrorCode → 中文用户提示。
 * impl-writer 须维护 Record<ErrorCode, string> 映射表，键从 [...errorCodeSchema.options] 派生（D11）。
 * 各码提示见 Tech-Spec §11 边界矩阵（INVALID_CREDENTIALS→"邮箱或密码错误" 等）。
 */
export function mapErrorToMessage(_code: ErrorCode): string {
  throw new Error('NOT_IMPLEMENTED');
}
