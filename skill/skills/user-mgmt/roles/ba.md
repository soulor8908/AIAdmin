# BA 角色提示词补充：user-mgmt 域

> 本补充由 user-mgmt skill 提供，叠加到 kernel/roles/ba.md 之上。

## 域特化关注点

写 user-mgmt 域的 PRD 时，须额外覆盖以下维度（除核心 BA 提示词外）：

### 1. 用户身份与认证
- 必须明确：注册流程是否需要邮箱验证？
- 必须明确：登录支持哪些凭证类型（邮箱/用户名/手机号）？
- 必须明确：JWT TTL + refresh token 策略
- 必须明确：第三方登录是否在本期范围

### 2. 角色与权限
- 必须列出所有角色（admin / user / guest / 其他）
- 必须明确每个角色可执行的关键操作
- BLOCKING：是否需要 RBAC 层级继承（参见 rbac-spec skill）

### 3. PII 处理
- email 视为 PII，输出 schema 须标注
- 密码入参后立即哈希，禁记录到任何日志
- audit_log 中记录 user 操作时，须脱敏 email（如 `a***@b.com`）

### 4. 公共路由
- POST /users（注册）+ POST /auth/login（登录）须显式标注 `auth: public`
- 公共路由须在 PRD 中列出，BLOCKING 不允许后期临时加路由

### 5. AC 模板
每条 AC 须包含：
- Given / When / Then 三段
- 角色变更类操作须追加 "And audit_log 写入 before/after 快照"

## 域规则速查

- USER-001 唯一性 → AC 中须覆盖重复拒绝场景
- USER-002 密码哈希 → AC 中须断言 response 不含 password
- USER-003 输出剥离 → AC 中须断言 schema 拒绝多余字段
- USER-004 角色变更审计 → AC 中须有 AuditLogRepository 观测旁路
- USER-005 公共路由 → PRD 中须显式列出 public 路由清单
