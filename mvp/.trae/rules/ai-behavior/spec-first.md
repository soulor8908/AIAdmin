---
alwaysApply: true
---
# AI 行为约束

## AI-001 · 先读 Spec 再写码
- 触发条件：AI 接到任何代码生成/修改任务时。
- 期望行为：必须先定位并读取 docs/spec 下对应 Tech-Spec 与 packages/contracts 下相关 schema；若未找到对应 Spec，停下并提示"缺 Spec"，禁止凭对话记忆直接写码。
- 校验方式：Reviewer subagent 扫描 diff 新增导出符号，与 `docs/spec/*.tech.md` + `packages/contracts/src/schemas/*.ts` 比对，无来源即记为越界（脚本无专属 enforcement 分支，由 Reviewer 流程校验）。

## AI-002 · 测试先行（复盘拆分 + tsc 自检）
- 触发条件：新增功能代码时。
- 期望行为：
  - 测试由独立角色 `test-writer` 先行产出，且必须包含**至少 N 条断言级红**（因逻辑未实现而失败的断言，非导入级红）；N = 测试矩阵覆盖类型数。
  - **test-writer 交付前必须自跑 `npx tsc --noEmit`，0 错误方可交付**（复盘 RETRO-ROUND3 P1 反推：语法/类型错误不是"断言级红"，是产物缺陷；tsc 错误不得漏到编排者）。注意：因实现尚未存在，import 未定义符号会报 tsc 错——这是预期的"导入级红"，test-writer 须在汇报中列出这些预期的导入级 tsc 错误（模块/符号名），与真正的语法/类型错误区分；编排者据此判断哪些红是预期、哪些是产物缺陷。
  - 实现由 `impl-writer` 后续产出，**禁止修改测试断言**（只可改测试 setup/import 路径，且须注明理由）。
  - 编排者在两阶段之间实跑 `vitest run` 确认断言级红，作为 G4 通过证据。
- 校验方式：编排者实跑 `vitest run` 收集断言级红证据 + `git diff` 检查 impl-writer 未改动测试断言行（含 `expect(` 的行）；test-writer 交付须附 tsc 自检结果（区分预期导入红 vs 缺陷），否则 G4 退回。

## AI-005 · 禁止硬编码跨域可变数据（复盘 RETRO-ROUND3 P1 反推）
- 触发条件：测试或实现中需断言/列举跨域共享的集合（权限码列表、错误码全集、实体类型枚举、状态枚举等）时。
- 期望行为：
  - 禁止在断言里硬编码跨域可变集合的字面量（如 `expect(codes).toEqual(['user:read','user:write','role:read','role:write'])`）——当 contracts 的枚举扩展时，硬编码断言会过期变红且不易定位。
  - 改用 SSOT 派生断言：从 contracts 的 schema 派生期望值，如 `expect(codes).toEqual([...permissionCodeSchema.options])`，使断言自动跟随 SSOT。
  - 例外：单领域内不可变的固定值（如某测试 fixture 的固定 id）可硬编码；但跨域共享的枚举/集合一律派生。
- 校验方式：`scripts/check-rules.mjs` AI-005 分支扫描 `apps/api/test/**/*.ts` 中 `.toEqual(\[` 或 `.toStrictEqual(\[` 后紧跟多个字符串字面量（≥3 个）且字面量匹配已知跨域枚举值模式（如 `xxx:xxx` 权限码、`XXX_XXX` 大写下划线错误码）的断言，标记为 suggestion 待人工确认是否应改为派生；Reviewer subagent 复核。

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

## AI-006 · Tech Lead 须产出受影响测试清单（复盘 RETRO-ROUND3 P1 反推）
- 触发条件：Tech Lead 改动 `packages/contracts`（共享契约层）时。
- 期望行为：
  - 当 Tech-Spec 涉及 contracts 的联动改动（新增/修改字段、扩展枚举、改错误码），Tech Lead 必须在 Tech-Spec 中产出"受影响测试清单"章节。
  - 清单生成方式：grep 引用被改符号的测试文件（如改了 `permissionCodeSchema`，则 grep 所有 import/引用 `permissionCodeSchema` 的 `apps/api/test/**/*.ts`），列出文件 + 受影响的断言位置 + 需同步更新的方向（硬编码→派生 / 数据补齐 / 类型对齐）。
  - test-writer 据此清单同步更新既有测试的断言数据，避免跨域联动击穿既有测试。
- 校验方式：Reviewer subagent 检查 Tech-Spec 是否含"受影响测试清单"章节（若 contracts 有联动改动）；清单缺失记 blocker。脚本无专属 enforcement 分支，由 Reviewer 流程校验（不触发 META-003）。
