// apps/api/src/service/dept.ts —— 业务层：编排 repository + 权限校验 + 抛 AppError
// 校验顺序（Tech-Spec §边界与异常，先到先返，不叠加）：
//   create:  B3 鉴权 → [parent_id 非空：B4 父不存在(DEPT_NOT_FOUND) → B5 层级超限(DEPT_DEPTH_EXCEEDED)] → B6 同父重名(DEPT_NAME_DUPLICATE)
//            根（parent_id=null/缺省）：跳过 B4/B5，层级=1，仅 B6。
//   delete:  B3 鉴权 → B7 不存在(DEPT_NOT_FOUND) → B8 有子部门(DEPT_HAS_CHILDREN) → [Q1: 用户 department_id 置空] → 删除 → 204
//            不校验 B11 / DEPT_HAS_USERS（Q1 解除归属为副作用，非阻断）。
//   assign:  B3 鉴权 → B9 用户不存在(USER_NOT_FOUND) → [departmentId 非空：B10 部门不存在(DEPT_NOT_FOUND)] → 写入 → 返回 user
//            departmentId=null（解除归属）时跳过 B10。
//   tree:    B3 鉴权 → 返回 departmentTreeResultSchema（空树 items=[]）。
import { randomUUID } from 'node:crypto';
import type {
  CreateDepartmentInput,
  Department,
  DepartmentTreeResult,
  DepartmentTreeNode,
  User,
} from '@admin/contracts';
import type { DepartmentRepository } from '../repository/dept.js';
import type { UserRepository } from '../repository/user.js';
import type { Ctx } from '../context.js';
import { MAX_DEPARTMENT_DEPTH } from '../domain/dept.js';
import { markPii, type WriteResult } from '../domain/audit.js';
import { AppError } from '../errors.js';

export class DepartmentService {
  constructor(
    private readonly deptRepo: DepartmentRepository,
    private readonly userRepo: UserRepository,
  ) {}

  /** SEC-002：service 入口校验调用者必须为 admin，否则 FORBIDDEN。 */
  private requireAdmin(ctx: Ctx): void {
    if (ctx.user.role !== 'admin') {
      throw new AppError('FORBIDDEN', '需要管理员权限');
    }
  }

  async create(input: CreateDepartmentInput, ctx: Ctx): Promise<WriteResult<Department>> {
    this.requireAdmin(ctx);
    const parentId = input.parent_id ?? null;
    // B4/B5：仅当 parent_id 非空时校验父存在与层级
    if (parentId !== null) {
      // B4: 父部门不存在（先于 B5）
      const parent = this.deptRepo.findById(parentId);
      if (!parent) {
        throw new AppError('DEPT_NOT_FOUND', `父部门不存在: ${parentId}`);
      }
      // B5: 层级超限（先于 B6；父已存在方可推导层级）
      const newDepth = this.deptRepo.computeDepth(parentId);
      if (newDepth > MAX_DEPARTMENT_DEPTH) {
        throw new AppError('DEPT_DEPTH_EXCEEDED', `层级超限：第 ${newDepth} 层超过最大深度 ${MAX_DEPARTMENT_DEPTH}`);
      }
    }
    // B6: 同父下名称重复（Q3 同父唯一；跨父允许重名）
    if (this.deptRepo.existsByNameUnderParent(input.name, parentId)) {
      throw new AppError('DEPT_NAME_DUPLICATE', `部门名称已存在: ${input.name}`);
    }
    const dept: Department = {
      id: randomUUID(),
      name: input.name,
      parent_id: parentId,
      created_at: new Date().toISOString(),
    };
    const inserted = this.deptRepo.insert(dept);
    // D3：changes 为 after 快照（dept 本期无 PII，markPii 全 false），create 无 before
    const changes = markPii('dept', [
      { field: 'name', value: inserted.name, pii: false },
      { field: 'parent_id', value: inserted.parent_id, pii: false },
    ]);
    return { entity: inserted, changes };
  }

  async delete(id: string, ctx: Ctx): Promise<WriteResult<void>> {
    this.requireAdmin(ctx);
    // B7: 部门不存在（先于 B8）
    const dept = this.deptRepo.findById(id);
    if (!dept) {
      throw new AppError('DEPT_NOT_FOUND', `部门不存在: ${id}`);
    }
    // B8: 仍有子部门（Q2 禁止级联，须先清空子部门）；先于 Q1 解除归属
    const children = this.deptRepo.findByParent(id);
    if (children.length > 0) {
      throw new AppError('DEPT_HAS_CHILDREN', '请先处理子部门');
    }
    // Q1: 将该部门下所有用户的 department_id 置空（解除归属，账号保留，非阻断）
    // 不校验 B11 / DEPT_HAS_USERS（本期预留码不触发）
    const users = this.userRepo.findByDepartmentId(id);
    if (users.length > 0) {
      const now = new Date().toISOString();
      for (const u of users) {
        this.userRepo.updateDepartmentId(u.id, null, now);
      }
    }
    this.deptRepo.delete(id);
    // D3：delete 返回 entity=void（204 无体），before 为删除前快照
    const before = markPii('dept', [
      { field: 'name', value: dept.name, pii: false },
      { field: 'parent_id', value: dept.parent_id, pii: false },
    ]);
    return { entity: undefined, changes: [], before };
  }

  async assignUserDepartment(
    userId: string,
    departmentId: string | null,
    ctx: Ctx,
  ): Promise<WriteResult<User>> {
    this.requireAdmin(ctx);
    // B9: 用户不存在（先于 B10）
    const user = this.userRepo.findById(userId);
    if (!user) {
      throw new AppError('USER_NOT_FOUND', `用户不存在: ${userId}`);
    }
    // B10: 部门不存在（仅当 departmentId 非空；null=解除归属，跳过）
    if (departmentId !== null) {
      const dept = this.deptRepo.findById(departmentId);
      if (!dept) {
        throw new AppError('DEPT_NOT_FOUND', `部门不存在: ${departmentId}`);
      }
    }
    // 写入用户 department_id（覆盖写，一个用户仅属一个部门）
    const now = new Date().toISOString();
    const updated = this.userRepo.updateDepartmentId(userId, departmentId, now);
    if (!updated) {
      // 极小竞态：刚查到又被并发删除，按不存在处理
      throw new AppError('USER_NOT_FOUND', `用户不存在: ${userId}`);
    }
    // D3 + PRD F1（dept.assignUserDepartment 跨域依赖：归属变更视为 user 的 update，
    //   entity_type=user，before/after 仅含 department_id 字段）：
    //   markPii 按 'user' 标记（department_id 非 PII，pii=false，但语义对齐 entity_type=user）
    const before = markPii('user', [
      { field: 'department_id', value: user.department_id ?? null, pii: false },
    ]);
    const changes = markPii('user', [
      { field: 'department_id', value: updated.department_id ?? null, pii: false },
    ]);
    return { entity: updated, changes, before };
  }

  async tree(ctx: Ctx): Promise<DepartmentTreeResult> {
    this.requireAdmin(ctx);
    // 构建树：先建 id→node 映射（children=[]），再按 parent_id 挂载到父节点的 children；根节点入 items。
    const all = this.deptRepo.list();
    const nodes: DepartmentTreeNode[] = all.map((d) => ({
      id: d.id,
      name: d.name,
      parent_id: d.parent_id,
      created_at: d.created_at,
      children: [],
    }));
    const nodeMap = new Map<string, DepartmentTreeNode>();
    for (const n of nodes) nodeMap.set(n.id, n);
    const items: DepartmentTreeNode[] = [];
    for (const n of nodes) {
      if (n.parent_id === null) {
        items.push(n);
      } else {
        const parent = nodeMap.get(n.parent_id);
        if (parent) {
          parent.children.push(n);
        } else {
          // 孤儿节点（父缺失）兜底挂根，避免数据丢失；正常流程不会出现
          items.push(n);
        }
      }
    }
    return { items };
  }
}
