---
alwaysApply: true
---
# PII 脱敏（复盘拆细：SEC-003 → SEC-003a/003b，消除判定灰区）

## SEC-003a · 响应不返回未声明 PII
- 触发条件：API 响应序列化时。
- 期望行为：响应体字段必须与 contracts 中声明的输出 schema 1:1；输出 schema 须 `.strict()` 拒绝多余字段；禁止返回密码/角色/部门等未声明字段。
- 校验方式：契约测用 `outputSchema.parse(response)` 断言不抛 + `outputSchema.strict()` 校验多余字段被拒；`scripts/check-rules.mjs` SEC-003a 分支扫描 contracts 输出 schema 是否带 `.strict()`。

## SEC-003b · 错误消息与日志的 PII 边界
- 触发条件：抛出错误消息或写日志时。
- 期望行为：
  - 错误消息不得回显**其他用户**的 PII（如查询他人邮箱冲突时不得回显他人邮箱）。
  - 回显**调用者自身提交**的值允许（如自己提交的邮箱冲突可回显自己的邮箱），但该错误消息不得在日志中持久化完整值（日志须脱敏：邮箱保留首 2 字符 + 域名，手机号保留后 4 位）。
  - 审计 before-after 中的 PII 须脱敏。
- 校验方式：契约测用 `outputSchema.strict()` 校验响应不含未声明 PII 字段（SEC-003a 已机器化）；错误消息的"自身 vs 他人 PII"区分需语义判断，由 Reviewer subagent 人工审查 `throw new AppError(...)` 的 message 模板（脚本不精确扫描，避免误报）；日志脱敏由 pino redact 配置 + 契约测断言。
