# BA 角色提示词补充：audit-log 域

> 本补充由 audit-log skill 提供，叠加到 kernel/roles/ba.md 之上。

## 域特化关注点

### 1. 审计场景清单
PRD 须明确列出所有需审计的业务操作：
- 用户角色变更（assignRole / revokeRole）
- 用户登录（成功 / 失败均记录）
- 用户删除
- 配置变更（feature flag / system settings）
- 其他 mutations（create / update / delete）

### 2. 快照粒度
- before / after 是完整对象还是 diff？PRD 须拍板
- 默认建议：完整对象快照（审计场景下 diff 可能丢失上下文）

### 3. PII 范围
- 明确列出 actor_email / target_email / IP 是否视为 PII
- 默认：邮箱脱敏，IP 不脱敏（合规场景另议）

### 4. 查询权限
- 仅 admin 可查询审计日志
- 跨租户查询须额外校验（参见 multi-tenant 场景）

### 5. 异步 vs 同步
- 同步写入：业务流程阻断，但 audit 保证一致
- 异步写入：性能好，但有丢失风险
- BLOCKING：须明确选择

## 域规则速查

- AUDIT-001 append-only → AC 须断言 repository 不暴露 update/delete
- AUDIT-002 before/after → AC 须有 AuditLogRepository 观测旁路
- AUDIT-003 PII 脱敏 → AC 须断言 response.actor_email 已脱敏
- AUDIT-004 操作人不可伪造 → AC 须断言 actor_id 来自 ctx
