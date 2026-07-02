// apps/api/src/router/audit.ts —— procedure 表：每个 procedure = { input, handler, auth, permission }
// 输入经 Zod 校验（B1 router 层），handler 调 service。
// SEC-001：每个 procedure 必须声明 auth 元数据（操作日志查询全 admin）。
// SEC-001（TECH-AUDIT-001 扩展）：AuditProcedure 额外声明 permission（audit:read）。
// F4 append-only：router 仅注册 list procedure，**不注册 update/delete/patch/create**（HTTP 层无修改/删除/创建路由）。
// D1/D4：withAudit 高阶函数在此导出，供 user/role/dept router 包装写操作 handler（F1 跨域自动埋点）。
import { z } from 'zod';
import {
  listAuditLogQuerySchema,
  type AuditLogListResult,
  type AuditLogEntityType,
  type ChangeField,
} from '@admin/contracts';
import type { AuditLogService } from '../service/audit.js';
import type { Ctx } from '../context.js';
import type { Procedure } from './user.js';

export type { Procedure };

/**
 * 操作日志域 procedure 形状：在 Procedure 基础上追加 permission 元数据（SEC-001）。
 * permission 取 'audit:read'（查询操作日志 GET /v1/audit-logs 所需权限码）。
 */
export type AuditProcedure<I, O> = Procedure<I, O> & {
  permission: 'audit:read';
};

export type AuditRouter = {
  list: AuditProcedure<z.infer<typeof listAuditLogQuerySchema>, AuditLogListResult>;
};

/**
 * withAudit 元数据（D4）：描述被包装写操作的审计日志属性。
 * - entityType：目标实体类型（user/role/dept）
 * - action：写动作（create/update/delete）
 * - entityIdFromInput：无 entity 返回时（delete/remove → void entity）从 input 取 entity_id
 */
export type AuditMeta = {
  entityType: AuditLogEntityType;
  action: 'create' | 'update' | 'delete';
  entityIdFromInput?: (input: unknown) => string;
};

/**
 * withAudit 高阶函数（D1/D4）：包装写操作 handler，best-effort 旁路记审计日志。
 * [约束] handler 返回 WriteResult（{entity, changes, before?}），wrapper 提取 entity 返回给调用方（透明）。
 * [约束] 主操作成功后 best-effort 调 audit.record，异常吞掉不影响主操作成败（D1/CODE-002：catch 须非空）。
 * [约束] service 不感知 audit（ARCH-001：service 不 import AuditLogService），埋点在 router 层。
 * [advisory] operator_name MVP 桩：admin 桩下操作者恒为 'admin'（Ctx 无姓名字段，未来从 UserRepository 读）。
 * @param handler 写操作 handler，返回 WriteResult
 * @param audit AuditLogService 实例（旁路记日志）
 * @param meta 审计元数据（entityType / action / entityIdFromInput）
 * @returns 包装后的 handler，返回 entity（R['entity']）
 */
export function withAudit<I, R extends { entity: unknown; changes: ChangeField[]; before?: ChangeField[] }>(
  handler: (input: I, ctx: Ctx) => Promise<R>,
  audit: AuditLogService,
  meta: AuditMeta,
): (input: I, ctx: Ctx) => Promise<R['entity']> {
  return async (input, ctx) => {
    // 主操作先成功（异常直接抛出调用方）
    const { entity, changes, before } = await handler(input, ctx);
    // best-effort 旁路记审计日志（D1：异常吞掉，不影响主操作成败）
    try {
      const entityId = meta.entityIdFromInput
        ? meta.entityIdFromInput(input)
        : (entity as { id: string }).id;
      await audit.record(
        {
          operator_id: ctx.user.id,
          operator_name: 'admin', // [advisory] MVP 桩：admin 桩下操作者恒为 admin（Ctx 无姓名字段）
          entity_type: meta.entityType,
          entity_id: entityId,
          action: meta.action,
          operated_at: new Date().toISOString(),
          before: before ?? [],
          after: changes,
        },
        ctx,
      );
    } catch (e) {
      // best-effort：吞掉 audit 异常，不影响主操作成败（D1/CODE-002：catch 须非空且非仅 console）
      console.warn('audit record failed (best-effort, swallowed)', e);
    }
    return entity;
  };
}

/**
 * 创建操作日志路由。仅暴露 list procedure（F2 列表查询），
 * 复用 contracts 的 listAuditLogQuerySchema（含 pageSize transform 钳制）。
 */
export function createAuditRouter(service: AuditLogService): AuditRouter {
  return {
    list: {
      input: listAuditLogQuerySchema,
      handler: (input, ctx) => service.list(input, ctx),
      auth: 'admin',
      permission: 'audit:read',
    },
  };
}
