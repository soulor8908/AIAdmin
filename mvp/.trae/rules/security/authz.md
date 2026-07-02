---
alwaysApply: true
---
# 鉴权与越权

## SEC-001 · 路由默认受保护
- 触发条件：新增 router procedure 时。
- 期望行为：默认 require auth；公开路由必须显式标注 public 并在注释说明理由。
- 校验方式：Reviewer 检查每个 procedure 是否声明权限要求。

## SEC-002 · 越权校验在 service 层
- 触发条件：service 方法读取/写入资源时。
- 期望行为：必须校验调用者权限；禁止仅依赖前端隐藏按钮；用 requirePermission 守卫。
- 校验方式：Reviewer 检查 service 入口存在权限校验调用。

## SEC-003 · PII 脱敏
- 触发条件：输出日志/审计/响应时。
- 期望行为：email/phone 在审计 before-after 中脱敏；API 响应不返回非必要 PII。
- 校验方式：契约测校验响应 schema 不含未声明 PII。
