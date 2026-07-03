// apps/api/test/report.test.ts —— 测试先行（AI-002，test-writer 先于 impl-writer 产出）
// 覆盖 Tech-Spec TECH-AUDIT-ENHANCEMENT-001 §报表聚合契约（F2）测试矩阵：
//   1. 契约测 · reportQuerySchema safeParse（group_by 维度枚举/去重/可选/上限、时间范围、分页默认与钳制）
//   2. 契约测 · reportResultSchema / reportAggItemSchema safeParse（items 形状、count 非负、.strict）
//   3. 聚合测 · 单维 group by（operator_id / entity_type / action / date 各一组）
//   4. 聚合测 · 多维交叉 group by（2/3/4 维组合）
//   5. 聚合测 · date 桶（同日不同时刻聚到同桶，slice(0,10) UTC 自然日）
//   6. 聚合测 · 排序（count 降序 + 维度值升序 tiebreaker）
//   7. 聚合测 · 时间范围过滤（from/to 闭区间）+ 维度过滤（operator_id/entity_type/action）
//   8. 聚合测 · 空结果（无审计日志 → items=[]/total=0/totalPages=0）
//   9. 聚合测 · 分页（page/pageSize）
//  10. 权限测 · 非 admin → FORBIDDEN
//  11. 错误码测 · group_by 缺失 → REPORT_GROUP_BY_REQUIRED；时间范围无效 → REPORT_TIME_RANGE_INVALID
//  12. SSOT 派生（AI-005）· 维度全集/权限码全集/错误码全集用 [...schema.options] 派生，禁硬编码
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - ReportService 构造签名：`new ReportService(auditRepo)`；依赖 AuditLogRepository.listAll(filter) 读全量（无独立 repo）。
//   - AuditLogRepository 新增 `listAll(filter): AuditLog[]`（无分页，仅过滤），与既有 list(opts) 共用过滤逻辑。
//   - ReportService 方法：`query(query: ReportQuery, ctx): Promise<ReportResult>`；入口 requirePermission('report:read')。
//   - admin 桩下 ctx.user.role==='admin' 视为具备 report:read；非 admin → FORBIDDEN（spec §3.3 advisory）。
//   - router 导出：createReportRouter / ReportProcedure 类型；query procedure 复用 contracts 的 reportQuerySchema。
//   - ReportProcedure<I, O> = Procedure<I, O> & { permission: 'report:read' }（SEC-001 元数据）。
//   - D10 决策：reportQuerySchema.group_by 为 z.array(reportGroupByDimSchema).max(4).optional()（不在 schema 层 .min(1) 拒绝空）；
//     router 层在 safeParse 后语义判定：group_by 缺省/空 → REPORT_GROUP_BY_REQUIRED；
//     schema superRefine 做 维度去重 + 时间范围检测，router 据 error.issues 区分 → REPORT_TIME_RANGE_INVALID，其余 → VALIDATION_ERROR。
//   - 聚合算法 D9：listAll(过滤) → 内存 group by + date 桶(operated_at.slice(0,10)) → count 降序 + 维度值升序 → 分页切片。
//   - 空结果 items=[]/total=0/totalPages=0（不报错，PRD Q11）。
//   - pageSize transform 钳制（≤100），返回结果 pageSize 反映钳制后值。
//   - 报表维度均为非 PII 字段，仅返回计数，不涉及 PII 脱敏（PRD F2 末条）。
import { describe, it, expect } from 'vitest';
import {
  reportGroupByDimSchema,
  reportQuerySchema,
  reportResultSchema,
  reportAggItemSchema,
  permissionCodeSchema,
  errorCodeSchema,
  auditLogEntityTypeSchema,
  auditLogActionSchema,
  type ReportQuery,
  type ReportResult,
  type ReportGroupByDim,
  type AuditLog,
  type AuditLogEntityType,
  type AuditLogAction,
  type ChangeField,
  type ErrorCode,
} from '@admin/contracts';
import { AuditLogRepository } from '../src/repository/audit.js';
import { ReportService } from '../src/service/report.js';
import { createTestDb } from './helpers/db.js';
import { createReportRouter, type ReportProcedure } from '../src/router/report.js';
import { AppError } from '../src/errors.js';
import type { Ctx } from '../src/context.js';
import type { Procedure } from '../src/router/user.js';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const OP2_ID = '00000000-0000-4000-8000-000000000002';
const OP3_ID = '00000000-0000-4000-8000-000000000003';
const PLAIN_USER_ID = '00000000-0000-4000-8000-000000000099';
const SEED_TS = '2020-01-01T00:00:00.000Z';

const adminCtx: Ctx = { user: { id: ADMIN_ID, role: 'admin' } };
const userCtx: Ctx = { user: { id: PLAIN_USER_ID, role: 'user' } };

function setup(): {
  auditRepo: AuditLogRepository;
  service: ReportService;
  router: ReturnType<typeof createReportRouter>;
} {
  const auditRepo = new AuditLogRepository(createTestDb());
  const service = new ReportService(auditRepo);
  const router = createReportRouter(service);
  return { auditRepo, service, router };
}

/** 构造一条 AuditLog（ChangeField[] 形态 before/after，F3 结构化快照）。 */
function makeLog(i: number, overrides: Partial<AuditLog> = {}): AuditLog {
  return {
    id: `30000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    operator_id: ADMIN_ID,
    operator_name: 'admin',
    entity_type: 'user',
    entity_id: `00000000-0000-4000-8000-${String(i + 1000).padStart(12, '0')}`,
    action: 'create',
    operated_at: `2024-01-${String((i % 28) + 1).padStart(2, '0')}T10:00:00.000Z`,
    before: [],
    after: [
      { field: 'email', value: 'abcdef@example.com', pii: true },
      { field: 'name', value: `user${i}`, pii: false },
    ],
    created_at: SEED_TS,
    ...overrides,
  };
}

/** 构造 ChangeField[] 便捷工厂（report 聚合不关心 before/after 内容，仅用最小合法形态）。 */
function makeFields(...fields: Array<{ field: string; value: ChangeField['value']; pii?: boolean }>): ChangeField[] {
  return fields.map((f) => ({ field: f.field, value: f.value, pii: f.pii ?? false }));
}

/**
 * 模拟 router 层执行 report.query：procedure.input 经 safeParse（D10 下 group_by optional，
 * 故空/缺省 group_by 通过 schema），handler 内部做语义判定 + 调 service。
 * 注意：report.query 的 handler 在内部做 reportQuerySchema.safeParse + 语义判定（D10），
 * 故 callProc 的预解析仅做轻校验（loose），真正解析在 handler 内。
 */
async function callProc<I, O>(proc: Procedure<I, O>, raw: unknown, ctx: Ctx): Promise<O> {
  const parsed = proc.input.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', parsed.error.message);
  }
  return proc.handler(parsed.data, ctx);
}

async function expectAppError(promise: Promise<unknown>, code: ErrorCode): Promise<void> {
  const err = await promise.then(
    () => {
      throw new Error(`期望抛出 ${code}，但 Promise 已 resolve`);
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  if (err instanceof AppError) {
    expect(err.code).toBe(code);
  }
}

// ---------------------------------------------------------------------------
// 1. 契约测 · reportQuerySchema safeParse
// ---------------------------------------------------------------------------
describe('契约测 · reportQuerySchema safeParse（D10 group_by optional + superRefine）', () => {
  it('合法样本通过（group_by 单维 + 默认分页）', () => {
    const r = reportQuerySchema.safeParse({ group_by: ['entity_type'] });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.group_by).toEqual(['entity_type']);
      expect(r.data.page).toBe(1);
      expect(r.data.pageSize).toBe(20);
    }
  });

  it('group_by optional：缺省 group_by 通过 schema（D10，router 层后判 REPORT_GROUP_BY_REQUIRED）', () => {
    const r = reportQuerySchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.group_by).toBeUndefined();
    }
  });

  it('group_by 空数组通过 schema（D10：max(4) 允许空，router 层后判 REPORT_GROUP_BY_REQUIRED）', () => {
    const r = reportQuerySchema.safeParse({ group_by: [] });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.group_by).toEqual([]);
    }
  });

  it('group_by 含非法维度 → schema 拒绝（VALIDATION_ERROR）', () => {
    expect(reportQuerySchema.safeParse({ group_by: ['unknown_dim'] }).success).toBe(false);
  });

  it('group_by 重复维度 → superRefine 拒绝（去重校验）', () => {
    const r = reportQuerySchema.safeParse({ group_by: ['operator_id', 'operator_id'] });
    expect(r.success).toBe(false);
  });

  it('group_by 4 维上限通过（max(4)）', () => {
    const r = reportQuerySchema.safeParse({
      group_by: ['operator_id', 'entity_type', 'action', 'date'],
    });
    expect(r.success).toBe(true);
  });

  it('group_by 5 维超限 → schema 拒绝（max(4)）', () => {
    const r = reportQuerySchema.safeParse({
      group_by: ['operator_id', 'entity_type', 'action', 'date', 'operator_id'],
    });
    expect(r.success).toBe(false);
  });

  it('group_by 各合法维度均通过（SSOT 派生遍历，AI-005）', () => {
    for (const dim of reportGroupByDimSchema.options) {
      expect(reportQuerySchema.safeParse({ group_by: [dim] }).success).toBe(true);
    }
  });

  it('operated_from 非 datetime → schema 拒绝', () => {
    expect(
      reportQuerySchema.safeParse({
        group_by: ['date'],
        operated_from: '2024-01-01',
      }).success,
    ).toBe(false);
  });

  it('operated_to 非 datetime → schema 拒绝', () => {
    expect(
      reportQuerySchema.safeParse({
        group_by: ['date'],
        operated_to: 'not-a-date',
      }).success,
    ).toBe(false);
  });

  it('operated_from 晚于 operated_to → superRefine 拒绝（router 层后判 REPORT_TIME_RANGE_INVALID）', () => {
    const r = reportQuerySchema.safeParse({
      group_by: ['date'],
      operated_from: '2024-12-31T00:00:00.000Z',
      operated_to: '2024-01-01T00:00:00.000Z',
    });
    expect(r.success).toBe(false);
  });

  it('operated_from == operated_to 通过（闭区间边界相等合法）', () => {
    const r = reportQuerySchema.safeParse({
      group_by: ['date'],
      operated_from: '2024-01-01T00:00:00.000Z',
      operated_to: '2024-01-01T00:00:00.000Z',
    });
    expect(r.success).toBe(true);
  });

  it('operator_id 非 uuid → schema 拒绝', () => {
    expect(
      reportQuerySchema.safeParse({
        group_by: ['operator_id'],
        operator_id: 'not-uuid',
      }).success,
    ).toBe(false);
  });

  it('entity_type 非闭合枚举 → schema 拒绝', () => {
    expect(
      reportQuerySchema.safeParse({
        group_by: ['entity_type'],
        entity_type: 'unknown',
      }).success,
    ).toBe(false);
  });

  it('action 非闭合枚举 → schema 拒绝', () => {
    expect(
      reportQuerySchema.safeParse({
        group_by: ['action'],
        action: 'unknown',
      }).success,
    ).toBe(false);
  });

  it('entity_type 各合法值通过（SSOT 派生遍历，AI-005）', () => {
    for (const t of auditLogEntityTypeSchema.options) {
      expect(
        reportQuerySchema.safeParse({ group_by: ['entity_type'], entity_type: t }).success,
      ).toBe(true);
    }
  });

  it('action 各合法值通过（SSOT 派生遍历，AI-005）', () => {
    for (const a of auditLogActionSchema.options) {
      expect(reportQuerySchema.safeParse({ group_by: ['action'], action: a }).success).toBe(true);
    }
  });

  it('page=0 → schema 拒绝（min 1）', () => {
    expect(reportQuerySchema.safeParse({ group_by: ['date'], page: 0 }).success).toBe(false);
  });

  it('pageSize=0 → schema 拒绝（min 1）', () => {
    expect(reportQuerySchema.safeParse({ group_by: ['date'], pageSize: 0 }).success).toBe(false);
  });

  it('pageSize=200 → transform 钳制为 100（非拒绝，与 audit 列表查询一致）', () => {
    const r = reportQuerySchema.safeParse({ group_by: ['date'], pageSize: 200 });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.pageSize).toBe(100);
    }
  });

  it('page/pageSize 默认值：缺省 → page=1 pageSize=20', () => {
    const r = reportQuerySchema.safeParse({ group_by: ['date'] });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.page).toBe(1);
      expect(r.data.pageSize).toBe(20);
    }
  });

  it('page/pageSize coerce 兼容字符串透传（query string 场景）', () => {
    const r = reportQuerySchema.safeParse({ group_by: ['date'], page: '2', pageSize: '50' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.page).toBe(2);
      expect(r.data.pageSize).toBe(50);
    }
  });

  it('合法全维度样本通过（含全部过滤维度 + 时间范围）', () => {
    expect(
      reportQuerySchema.safeParse({
        group_by: ['operator_id', 'entity_type', 'action', 'date'],
        operated_from: '2024-01-01T00:00:00.000Z',
        operated_to: '2024-12-31T23:59:59.000Z',
        operator_id: ADMIN_ID,
        entity_type: 'user',
        action: 'create',
        page: 2,
        pageSize: 50,
      }).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. 契约测 · reportResultSchema / reportAggItemSchema safeParse
// ---------------------------------------------------------------------------
describe('契约测 · reportResultSchema / reportAggItemSchema safeParse', () => {
  it('reportAggItemSchema：合法 {entity_type:user,count:25} 通过', () => {
    expect(reportAggItemSchema.safeParse({ entity_type: 'user', count: 25 }).success).toBe(true);
  });

  it('reportAggItemSchema：count 非负整数（0 通过）', () => {
    expect(reportAggItemSchema.safeParse({ entity_type: 'user', count: 0 }).success).toBe(true);
  });

  it('reportAggItemSchema：count 负数拒绝', () => {
    expect(reportAggItemSchema.safeParse({ entity_type: 'user', count: -1 }).success).toBe(false);
  });

  it('reportAggItemSchema：count 非整数拒绝', () => {
    expect(reportAggItemSchema.safeParse({ entity_type: 'user', count: 1.5 }).success).toBe(false);
  });

  it('reportAggItemSchema：缺 count 拒绝', () => {
    expect(reportAggItemSchema.safeParse({ entity_type: 'user' }).success).toBe(false);
  });

  it('reportAggItemSchema：多维 item {operator_id,entity_type,count} 通过', () => {
    expect(
      reportAggItemSchema.safeParse({
        operator_id: ADMIN_ID,
        entity_type: 'user',
        count: 5,
      }).success,
    ).toBe(true);
  });

  it('reportResultSchema：合法样本通过（含 items/total/page/pageSize/totalPages/group_by 回显）', () => {
    const sample: ReportResult = {
      items: [{ entity_type: 'user', count: 25 } as unknown as ReportResult['items'][number]],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
      group_by: ['entity_type'],
    };
    expect(reportResultSchema.safeParse(sample).success).toBe(true);
  });

  it('reportResultSchema：空结果 items=[] total=0 totalPages=0 通过', () => {
    const sample = {
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
      group_by: ['entity_type'],
    };
    expect(reportResultSchema.safeParse(sample).success).toBe(true);
  });

  it('reportResultSchema.strict：多余字段拒绝（SEC-003a）', () => {
    expect(
      reportResultSchema.safeParse({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
        group_by: ['entity_type'],
        extra: 'leak',
      }).success,
    ).toBe(false);
  });

  it('reportResultSchema：缺 group_by 回显拒绝', () => {
    expect(
      reportResultSchema.safeParse({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      }).success,
    ).toBe(false);
  });

  it('reportResultSchema：group_by 含非法维度拒绝', () => {
    expect(
      reportResultSchema.safeParse({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
        group_by: ['unknown'],
      }).success,
    ).toBe(false);
  });

  it('reportResultSchema：total 负数拒绝', () => {
    expect(
      reportResultSchema.safeParse({
        items: [],
        total: -1,
        page: 1,
        pageSize: 20,
        totalPages: 0,
        group_by: ['entity_type'],
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. 聚合测 · 单维 group by
// ---------------------------------------------------------------------------
describe('聚合测 · 单维 group by', () => {
  it('group_by=[entity_type]：25 条 user create + 10 条 role create → count 降序', async () => {
    const { service, auditRepo } = setup();
    for (let i = 0; i < 25; i++) {
      auditRepo.insert(
        makeLog(i + 1, { entity_type: 'user', entity_id: `00000000-0000-4000-8000-${String(i + 1000).padStart(12, '0')}` }),
      );
    }
    for (let i = 0; i < 10; i++) {
      auditRepo.insert(
        makeLog(100 + i, { entity_type: 'role', entity_id: `00000000-0000-4000-8000-${String(i + 2000).padStart(12, '0')}` }),
      );
    }
    const result = await service.query({ group_by: ['entity_type'] }, adminCtx);
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(2);
    // count 降序：user(25) 在前，role(10) 在后
    expect(result.items[0]).toEqual({ entity_type: 'user', count: 25 });
    expect(result.items[1]).toEqual({ entity_type: 'role', count: 10 });
    // group_by 原样回显
    expect(result.group_by).toEqual(['entity_type']);
  });

  it('group_by=[operator_id]：按操作者聚合计数', async () => {
    const { service, auditRepo } = setup();
    for (let i = 0; i < 5; i++) auditRepo.insert(makeLog(i + 1, { operator_id: ADMIN_ID }));
    for (let i = 0; i < 3; i++) auditRepo.insert(makeLog(50 + i, { operator_id: OP2_ID }));
    const result = await service.query({ group_by: ['operator_id'] }, adminCtx);
    expect(result.total).toBe(2);
    const adminItem = result.items.find((it) => it.operator_id === ADMIN_ID);
    const op2Item = result.items.find((it) => it.operator_id === OP2_ID);
    expect(adminItem?.count).toBe(5);
    expect(op2Item?.count).toBe(3);
  });

  it('group_by=[action]：按动作聚合计数（create/update/delete）', async () => {
    const { service, auditRepo } = setup();
    auditRepo.insert(makeLog(1, { action: 'create' }));
    auditRepo.insert(makeLog(2, { action: 'create' }));
    auditRepo.insert(makeLog(3, { action: 'update' }));
    auditRepo.insert(makeLog(4, { action: 'delete' }));
    const result = await service.query({ group_by: ['action'] }, adminCtx);
    expect(result.total).toBe(3);
    const createItem = result.items.find((it) => it.action === 'create');
    expect(createItem?.count).toBe(2);
    const updateItem = result.items.find((it) => it.action === 'update');
    expect(updateItem?.count).toBe(1);
    const deleteItem = result.items.find((it) => it.action === 'delete');
    expect(deleteItem?.count).toBe(1);
  });

  it('group_by=[date]：按 UTC 自然日聚合计数', async () => {
    const { service, auditRepo } = setup();
    auditRepo.insert(makeLog(1, { operated_at: '2024-06-01T08:00:00.000Z' }));
    auditRepo.insert(makeLog(2, { operated_at: '2024-06-01T23:59:59.000Z' }));
    auditRepo.insert(makeLog(3, { operated_at: '2024-06-02T00:00:01.000Z' }));
    const result = await service.query({ group_by: ['date'] }, adminCtx);
    expect(result.total).toBe(2);
    const d1 = result.items.find((it) => it.date === '2024-06-01');
    const d2 = result.items.find((it) => it.date === '2024-06-02');
    expect(d1?.count).toBe(2);
    expect(d2?.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. 聚合测 · 多维交叉 group by
// ---------------------------------------------------------------------------
describe('聚合测 · 多维交叉 group by', () => {
  it('group_by=[operator_id, entity_type]：2 维交叉聚合，每项含两维 + count', async () => {
    const { service, auditRepo } = setup();
    // ADMIN_ID × user × 3
    for (let i = 0; i < 3; i++) auditRepo.insert(makeLog(i + 1, { operator_id: ADMIN_ID, entity_type: 'user' }));
    // ADMIN_ID × role × 2
    for (let i = 0; i < 2; i++) auditRepo.insert(makeLog(50 + i, { operator_id: ADMIN_ID, entity_type: 'role' }));
    // OP2_ID × user × 4
    for (let i = 0; i < 4; i++) auditRepo.insert(makeLog(100 + i, { operator_id: OP2_ID, entity_type: 'user' }));
    const result = await service.query({ group_by: ['operator_id', 'entity_type'] }, adminCtx);
    expect(result.total).toBe(3);
    const items = result.items as Array<{ operator_id: string; entity_type: string; count: number }>;
    const adminUser = items.find((it) => it.operator_id === ADMIN_ID && it.entity_type === 'user');
    const adminRole = items.find((it) => it.operator_id === ADMIN_ID && it.entity_type === 'role');
    const op2User = items.find((it) => it.operator_id === OP2_ID && it.entity_type === 'user');
    expect(adminUser?.count).toBe(3);
    expect(adminRole?.count).toBe(2);
    expect(op2User?.count).toBe(4);
  });

  it('group_by=[entity_type, action, date]：3 维交叉聚合', async () => {
    const { service, auditRepo } = setup();
    auditRepo.insert(makeLog(1, { entity_type: 'user', action: 'create', operated_at: '2024-06-01T10:00:00.000Z' }));
    auditRepo.insert(makeLog(2, { entity_type: 'user', action: 'create', operated_at: '2024-06-01T11:00:00.000Z' }));
    auditRepo.insert(makeLog(3, { entity_type: 'user', action: 'update', operated_at: '2024-06-01T10:00:00.000Z' }));
    auditRepo.insert(makeLog(4, { entity_type: 'role', action: 'create', operated_at: '2024-06-01T10:00:00.000Z' }));
    const result = await service.query(
      { group_by: ['entity_type', 'action', 'date'] },
      adminCtx,
    );
    expect(result.total).toBe(3);
    const items = result.items as Array<{ entity_type: string; action: string; date: string; count: number }>;
    const userCreateD1 = items.find((it) => it.entity_type === 'user' && it.action === 'create' && it.date === '2024-06-01');
    const userUpdateD1 = items.find((it) => it.entity_type === 'user' && it.action === 'update' && it.date === '2024-06-01');
    const roleCreateD1 = items.find((it) => it.entity_type === 'role' && it.action === 'create' && it.date === '2024-06-01');
    expect(userCreateD1?.count).toBe(2);
    expect(userUpdateD1?.count).toBe(1);
    expect(roleCreateD1?.count).toBe(1);
  });

  it('group_by=[operator_id, entity_type, action, date]：4 维上限交叉聚合', async () => {
    const { service, auditRepo } = setup();
    auditRepo.insert(
      makeLog(1, { operator_id: ADMIN_ID, entity_type: 'user', action: 'create', operated_at: '2024-06-01T10:00:00.000Z' }),
    );
    auditRepo.insert(
      makeLog(2, { operator_id: OP2_ID, entity_type: 'role', action: 'update', operated_at: '2024-06-02T10:00:00.000Z' }),
    );
    const result = await service.query(
      { group_by: ['operator_id', 'entity_type', 'action', 'date'] },
      adminCtx,
    );
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
    // 每项含 4 个维度键 + count
    for (const it of result.items) {
      expect(it.count).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. 聚合测 · date 桶（同日不同时刻聚到同桶，slice(0,10)）
// ---------------------------------------------------------------------------
describe('聚合测 · date 桶（UTC 自然日，operated_at.slice(0,10)）', () => {
  it('同日不同时刻聚到同桶（00:00:00 / 12:00:00 / 23:59:59 → 同 YYYY-MM-DD）', async () => {
    const { service, auditRepo } = setup();
    auditRepo.insert(makeLog(1, { operated_at: '2024-06-15T00:00:00.000Z' }));
    auditRepo.insert(makeLog(2, { operated_at: '2024-06-15T12:30:45.123Z' }));
    auditRepo.insert(makeLog(3, { operated_at: '2024-06-15T23:59:59.999Z' }));
    const result = await service.query({ group_by: ['date'] }, adminCtx);
    expect(result.total).toBe(1);
    expect(result.items[0]).toEqual({ date: '2024-06-15', count: 3 });
  });

  it('UTC 自然日边界：23:59:59.000Z 与 次日 00:00:01.000Z 分属不同桶', async () => {
    const { service, auditRepo } = setup();
    auditRepo.insert(makeLog(1, { operated_at: '2024-06-01T23:59:59.000Z' }));
    auditRepo.insert(makeLog(2, { operated_at: '2024-06-02T00:00:01.000Z' }));
    const result = await service.query({ group_by: ['date'] }, adminCtx);
    expect(result.total).toBe(2);
    const dates = result.items.map((it) => it.date).sort();
    expect(dates).toEqual(['2024-06-01', '2024-06-02']);
  });

  it('date 桶值长度恒为 10（YYYY-MM-DD，slice(0,10)）', async () => {
    const { service, auditRepo } = setup();
    auditRepo.insert(makeLog(1, { operated_at: '2024-06-01T10:00:00.000Z' }));
    const result = await service.query({ group_by: ['date'] }, adminCtx);
    expect(result.items[0]!.date).toHaveLength(10);
    expect(result.items[0]!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// 6. 聚合测 · 排序（count 降序 + 维度值升序 tiebreaker）
// ---------------------------------------------------------------------------
describe('聚合测 · 排序（count 降序 + 维度值升序 tiebreaker，D9 §5.3）', () => {
  it('count 降序：count 高的在前', async () => {
    const { service, auditRepo } = setup();
    for (let i = 0; i < 5; i++) auditRepo.insert(makeLog(i + 1, { entity_type: 'user' }));
    for (let i = 0; i < 2; i++) auditRepo.insert(makeLog(50 + i, { entity_type: 'role' }));
    for (let i = 0; i < 1; i++) auditRepo.insert(makeLog(100 + i, { entity_type: 'dept' }));
    const result = await service.query({ group_by: ['entity_type'] }, adminCtx);
    const counts = result.items.map((it) => it.count);
    expect(counts).toEqual([5, 2, 1]);
    expect(result.items[0]!.entity_type).toBe('user');
    expect(result.items[1]!.entity_type).toBe('role');
    expect(result.items[2]!.entity_type).toBe('dept');
  });

  it('count 相同时维度值升序 tiebreaker（entity_type: role < user，字典序）', async () => {
    const { service, auditRepo } = setup();
    for (let i = 0; i < 3; i++) auditRepo.insert(makeLog(i + 1, { entity_type: 'user' }));
    for (let i = 0; i < 3; i++) auditRepo.insert(makeLog(50 + i, { entity_type: 'role' }));
    for (let i = 0; i < 1; i++) auditRepo.insert(makeLog(100 + i, { entity_type: 'dept' }));
    const result = await service.query({ group_by: ['entity_type'] }, adminCtx);
    // count: user=3, role=3, dept=1 → 降序前两个 count=3（user/role），tiebreaker 升序 → role < user
    expect(result.items[0]).toEqual({ entity_type: 'role', count: 3 });
    expect(result.items[1]).toEqual({ entity_type: 'user', count: 3 });
    expect(result.items[2]).toEqual({ entity_type: 'dept', count: 1 });
  });

  it('多维 tiebreaker：count 相同时按 group_by 声明顺序依次升序', async () => {
    const { service, auditRepo } = setup();
    // 两条 (OP2, role) 与两条 (ADMIN, user) 各 count=2 → count 相同
    for (let i = 0; i < 2; i++)
      auditRepo.insert(makeLog(i + 1, { operator_id: OP2_ID, entity_type: 'role' }));
    for (let i = 0; i < 2; i++)
      auditRepo.insert(makeLog(50 + i, { operator_id: ADMIN_ID, entity_type: 'user' }));
    const result = await service.query({ group_by: ['operator_id', 'entity_type'] }, adminCtx);
    // count 均为 2 → 按 operator_id 升序：ADMIN_ID(00...01) < OP2_ID(00...02)
    const items = result.items as Array<{ operator_id: string; entity_type: string; count: number }>;
    expect(items[0]!.operator_id).toBe(ADMIN_ID);
    expect(items[1]!.operator_id).toBe(OP2_ID);
  });

  it('date 维度 tiebreaker：YYYY-MM-DD 字典序与日历序一致', async () => {
    const { service, auditRepo } = setup();
    auditRepo.insert(makeLog(1, { operated_at: '2024-06-03T10:00:00.000Z' }));
    auditRepo.insert(makeLog(2, { operated_at: '2024-06-01T10:00:00.000Z' }));
    auditRepo.insert(makeLog(3, { operated_at: '2024-06-02T10:00:00.000Z' }));
    const result = await service.query({ group_by: ['date'] }, adminCtx);
    // count 均为 1 → 按 date 升序：06-01 < 06-02 < 06-03
    expect(result.items.map((it) => it.date)).toEqual(['2024-06-01', '2024-06-02', '2024-06-03']);
  });
});

// ---------------------------------------------------------------------------
// 7. 聚合测 · 时间范围过滤 + 维度过滤
// ---------------------------------------------------------------------------
describe('聚合测 · 时间范围过滤（from/to 闭区间）', () => {
  it('operated_from/operated_to 闭区间：仅聚合落在区间内的日志（含边界）', async () => {
    const { service, auditRepo } = setup();
    auditRepo.insert(makeLog(1, { operated_at: '2024-06-01T00:00:00.000Z' }));
    auditRepo.insert(makeLog(2, { operated_at: '2024-06-02T00:00:00.000Z' }));
    auditRepo.insert(makeLog(3, { operated_at: '2024-06-03T00:00:00.000Z' }));
    auditRepo.insert(makeLog(4, { operated_at: '2024-06-04T00:00:00.000Z' }));
    const result = await service.query(
      {
        group_by: ['date'],
        operated_from: '2024-06-02T00:00:00.000Z',
        operated_to: '2024-06-03T00:00:00.000Z',
      },
      adminCtx,
    );
    expect(result.total).toBe(2);
    const dates = result.items.map((it) => it.date).sort();
    expect(dates).toEqual(['2024-06-02', '2024-06-03']);
  });

  it('仅 operated_from：≥ from 的日志参与聚合', async () => {
    const { service, auditRepo } = setup();
    auditRepo.insert(makeLog(1, { operated_at: '2024-06-01T00:00:00.000Z' }));
    auditRepo.insert(makeLog(2, { operated_at: '2024-06-02T00:00:00.000Z' }));
    auditRepo.insert(makeLog(3, { operated_at: '2024-06-03T00:00:00.000Z' }));
    const result = await service.query(
      { group_by: ['date'], operated_from: '2024-06-02T00:00:00.000Z' },
      adminCtx,
    );
    expect(result.total).toBe(2);
  });

  it('仅 operated_to：≤ to 的日志参与聚合', async () => {
    const { service, auditRepo } = setup();
    auditRepo.insert(makeLog(1, { operated_at: '2024-06-01T00:00:00.000Z' }));
    auditRepo.insert(makeLog(2, { operated_at: '2024-06-02T00:00:00.000Z' }));
    auditRepo.insert(makeLog(3, { operated_at: '2024-06-03T00:00:00.000Z' }));
    const result = await service.query(
      { group_by: ['date'], operated_to: '2024-06-02T00:00:00.000Z' },
      adminCtx,
    );
    expect(result.total).toBe(2);
  });
});

describe('聚合测 · 维度过滤（operator_id/entity_type/action）', () => {
  it('operator_id 过滤：仅聚合该操作者的日志', async () => {
    const { service, auditRepo } = setup();
    for (let i = 0; i < 4; i++) auditRepo.insert(makeLog(i + 1, { operator_id: ADMIN_ID, entity_type: 'user' }));
    for (let i = 0; i < 2; i++) auditRepo.insert(makeLog(50 + i, { operator_id: OP2_ID, entity_type: 'user' }));
    const result = await service.query(
      { group_by: ['entity_type'], operator_id: ADMIN_ID },
      adminCtx,
    );
    expect(result.total).toBe(1);
    expect(result.items[0]).toEqual({ entity_type: 'user', count: 4 });
  });

  it('entity_type 过滤：仅聚合该实体类型的日志', async () => {
    const { service, auditRepo } = setup();
    for (let i = 0; i < 3; i++) auditRepo.insert(makeLog(i + 1, { entity_type: 'user' }));
    for (let i = 0; i < 2; i++) auditRepo.insert(makeLog(50 + i, { entity_type: 'role' }));
    const result = await service.query(
      { group_by: ['action'], entity_type: 'user' },
      adminCtx,
    );
    expect(result.total).toBe(1);
    expect(result.items[0]!.count).toBe(3);
  });

  it('action 过滤：仅聚合该动作的日志', async () => {
    const { service, auditRepo } = setup();
    auditRepo.insert(makeLog(1, { action: 'create', entity_type: 'user' }));
    auditRepo.insert(makeLog(2, { action: 'create', entity_type: 'role' }));
    auditRepo.insert(makeLog(3, { action: 'update', entity_type: 'user' }));
    const result = await service.query(
      { group_by: ['entity_type'], action: 'create' },
      adminCtx,
    );
    expect(result.total).toBe(2);
    const userItem = result.items.find((it) => it.entity_type === 'user');
    const roleItem = result.items.find((it) => it.entity_type === 'role');
    expect(userItem?.count).toBe(1);
    expect(roleItem?.count).toBe(1);
  });

  it('组合过滤：operator_id + entity_type + action + 时间范围', async () => {
    const { service, auditRepo } = setup();
    auditRepo.insert(
      makeLog(1, { operator_id: ADMIN_ID, entity_type: 'user', action: 'create', operated_at: '2024-06-01T10:00:00.000Z' }),
    );
    auditRepo.insert(
      makeLog(2, { operator_id: ADMIN_ID, entity_type: 'user', action: 'create', operated_at: '2024-06-02T10:00:00.000Z' }),
    );
    auditRepo.insert(
      makeLog(3, { operator_id: OP2_ID, entity_type: 'user', action: 'create', operated_at: '2024-06-01T10:00:00.000Z' }),
    );
    auditRepo.insert(
      makeLog(4, { operator_id: ADMIN_ID, entity_type: 'role', action: 'create', operated_at: '2024-06-01T10:00:00.000Z' }),
    );
    const result = await service.query(
      {
        group_by: ['date'],
        operator_id: ADMIN_ID,
        entity_type: 'user',
        action: 'create',
        operated_from: '2024-06-01T00:00:00.000Z',
        operated_to: '2024-06-01T23:59:59.000Z',
      },
      adminCtx,
    );
    expect(result.total).toBe(1);
    expect(result.items[0]).toEqual({ date: '2024-06-01', count: 1 });
  });
});

// ---------------------------------------------------------------------------
// 8. 聚合测 · 空结果
// ---------------------------------------------------------------------------
describe('聚合测 · 空结果（PRD Q11，不报错）', () => {
  it('无审计日志 → items=[] total=0 totalPages=0', async () => {
    const { service } = setup();
    const result = await service.query({ group_by: ['entity_type'] }, adminCtx);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(0);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.group_by).toEqual(['entity_type']);
  });

  it('有日志但过滤后无匹配 → items=[] total=0 totalPages=0', async () => {
    const { service, auditRepo } = setup();
    auditRepo.insert(makeLog(1, { entity_type: 'user' }));
    const result = await service.query(
      { group_by: ['entity_type'], entity_type: 'role' },
      adminCtx,
    );
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(0);
  });

  it('空结果经 reportResultSchema 解析通过（形状自洽）', async () => {
    const { service } = setup();
    const result = await service.query({ group_by: ['entity_type'] }, adminCtx);
    expect(() => reportResultSchema.parse(result)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 9. 聚合测 · 分页（page/pageSize）
// ---------------------------------------------------------------------------
describe('聚合测 · 分页（page/pageSize）', () => {
  it('pageSize 钳制：pageSize=200 → 100 返回', async () => {
    const { service, auditRepo } = setup();
    auditRepo.insert(makeLog(1, { entity_type: 'user' }));
    const result = await service.query(
      { group_by: ['entity_type'], pageSize: 200 },
      adminCtx,
    );
    expect(result.pageSize).toBe(100);
  });

  it('分页切片：3 个维度组合 page=1 pageSize=2 → 2 项 + total=3 totalPages=2', async () => {
    const { service, auditRepo } = setup();
    for (let i = 0; i < 3; i++) auditRepo.insert(makeLog(i + 1, { entity_type: 'user' }));
    for (let i = 0; i < 2; i++) auditRepo.insert(makeLog(50 + i, { entity_type: 'role' }));
    for (let i = 0; i < 1; i++) auditRepo.insert(makeLog(100 + i, { entity_type: 'dept' }));
    const result = await service.query(
      { group_by: ['entity_type'], page: 1, pageSize: 2 },
      adminCtx,
    );
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(3);
    expect(result.totalPages).toBe(2);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(2);
  });

  it('分页切片：page=2 取第 3 项', async () => {
    const { service, auditRepo } = setup();
    for (let i = 0; i < 3; i++) auditRepo.insert(makeLog(i + 1, { entity_type: 'user' }));
    for (let i = 0; i < 2; i++) auditRepo.insert(makeLog(50 + i, { entity_type: 'role' }));
    for (let i = 0; i < 1; i++) auditRepo.insert(makeLog(100 + i, { entity_type: 'dept' }));
    const result = await service.query(
      { group_by: ['entity_type'], page: 2, pageSize: 2 },
      adminCtx,
    );
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(3);
    expect(result.page).toBe(2);
  });

  it('page 超出范围 → items=[] total 不变 totalPages 不变', async () => {
    const { service, auditRepo } = setup();
    for (let i = 0; i < 3; i++) auditRepo.insert(makeLog(i + 1, { entity_type: 'user' }));
    const result = await service.query(
      { group_by: ['entity_type'], page: 99, pageSize: 10 },
      adminCtx,
    );
    expect(result.items).toEqual([]);
    expect(result.total).toBe(1);
    expect(result.totalPages).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 10. 权限测 · 非 admin → FORBIDDEN
// ---------------------------------------------------------------------------
describe('权限测 · SEC-002 非 admin 调 report.query → FORBIDDEN', () => {
  it('非 admin（role=user）调 service.query → FORBIDDEN', async () => {
    const { service } = setup();
    await expectAppError(
      service.query({ group_by: ['entity_type'] }, userCtx),
      'FORBIDDEN',
    );
  });

  it('非 admin 调 router.query → FORBIDDEN', async () => {
    const { router } = setup();
    await expectAppError(
      callProc(router.query, { group_by: ['entity_type'] }, userCtx),
      'FORBIDDEN',
    );
  });

  it('非 admin 即使库非空也先抛 FORBIDDEN（鉴权先于聚合）', async () => {
    const { service, auditRepo } = setup();
    auditRepo.insert(makeLog(1, { entity_type: 'user' }));
    await expectAppError(
      service.query({ group_by: ['entity_type'] }, userCtx),
      'FORBIDDEN',
    );
  });

  it('admin 调 report.query 正常返回（admin 桩下视为具备 report:read）', async () => {
    const { service, auditRepo } = setup();
    auditRepo.insert(makeLog(1, { entity_type: 'user' }));
    const result = await service.query({ group_by: ['entity_type'] }, adminCtx);
    expect(result.total).toBe(1);
  });

  // [advisory] spec §3.3/§12 Out of scope：本期 ctx 仅 admin|user，admin 视为具备 report:read；
  //   "仅 report:read 无其他权限"验收场景待 Auth 富化 Ctx 后补。故不写 "admin 无 report:read → FORBIDDEN" 用例。
});

// ---------------------------------------------------------------------------
// 11. 错误码测 · group_by 缺失 / 时间范围无效
// ---------------------------------------------------------------------------
describe('错误码测 · REPORT_GROUP_BY_REQUIRED / REPORT_TIME_RANGE_INVALID（D10 router 层语义判定）', () => {
  it('group_by 缺省 → REPORT_GROUP_BY_REQUIRED（router 层语义判定）', async () => {
    const { service } = setup();
    await expectAppError(
      service.query({} as unknown as ReportQuery, adminCtx),
      'REPORT_GROUP_BY_REQUIRED',
    );
  });

  it('group_by 空数组 → REPORT_GROUP_BY_REQUIRED（router 层语义判定）', async () => {
    const { service } = setup();
    await expectAppError(
      service.query({ group_by: [] } as unknown as ReportQuery, adminCtx),
      'REPORT_GROUP_BY_REQUIRED',
    );
  });

  it('operated_from 晚于 operated_to → REPORT_TIME_RANGE_INVALID（router 层语义判定）', async () => {
    const { service } = setup();
    await expectAppError(
      service.query(
        {
          group_by: ['date'],
          operated_from: '2024-12-31T00:00:00.000Z',
          operated_to: '2024-01-01T00:00:00.000Z',
        } as unknown as ReportQuery,
        adminCtx,
      ),
      'REPORT_TIME_RANGE_INVALID',
    );
  });

  it('group_by 缺失 + 非 admin → REPORT_GROUP_BY_REQUIRED 先于 FORBIDDEN（校验先于鉴权）', async () => {
    const { service } = setup();
    await expectAppError(
      service.query({} as unknown as ReportQuery, userCtx),
      'REPORT_GROUP_BY_REQUIRED',
    );
  });
});

// ---------------------------------------------------------------------------
// 12. SSOT 派生断言（AI-005，禁硬编码跨域可变集合）
// ---------------------------------------------------------------------------
describe('SSOT 派生断言（AI-005）', () => {
  it('reportGroupByDimSchema 维度全集派生（禁硬编码 4 个维度字面量）', () => {
    const allDims: ReportGroupByDim[] = [...reportGroupByDimSchema.options];
    // 不硬编码字面量，用 schema 派生 + toContain 单元素校验
    expect(allDims).toContain('operator_id');
    expect(allDims).toContain('entity_type');
    expect(allDims).toContain('action');
    expect(allDims).toContain('date');
    expect(allDims).toHaveLength(4);
  });

  it('permissionCodeSchema 含 report:read（跨域联动，加性扩展自动覆盖）', () => {
    const allCodes = [...permissionCodeSchema.options];
    expect(allCodes).toContain('report:read');
    // 既有码不被破坏
    expect(allCodes).toContain('audit:read');
    expect(allCodes).toContain('dept:read');
  });

  it('errorCodeSchema 含 REPORT_GROUP_BY_REQUIRED 与 REPORT_TIME_RANGE_INVALID（跨域联动）', () => {
    const allCodes = [...errorCodeSchema.options];
    expect(allCodes).toContain('REPORT_GROUP_BY_REQUIRED');
    expect(allCodes).toContain('REPORT_TIME_RANGE_INVALID');
    // 既有码不被破坏
    expect(allCodes).toContain('VALIDATION_ERROR');
    expect(allCodes).toContain('FORBIDDEN');
  });

  it('auditLogEntityTypeSchema 各值经 reportQuerySchema.entity_type 过滤均合法（SSOT 派生遍历）', () => {
    for (const t of auditLogEntityTypeSchema.options) {
      expect(
        reportQuerySchema.safeParse({ group_by: ['entity_type'], entity_type: t }).success,
      ).toBe(true);
    }
  });

  it('auditLogActionSchema 各值经 reportQuerySchema.action 过滤均合法（SSOT 派生遍历）', () => {
    for (const a of auditLogActionSchema.options) {
      expect(reportQuerySchema.safeParse({ group_by: ['action'], action: a }).success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 13. SEC-001 procedure 元数据声明
// ---------------------------------------------------------------------------
describe('权限 · SEC-001 procedure 元数据声明', () => {
  it('router.query 声明 auth: "admin"（受保护入口）', () => {
    const { router } = setup();
    expect(router.query.auth).toBe('admin');
  });

  it('router.query 声明 permission: "report:read"（ReportProcedure 形状）', () => {
    const { router } = setup();
    const queryProc = router.query as ReportProcedure<unknown, unknown>;
    expect(queryProc.permission).toBe('report:read');
  });

  it('report 领域无 create/update/delete procedure（纯读，F2 非 CRUD）', () => {
    const { router } = setup();
    expect((router as unknown as { create?: unknown }).create).toBeUndefined();
    expect((router as unknown as { update?: unknown }).update).toBeUndefined();
    expect((router as unknown as { delete?: unknown }).delete).toBeUndefined();
    expect((router as unknown as { patch?: unknown }).patch).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 14. SEC-003 出参 .strict + 不夹带 PII
// ---------------------------------------------------------------------------
describe('权限 · SEC-003 出参 .strict 不夹带 PII', () => {
  it('SEC-003a：query 出参匹配 reportResultSchema.strict（无多余字段）', async () => {
    const { service, auditRepo } = setup();
    auditRepo.insert(makeLog(1, { entity_type: 'user' }));
    const result = await service.query({ group_by: ['entity_type'] }, adminCtx);
    expect(() => reportResultSchema.parse(result)).not.toThrow();
  });

  it('SEC-003b：聚合维度均为非 PII，items 仅含维度键 + count（无 email/name 等 PII）', async () => {
    const { service, auditRepo } = setup();
    auditRepo.insert(
      makeLog(1, {
        entity_type: 'user',
        after: makeFields({ field: 'email', value: 'abcdef@example.com', pii: true }),
      }),
    );
    const result = await service.query({ group_by: ['entity_type'] }, adminCtx);
    const item = result.items[0]!;
    // item 仅含 entity_type + count，不含 email/name 等 PII 字段
    const keys = Object.keys(item);
    expect(keys).toContain('entity_type');
    expect(keys).toContain('count');
    expect(keys).not.toContain('email');
    expect(keys).not.toContain('name');
    expect(JSON.stringify(item)).not.toContain('abcdef@example.com');
  });
});

// ---------------------------------------------------------------------------
// 15. 状态机 · 校验顺序闭环
// ---------------------------------------------------------------------------
describe('状态机 · 校验顺序闭环（B1/B1\'/B1\'\' → B2/B3 → 聚合 → 返回）', () => {
  it('B1\' 先于 B3：group_by 空 + 非 admin → REPORT_GROUP_BY_REQUIRED（语义判定先于鉴权）', async () => {
    const { service } = setup();
    await expectAppError(
      service.query({ group_by: [] } as unknown as ReportQuery, userCtx),
      'REPORT_GROUP_BY_REQUIRED',
    );
  });

  it('B3 在 B1\' 通过后触发：合法 group_by + 非 admin → FORBIDDEN', async () => {
    const { service } = setup();
    await expectAppError(
      service.query({ group_by: ['entity_type'] }, userCtx),
      'FORBIDDEN',
    );
  });

  it('B1\'\' 时间范围无效先于 B3：非 admin + 时间范围非法 → REPORT_TIME_RANGE_INVALID', async () => {
    const { service } = setup();
    await expectAppError(
      service.query(
        {
          group_by: ['date'],
          operated_from: '2024-12-31T00:00:00.000Z',
          operated_to: '2024-01-01T00:00:00.000Z',
        } as unknown as ReportQuery,
        userCtx,
      ),
      'REPORT_TIME_RANGE_INVALID',
    );
  });

  it('B1→B3→聚合→返回：合法入参 + admin → 正常返回（聚合闭环）', async () => {
    const { service, auditRepo } = setup();
    auditRepo.insert(makeLog(1, { entity_type: 'user' }));
    auditRepo.insert(makeLog(2, { entity_type: 'role' }));
    const result = await service.query({ group_by: ['entity_type'] }, adminCtx);
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
  });

  it('report 聚合这些日志 → count 准确（F1 旁路产生的日志可被 report 聚合，状态机闭环）', async () => {
    const { service, auditRepo } = setup();
    // 模拟 F1 旁路产生的 5 条 user create + 3 条 role create 日志
    for (let i = 0; i < 5; i++) {
      auditRepo.insert(
        makeLog(i + 1, {
          entity_type: 'user',
          action: 'create',
          before: [],
          after: makeFields(
            { field: 'email', value: `u${i}@example.com`, pii: true },
            { field: 'name', value: `user${i}`, pii: false },
          ),
        }),
      );
    }
    for (let i = 0; i < 3; i++) {
      auditRepo.insert(
        makeLog(50 + i, {
          entity_type: 'role',
          action: 'create',
          before: [],
          after: makeFields(
            { field: 'name', value: `role${i}`, pii: false },
            { field: 'permission_codes', value: ['user:read'], pii: false },
          ),
        }),
      );
    }
    const result = await service.query({ group_by: ['entity_type', 'action'] }, adminCtx);
    expect(result.total).toBe(2);
    const items = result.items as Array<{ entity_type: string; action: string; count: number }>;
    const userCreate = items.find((it) => it.entity_type === 'user' && it.action === 'create');
    const roleCreate = items.find((it) => it.entity_type === 'role' && it.action === 'create');
    expect(userCreate?.count).toBe(5);
    expect(roleCreate?.count).toBe(3);
  });
});
