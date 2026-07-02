---
alwaysApply: true
---
# AI 行为约束

## AI-001 · 先读 Spec 再写码
- 触发条件：AI 接到任何代码生成/修改任务时。
- 期望行为：必须先定位并读取 docs/spec 下对应 Tech-Spec 与 packages/contracts 下相关 schema；若未找到对应 Spec，停下并提示"缺 Spec"，禁止凭对话记忆直接写码。
- 校验方式：Reviewer 检查"是否存在未在 Spec 中声明的新增 schema/路由"。

## AI-002 · 测试先行
- 触发条件：新增功能代码时。
- 期望行为：先生成测试用例并确认其为红（失败），再写实现使其转绿；禁止先实现后补测试。
- 校验方式：Dev 须分两步提交（先 test 红，后 impl 绿），最终 test 全绿。

## AI-003 · 禁止越界发挥
- 触发条件：AI 欲新增 Spec 未提及的字段、路由、依赖时。
- 期望行为：停下回报"超出 Spec 范围：{{项}}"，不得擅自扩展。
- 校验方式：diff 中新增导出符号必须在 contracts/spec 中有定义来源。

## AI-004 · 每次改动必跑三件套
- 触发条件：AI 完成一批代码改动、提交前。
- 期望行为：必须执行 `npm run typecheck && npm run lint:rules && npm test`，全绿方可提交。
- 校验方式：门禁脚本。
