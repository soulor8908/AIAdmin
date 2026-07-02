// packages/contracts/src/index.ts —— 共享契约层入口（SSOT）
// 由 Tech Lead subagent 产出具体 schema，此文件作为 re-export 聚合点。
// 注意：errorCodeSchema / ErrorCode / errorResponseSchema / ErrorResponse 仅在 user.ts 定义一次，
// 角色域复用同一枚举（已追加 ROLE_* 码），部门域复用同一枚举（已追加 DEPT_* 码），
// role.ts / dept.ts 不重复导出 errorCodeSchema，避免 export * 重名冲突。
export * from './schemas/user.js';
export * from './schemas/role.js';
export * from './schemas/dept.js';
