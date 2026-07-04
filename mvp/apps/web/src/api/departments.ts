// apps/web/src/api/departments.ts —— 部门域 endpoint 封装（TECH-WEB-ROLE-DEPT-AUDIT-001 §4.2.2）
//
// 职责：
//   - getDeptTree()：GET /v1/departments/tree（递归 DepartmentTreeNode，无分页/筛选）
//   - createDepartment(input)：POST /v1/departments（body={name, parent_id?}）
//   - deleteDepartment(id)：DELETE /v1/departments/:id（非 versioned，无 If-Match，D8）
//   - assignUserDepartment(departmentId, userId)：POST /v1/departments/:departmentId/users/:userId（覆盖式幂等，B4）
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/client）。
// [约束] D3：全部类型经 z.infer 派生自 contracts。
// [约束] D8：deleteDepartment 非 versioned（无 If-Match，server.ts L320 无第 5 参 true）。
//           409 DEPT_HAS_CHILDREN 不触发 client 409 重试（仅 VERSION_CONFLICT 重试，client.ts D9）。
// [约束] B4：assignUserDepartment 覆盖式幂等（重复分配同部门=200/204，无"已在该部门"码）。
// [约束] 本文件为类型派生操作（input/output 类型经 z.infer 派生），不调 safeParse。
import type {
  CreateDepartmentInput,
  Department,
  DepartmentTreeResult,
} from '@admin/contracts';
import { request } from './client.js';

/** GET /v1/departments/tree —— 部门树（递归 DepartmentTreeNode，无分页/筛选）。 */
export function getDeptTree(): Promise<DepartmentTreeResult> {
  return request<DepartmentTreeResult>('GET', '/v1/departments/tree');
}

/** POST /v1/departments —— 创建部门（body={name, parent_id?}）。parent_id 缺省为根部门。 */
export function createDepartment(input: CreateDepartmentInput): Promise<Department> {
  return request<Department>('POST', '/v1/departments', { body: input });
}

/**
 * DELETE /v1/departments/:id —— 删除部门（非 versioned，无 If-Match，D8）。
 * DEPT_HAS_CHILDREN / DEPT_NOT_FOUND 由调用方处理（§11）。
 * 409 DEPT_HAS_CHILDREN 不触发 client 重试（仅 VERSION_CONFLICT 重试）。
 */
export function deleteDepartment(id: string): Promise<void> {
  return request<void>('DELETE', `/v1/departments/${id}`);
}

/** POST /v1/departments/:departmentId/users/:userId —— 用户部门归属分配（覆盖式幂等，B4）。 */
export function assignUserDepartment(departmentId: string, userId: string): Promise<void> {
  return request<void>('POST', `/v1/departments/${departmentId}/users/${userId}`);
}
