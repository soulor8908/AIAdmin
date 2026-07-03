// packages/contracts/src/schemas/audit.ts —— 操作日志契约层（SSOT）
// 派生自 Tech-Spec TECH-AUDIT-001（prd_ref: PRD-AUDIT-001）。
// 约束：所有类型经 z.infer 派生，禁止手写 TS 类型副本（ARCH-002 / CODE-004）。
// 约束：错误码 SSOT 为 user.ts 的 errorCodeSchema（跨域共享单一枚举），audit 相关码已追加其中；
//       本文件不重复定义 errorCodeSchema，避免 export * 重名冲突（详见 Tech-Spec §API 契约）。
// 约束：contracts 只导出 Zod schema 与 z.infer 类型（ARCH-002）；脱敏纯函数 redactEmail(email)
//       由 apps/api/src/domain/audit.ts 维护（参照 dept 域常量约定，见 role.ts 域 BUILTIN_ADMIN_ROLE_NAME），
//       不在 contracts 导出，避免违反「contracts 纯净」。
// 约束：id / operator_id / entity_id 用 z.string().uuid()；operated_at / created_at 用 z.string().datetime()。

import { z } from 'zod';

/**
 * 操作日志目标实体类型枚举（Q3 决策：闭合枚举，随领域 PRD 扩展）。
 * [约束] 后续新增领域时由对应领域 PRD 同步扩展该枚举（参照 permissionCodeSchema 随模块 PRD 扩展哲学）；
 *        枚举扩展须同步本 schema、Tech-Spec §API 契约、OpenAPI 的 AuditLogEntityType 与各域写操作埋点。
 * [约束] notification 为跨域联动扩展（TECH-NOTIFICATION-001 引入）：notification 5 类写操作经 withAudit 埋点，
 *        entity_type=notification；枚举扩展后 SSOT 派生断言（AI-005）自动跟随（role/audit/report.test.ts 等无需手改）。
 * [约束] TECH-AUTH-001 AI-006 反向核实：鉴权域 login/login_failed/logout 记审计 entity_type=auth（PRD AC-F1-6/F4-3），
 *        枚举追加 'auth'；该埋点由 AuthService 直接调 audit.record（非 withAudit），故 audit-embedding.test.ts 全集
 *        覆盖断言不要求 'auth' 被本测试触发（已改为子集断言，见 audit-embedding.test.ts 注释）。
 */
export const auditLogEntityTypeSchema = z.enum(['user', 'role', 'dept', 'notification', 'auth']);
export type AuditLogEntityType = z.infer<typeof auditLogEntityTypeSchema>;

/**
 * 操作日志动作枚举（PRD：仅记录写操作，读操作不记录 Q1）。
 * [约束] 此处 update/delete 指对目标实体（user/role/dept）的写动作，并非对日志本身的修改/删除——
 *        日志为 append-only（F4），不存在「修改/删除日志」的动作，故无 audit:* 的 update/delete 错误码。
 * [约束] TECH-AUTH-001 AI-006 反向核实：鉴权域 login 成功记 action=login、login 失败记 action=login_failed、
 *        logout 记 action=logout（PRD AC-F1-6/F4-3）；这些 action 由 AuthService 直接调 audit.record，不经
 *        withAudit，故 audit-embedding.test.ts 全集覆盖断言不要求这些 action 被本测试触发（已改为子集断言）。
 */
export const auditLogActionSchema = z.enum(['create', 'update', 'delete', 'login', 'login_failed', 'logout']);
export type AuditLogAction = z.infer<typeof auditLogActionSchema>;

/**
 * ChangeField.value 类型契约（D5 / PRD Q18）：标量 | null | 同类型标量数组。
 * [约束] 不支持对象/嵌套数组（PRD Q18）；field 可为虚拟/关联字段（如 assigned_user_ids），不限定为实体列。
 */
export const changeFieldValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string()),
  z.array(z.number()),
  z.array(z.boolean()),
]);
export type ChangeFieldValue = z.infer<typeof changeFieldValueSchema>;

/**
 * 结构化变更字段（D5）：{field, value, pii}。
 * [约束] field 为字段名（≥1 字符）；value 见 changeFieldValueSchema；pii 为字段级布尔标记（存储保留，查询时据标记套 redactEmail）。
 * [约束] .strict()（SEC-003a）：拒绝多余字段。
 */
export const changeFieldSchema = z
  .object({
    field: z.string().min(1),
    value: changeFieldValueSchema,
    pii: z.boolean(),
  })
  .strict();
export type ChangeField = z.infer<typeof changeFieldSchema>;

/**
 * PII 字段清单 shape SSOT（D6）：按 entity_type → Set<field_name> 描述 registry 结构。
 * [约束] ARCH-002：contracts 只导出 schema 与类型；runtime 数据（PII_FIELD_REGISTRY）放 apps/api/src/domain/audit.ts。
 * [advisory] z.set 在 Zod v3.23+ 可用；若未来 Zod 版本不支持，可降级为 z.array(z.string()) + new Set 转换。
 */
export const piiFieldRegistrySchema = z.record(auditLogEntityTypeSchema, z.set(z.string().min(1)));
export type PiiFieldRegistry = z.infer<typeof piiFieldRegistrySchema>;

/**
 * 操作日志实体：DB audit_logs 表行的契约投影（存储态，含原始 PII）。
 * 字段命名沿用 snake_case 以与 DB schema 对齐（operator_id / entity_type / entity_id / operated_at / created_at）。
 * [约束] append-only：日志一旦写入不可修改、不可删除（F4）；任何入口（含管理后台/批量/快捷入口）均无 update/delete 路径。
 * [约束] before/after 仅含本次实际变更字段（未变更字段不出现在快照）；create 时 before=[]，delete 时 after=[]（F1 验收，PRD Q17）。
 * [约束] before/after 用 z.array(changeFieldSchema) 承载结构化变更快照（D5：{field, value, pii}）；
 *        其中 pii=true 的字段值在【查询返回】时须脱敏（见 redactedAuditLogSchema / redactedEmailSchema，SEC-003b）。
 *        存储保留原始值（Q2：以备深度审计），本期查询入口仅返回脱敏值；pii 标记存储保留（避免查询时再查 registry）。
 * [约束] operator_name 为操作者姓名快照：写入时从 user 表读取并冻结，避免后续用户改名导致日志与历史操作者脱节（append-only 不可变要求）。
 * [约束] entity_id 为目标实体标识（user/role/dept 的 id 均为 uuid），统一用 z.string().uuid()。
 */
export const auditLogSchema = z
  .object({
    id: z.string().uuid(),
    operator_id: z.string().uuid(),
    operator_name: z.string().min(1),
    entity_type: auditLogEntityTypeSchema,
    entity_id: z.string().uuid(),
    action: auditLogActionSchema,
    operated_at: z.string().datetime(),
    before: z.array(changeFieldSchema),
    after: z.array(changeFieldSchema),
    created_at: z.string().datetime(),
  })
  .strict();
export type AuditLog = z.infer<typeof auditLogSchema>;

/**
 * 脱敏邮箱格式契约（SEC-003b）：保留首 2 字符 + *** + @ + 域名（如 ab***@example.com）。
 * [约束] 查询返回的 before/after 中「邮箱」类型字段值须符合此格式；脱敏纯函数 redactEmail(email)
 *       由 apps/api/src/domain/audit.ts 实现（ARCH-002：contracts 不导出函数），其输出须可被本 schema 解析。
 * [约束] 契约测须断言 redactEmail('abcdef@example.com') === 'ab***@example.com' 且其输出可被 redactedEmailSchema.safeParse 通过。
 * [advisory] 正则仅校验「首2字符+***+@+非空域名」前缀形态，不严格校验域名合法性；local 部分不足 2 字符的邮箱为边缘场景
 *            （邮箱通常 ≥2 字符），由 service 层兜底处理（如原样返回或填充），Dev 须反向同步 Spec。
 */
export const redactedEmailSchema = z.string().regex(/^.{2}\*\*\*@[^\s@]+$/, '保留首2字符+***+@+域名');
export type RedactedEmail = z.infer<typeof redactedEmailSchema>;

/**
 * 操作日志查询返回实体（脱敏态）：与 auditLogSchema 字段集一致，语义为 before/after 中 pii=true 项已脱敏。
 * [约束] 查询入口（GET /v1/audit-logs）的返回 items 须为本 schema 实例；service 层在返回前对 before/after 中
 *        pii=true 项套用 redactEmail（D7：信任标记，移除运行时正则兜底 EMAIL_LIKE_RE）。
 * [约束] 输出 schema 带 .strict()（SEC-003a）；before/after 为 z.array(changeFieldSchema)，邮箱脱敏由 service 保证
 *        （契约测断言：构造含 email 的 before/after 样本经 service 脱敏后，email 项 value 可被 redactedEmailSchema 解析；未脱敏原值须被拒绝）。
 * [advisory] 本期不提供未脱敏返回入口（Q2 决策：存储保留原值以备深度审计，但查询入口仅返回脱敏值，收敛 PII 批量导出风险面）；
 *            若未来需未脱敏入口须反向同步 Spec 并补独立权限码（如 audit:read_raw）。
 */
export const redactedAuditLogSchema = z
  .object({
    id: z.string().uuid(),
    operator_id: z.string().uuid(),
    operator_name: z.string().min(1),
    entity_type: auditLogEntityTypeSchema,
    entity_id: z.string().uuid(),
    action: auditLogActionSchema,
    operated_at: z.string().datetime(),
    before: z.array(changeFieldSchema),
    after: z.array(changeFieldSchema),
    created_at: z.string().datetime(),
  })
  .strict();
export type RedactedAuditLog = z.infer<typeof redactedAuditLogSchema>;

/**
 * 分页查询操作日志入参（F2）。
 * [约束] 过滤维度：时间范围（operated_from/operated_to，均 ISO datetime，闭区间）/ 操作者（operator_id，uuid）/ 实体类型（entity_type，闭合枚举）；
 *        action 过滤为 Q5 OPEN，本期不提供。
 * [约束] 默认按 operated_at 倒序（最新优先，Q4）；排序在 service 层实现，不入 schema。
 * [约束] page 从 1 起，默认 1；pageSize 默认 20，超上限 100 按 Q4「按上限处理」：用 transform 钳制为 100（非拒绝），
 *        返回结果的 pageSize 字段反映钳制后的值作为「提示」（与 user/role/dept 的 max(100) 拒绝策略有意分歧，依 PRD-AUDIT Q4 验收「page_size=200 → 按 100 返回」）。
 * [advisory] 查询 schema 非 strict（与 listUserQuerySchema / listRoleQuerySchema 约定一致，未知 query 键被 strip 而非拒绝）。
 */
export const listAuditLogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .transform((n) => Math.min(n, 100))
    .default(20),
  operated_from: z.string().datetime().optional(),
  operated_to: z.string().datetime().optional(),
  operator_id: z.string().uuid().optional(),
  entity_type: auditLogEntityTypeSchema.optional(),
});
export type ListAuditLogQuery = z.infer<typeof listAuditLogQuerySchema>;

/**
 * 分页查询操作日志结果（F2，items 为脱敏态）。
 * [约束] total = 满足筛选条件的总条数（非当前页条数）；totalPages = ceil(total/pageSize)；空列表 totalPages=0（对齐 user/role/dept 域约定）。
 * [约束] items 按 operated_at 倒序排列（Q4）；items 元素为 redactedAuditLogSchema（邮箱已脱敏，SEC-003b）。
 * [约束] 输出 schema 带 .strict()（SEC-003a）。
 */
export const auditLogListResultSchema = z
  .object({
    items: z.array(redactedAuditLogSchema),
    total: z.number().int().min(0),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    totalPages: z.number().int().min(0),
  })
  .strict();
export type AuditLogListResult = z.infer<typeof auditLogListResultSchema>;
