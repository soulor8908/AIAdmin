---
alwaysApply: true
---
# AI 行为约束

## AI-001 · 先读 Spec 再写码
- 触发条件：AI 接到任何代码生成/修改任务时。
- 期望行为：必须先定位并读取 docs/spec 下对应 Tech-Spec 与 packages/contracts 下相关 schema；若未找到对应 Spec，停下并提示"缺 Spec"，禁止凭对话记忆直接写码。
- 校验方式：Reviewer subagent 扫描 diff 新增导出符号，与 `docs/spec/*.tech.md` + `packages/contracts/src/schemas/*.ts` 比对，无来源即记为越界（脚本无专属 enforcement 分支，由 Reviewer 流程校验）。

## AI-002 · 测试先行（复盘拆分：test-writer 与 impl-writer 分离）
- 触发条件：新增功能代码时。
- 期望行为：
  - 测试由独立角色 `test-writer` 先行产出，且必须包含**至少 N 条断言级红**（因逻辑未实现而失败的断言，非导入级红）；N = 测试矩阵覆盖类型数。
  - 实现由 `impl-writer` 后续产出，**禁止修改测试断言**（只可改测试 setup/import 路径，且须注明理由）。
  - 编排者在两阶段之间实跑 `vitest run` 确认断言级红，作为 G4 通过证据。
- 校验方式：编排者实跑 `vitest run` 收集断言级红证据 + `git diff` 检查 impl-writer 未改动测试断言行（含 `expect(` 的行）。

## AI-003 · 禁止越界发挥（复盘细化：advisory 偏离须反向同步）
- 触发条件：AI 欲新增 Spec 未提及的字段、路由、依赖时。
- 期望行为：
  - 对 Spec 的 `[约束]` 项：禁止偏离，偏离即越界，停下回报。
  - 对 Spec 的 `[advisory]` 项：允许偏离，但必须在 PR 描述写"反向同步 Spec：{{项}}"，并相应更新 Tech-Spec，消除单向漂移。
  - 对 Spec 未提及项：一律禁止，停下回报"超出 Spec 范围：{{项}}"。
- 校验方式：Reviewer subagent 扫描 diff 新增导出符号在 `docs/spec` + contracts 有来源；advisory 偏离检查 PR 描述含"反向同步 Spec"字样，无则记 blocker。

## AI-004 · 每次改动必跑三件套
- 触发条件：AI 完成一批代码改动、提交前。
- 期望行为：必须执行 `npm run typecheck && npm run lint:rules && npm test`，全绿方可提交。
- 校验方式：CI（GitHub Actions）执行 `tsc --noEmit` + `node scripts/check-rules.mjs`（整体脚本，非专属校验）+ `vitest run`，任一失败阻断合入；本地 pre-commit hook 同步。AI-004 本身无 check-rules.mjs 专属 enforcement，其"必跑三件套"由 CI 整体执行保障（不触发 META-003）。
