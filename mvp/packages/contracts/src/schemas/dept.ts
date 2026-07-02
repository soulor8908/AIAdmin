// packages/contracts/src/schemas/dept.ts —— 部门管理契约层（SSOT）
// 派生自 Tech-Spec TECH-DEPT-001（prd_ref: PRD-DEPT-001）。
// 约束：所有类型经 z.infer 派生，禁止手写 TS 类型副本（ARCH-002 / CODE-004）。
// 约束：错误码 SSOT 为 user.ts 的 errorCodeSchema（跨域共享单一枚举），部门相关码已追加其中；
//       本文件不重复定义 errorCodeSchema，避免 export * 重名冲突（详见 Tech-Spec §API 契约）。
// 约束：contracts 只导出 Zod schema 与 z.infer 类型（ARCH-002）；部门层级上限等纯数值常量
//       由 apps/api/src/domain/dept.ts 维护（参见 role.ts 域的 BUILTIN_ADMIN_ROLE_NAME 约定），
//       不在 contracts 导出，避免违反「contracts 纯净」。
// 约束：id 用 z.string().uuid()；created_at 用 z.string().datetime()。

import { z } from 'zod';

/**
 * 部门实体：DB departments 表行的契约投影。
 * 字段命名沿用 snake_case 以与 DB schema 对齐（parent_id / created_at）。
 * [约束] name 同父下唯一（Q3，唯一性在 service 层裁决 → DEPT_NAME_DUPLICATE）。
 * [约束] parent_id 可空，空表示根部门（第 1 层）；非空须为已存在部门的 id。
 * [约束] 部门创建后 name / parent_id 不可编辑（PRD Q6：如需调整须删除重建，本期无 PATCH 部门信息端点）。
 * [advisory] name 长度上限 64，PRD 未指定，Dev 可按真实 DB 列宽调整并反向同步 Spec。
 */
export const departmentSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(64),
    parent_id: z.string().uuid().nullable(),
    created_at: z.string().datetime(),
  })
  .strict();
export type Department = z.infer<typeof departmentSchema>;

/**
 * 新建部门输入（F1）。
 * [约束] parent_id 缺省 / null 表示作为根部门（第 1 层）；提供 uuid 表示挂在该父部门下。
 * [约束] id / created_at 由服务端生成，不入输入（.strict() 拒绝多余字段）。
 * [advisory] parent_id 字段名取 snake_case 以与实体 parent_id 对齐
 *            （同 createRoleInputSchema 的 permission_codes 镜像实体字段的约定）。
 */
export const createDepartmentInputSchema = z
  .object({
    name: z.string().min(1).max(64),
    parent_id: z.string().uuid().nullable().optional(),
  })
  .strict();
export type CreateDepartmentInput = z.infer<typeof createDepartmentInputSchema>;

/**
 * 部门树查询入参（F2，无分页 / 筛选参数）。
 * [约束] 非 strict（与 listUserQuerySchema / listRoleQuerySchema 查询 schema 约定一致，
 *        未知 query 键被 strip 而非拒绝）；解析结果恒为 {}。
 */
export const departmentTreeQuerySchema = z.object({});
export type DepartmentTreeQuery = z.infer<typeof departmentTreeQuerySchema>;

/**
 * 部门树节点（递归）：部门实体字段 + 直接子节点。
 * [约束] children 为该部门的直接子部门数组（叶节点为空数组 []）。
 * [约束] 输出 schema 带 .strict()（SEC-003a）；parent_id 保留以与实体 1:1（树中位置亦编码父子关系，二者一致）。
 * [advisory] 递归 Zod schema 的实现模式：TS 无法从自引用初始化器推断递归类型（TS7022/TS7024），
 *            故用「私有 DepartmentTreeNodeBase 接口 + z.ZodType 注解 + z.lazy 延迟运行时引用」打破循环。
 *            该私有接口仅为注解服务、不 export；对外导出的 DepartmentTreeNode 仍由 z.infer 派生（ARCH-002/CODE-004）。
 *            若 departmentTreeNodeSchema 的字段集变更，须同步 DepartmentTreeNodeBase（契约测断言样本可解析以防漂移）；
 *            Dev 若改用扁平邻接表结构须反向同步 Spec。
 */
interface DepartmentTreeNodeBase {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
  children: DepartmentTreeNodeBase[];
}

export const departmentTreeNodeSchema: z.ZodType<DepartmentTreeNodeBase> = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(64),
    parent_id: z.string().uuid().nullable(),
    created_at: z.string().datetime(),
    children: z.array(z.lazy(() => departmentTreeNodeSchema)),
  })
  .strict();
export type DepartmentTreeNode = z.infer<typeof departmentTreeNodeSchema>;

/**
 * 部门树查询结果（F2）。
 * [约束] items 为根部门（parent_id=null）构成的树数组；无任何部门时为空数组（F2 验收：返回空结果）。
 * [约束] 输出 schema 带 .strict()（SEC-003a）。
 */
export const departmentTreeResultSchema = z
  .object({
    items: z.array(departmentTreeNodeSchema),
  })
  .strict();
export type DepartmentTreeResult = z.infer<typeof departmentTreeResultSchema>;

/**
 * 维护用户部门归属入参（F4，procedure 级合并输入：path userId + body departmentId）。
 * [约束] userId + departmentId 均经 uuid 校验；字段名取 camelCase，对齐 assignRoleInputSchema 的 path+body 合并风格。
 * [约束] departmentId 必填：值为 uuid 表示归属到该部门（覆盖原归属，一个用户仅属一个部门）；
 *        值为 null 表示解除该用户的部门归属（置空）。
 * [约束] 此 schema 同时作为「分配 / 变更 / 解除」三类操作的入参形状；OpenAPI 侧按 path/body 拆分。
 * [advisory] departmentId 取「必填 + 可空」而非 optional，以消除「缺省 = 解除」与「缺省 = 不变」的语义歧义；
 *            解除归属统一以显式 null 表达，Dev 若改 optional 须反向同步 Spec。
 */
export const assignUserDepartmentInputSchema = z
  .object({
    userId: z.string().uuid(),
    departmentId: z.string().uuid().nullable(),
  })
  .strict();
export type AssignUserDepartmentInput = z.infer<typeof assignUserDepartmentInputSchema>;
