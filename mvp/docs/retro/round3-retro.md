---
doc_type: Retrospective
id: RETRO-ROUND3-001
scope: 第三轮演练（部门管理·跨域）+ META-003/004 双向绑定
date: 2026-07-02
verdict: 跑通；META-003/004 消除漂移；暴露跨域联动代价与 test-writer 自检缺口
---

# 第三轮演练复盘 · 部门管理 + META-003/004 双向绑定

## 0 · 本轮目标与结果
1. 实现 META-003/004 双向绑定（规则文档 ↔ 脚本 enforcement）→ ✅ 12 分支双向一致，漂移测试通过
2. 第三领域（部门管理，含 user↔dept 跨域依赖）验证工作流 → ✅ 200 用例全绿
3. 检验 META-003/004 是否真能抓出漂移 → ✅ 两类漂移测试均精准拦截

## 1 · 本轮新发现的问题

### P1 · 跨域联动击穿既有测试（test-writer 提示词缺陷）
**现象**：dept 契约加了 `dept:read`/`dept:write` 权限码后，role.test.ts:130 的 `expect(ALL_PERMISSION_CODES).toEqual([4个码])` 断言过期变红。这是跨域联动的真实代价——一个领域的契约改动破坏了另一领域的测试。

**根因**：test-writer 在断言里**硬编码了跨域可变数据**（权限码枚举列表）。当 contracts 的 permissionCodeSchema 扩展时，硬编码断言无法自动感知。

**反推优化**：
- **test-writer 提示词**：禁止在断言里硬编码跨域可变集合（如权限码列表、错误码全集）；改用派生断言——`expect(ALL_PERMISSION_CODES).toEqual([...permissionCodeSchema.options])`（从 SSOT 派生，自动跟随）。
- **工作流**：Tech Lead 改 contracts 时，须输出"受影响测试清单"（grep 引用变更符号的测试文件），test-writer 据此同步更新断言数据。

### P1 · test-writer 产出未自跑 tsc（语法/类型错误漏出）
**现象**：test-writer 产出 dept.test.ts 含 1 处语法错误（await 在非 async 箭头函数内）+ 14 处 `noUncheckedIndexedAccess` 类型错误（数组索引访问未加 `!`）。编排者实跑才发现。

**根因**：test-writer 提示词要求"不要跑 vitest，留给编排者确认红"，但没要求跑 `tsc --noEmit` 自检。语法/类型错误本应在 test-writer 阶段就消除，却漏到编排者。

**反推优化**：
- **test-writer 提示词**：交付前必须跑 `npx tsc --noEmit` 自检，0 错误方可交付（语法/类型错误不是"断言级红"，是产物缺陷）。
- **G4 门禁**：编排者确认红时，若红的原因是语法/类型错误而非"实现缺失"，判 G4 失败，退回 test-writer 修复。

### P2 · META-003/004 规则文档自身描述漂移（元规则的自我讽刺）
**现象**：Reviewer 发现 META-003/004 规则文档描述 enforcement 载体为"`// === XXX-NNN ===` 注释"，但脚本实际用 `markEnforcement('<ID>')` 函数注册。元规则自身存在描述漂移——若 META-003 校验自身会报自己漂移。

**根因**：META-003/004 设计时，规则文档措辞先于脚本实现确定，用了注释格式假设；脚本实现改用函数注册更优雅，但文档未同步。这正是 META-003/004 要解决的漂移问题，却发生在 META-003/004 自身。

**修复**：已对齐文档描述为 `markEnforcement('<ID>')` 注册。但这暴露元规则的递归风险——**谁来校验元规则的元规则？**

**反推优化**：META-003/004 的 enforcement 载体描述必须与脚本实现字面一致；建议规则文档里直接引用脚本里的函数名/注释格式作为规范，而非自创描述。

### P2 · SEC-003a strict 校验对 optional 字段的盲区
**现象**：Reviewer 发现 user service 的 create 方法未显式设 `department_id: null`（Spec 要求显式携带），但因 userSchema 的 department_id 是 optional，tsc 与 SEC-003a strict 校验都漏过——strict 只查"多余字段"，不查"缺失字段"。

**根因**：SEC-003a 的 `.strict()` 校验的是"响应不含未声明字段"，不校验"声明字段是否显式赋值"。optional 字段缺失时 `parse` 不报错。

**反推优化**：
- **契约设计**：跨域联动的可选字段若 Spec 要求"显式携带"，schema 应考虑用 `.default(null)` 而非 `.optional()`，使缺失时自动填充 null 并可被 strict 校验。
- **或 SEC-003a 增强**：对 Spec 标注"显式携带"的字段，契约测断言 `expect(result).toHaveProperty('department_id')`。

## 2 · 量化对比（三轮）

| 指标 | 第一轮(user) | 第二轮(role) | 第三轮(dept) |
|---|---|---|---|
| 用例数 | 35 | 73 | 92 |
| 累计用例 | 35 | 108 | 200 |
| blocker 数 | 1 | 0 | 0 |
| suggestion 数 | 6 | 6 | 4 |
| 规则机器化覆盖率 | 56% | 100% | 100% |
| 规则双向绑定 | 无 | 无 | META-003/004 双消除 |
| 跨域联动 | 无 | 无 | 3 文件联动 |
| test-writer 自检 | 无 | 无 | 暴露语法/类型漏出 |
| BLOCKING 误漏 | 是 | 否 | 否（BA 自主决策） |

## 3 · 三轮演练的演进脉络
- **第一轮**：建立工作流主干，暴露"规则可校验性"P0 缺口。
- **第二轮**：补强规则机器化至 100%，验证测试先行拆分与 BLOCKING/advisory，暴露"声明 vs 实现漂移"。
- **第三轮**：实现 META-003/004 双向绑定消除漂移，验证跨域联动，暴露"test-writer 自检缺口"与"跨域测试数据硬编码"。

每轮都让体系更自洽，但每轮都暴露新的边界——这证明**AI 原生工作流是一个活系统，需要持续演练驱动演进**。

## 4 · 结论
META-003/004 双向绑定成功消除了第二轮发现的"声明漂移"与"反向缺口"——这是元约束的价值：用规则守护规则。但第三轮证明，即使元约束到位，**跨域联动与产物自检**仍是薄弱环节。下一轮优先级：
1. test-writer 提示词加 tsc 自检 + 禁止硬编码跨域可变数据
2. Tech Lead 产出"受影响测试清单"
3. 探索 optional 字段的 strict 增强方案

> 元规则解决规则的漂移，但产物的质量仍需产物级的自检闭环。规则是骨架，自检是肌肉。
