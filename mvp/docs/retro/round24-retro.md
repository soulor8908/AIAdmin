---
doc_type: Retrospective
id: RETRO-ROUND24-001
scope: 第二十四轮演练（业务轮 #17：跨浏览器 E2E 覆盖 firefox + webkit 多浏览器扩展 + 核心流 14 + a11y 8 跨浏览器一致性验证 = 22 × 3 = 66 tests，测试基础设施层变更，无业务代码改动）
date: 2026-07-04
verdict: 跑通；9 AC 全对齐（AC-XB-1~9，8 pass + 1 conditional-pass）；三件套全绿（typecheck exit 0 / lint:rules exit 0 / vitest 58 files 1272 tests / E2E 66 passed 1.4m）；2 项 advisory 偏离反向同步闭合（D3 workers:3→1 降级 + D4 本地系统依赖补充，5 处 Spec 章节实际编辑）；R21 固化的 S-23 第三次触发评估不触发（BA 声明核验准确，仅扩展 projects 数组无新第三方库）；R20/R23 既有成果协同保持；0 新立 S 级（D3 降级触发的"Playwright 单 worker pool 共享"核心发现属单轮 impl 阶段发现，非跨轮系统性模式缺口）
---

# 第二十四轮演练复盘 · 业务轮 #17 · 跨浏览器 E2E 覆盖 + S-23 第三次触发评估 + R20/R23 协同保持

> 本轮承接 R23 retro §6 候选清单第 1 项——跨浏览器 E2E 覆盖。本轮为业务轮（走五角色流程 BA→Tech Lead→test-writer+impl-writer 合并→Reviewer + 七道门禁），承接 R20 chromium 单浏览器 E2E 基础设施 + R23 @axe-core/playwright a11y 扫描，扩展为 firefox + webkit 多浏览器覆盖。同时是 **R21 固化的 S-23（Tech Lead 第三方库版本 API 核验缺口）的第三次触发评估业务轮**——Tech Lead 在 spec 阶段核验 @playwright/test@1.61.1 devices API 复用 + @axe-core/playwright@4.12.1 浏览器无关性 + firefox/webkit 二进制可下载性，结论为不触发（R24 不引入新第三方库）。

## 0 · 本轮目标与结果

1. **跨浏览器 E2E 覆盖** → ✅ 全部落地（D1-D8 决策 + AC-XB-1~9 9 条 AC，8 pass + 1 conditional-pass）：
   - D1 + AC-XB-1：playwright.config.ts projects 数组扩展为 chromium + firefox + webkit 三 project（每 project 用 device descriptor）
   - D2 + AC-XB-1：移除顶层 use.browserName（由 project device descriptor 的 defaultBrowserType 提供）
   - D3 + AC-XB-7：CI 并行策略 → impl 阶段降级为 workers:1 常量（[advisory] 偏离，CI 并行退化，本地仅 chromium 策略 pass）
   - D4 + AC-XB-2~5：firefox/webkit 二进制安装 + 本地系统依赖补充（[advisory]）
   - D6 + AC-XB-4/5：a11y.spec.ts 浏览器无关直接复用（不改测试代码，22 E2E × 3 = 66 tests）
   - D7 + AC-XB-7：新增 test:e2e:local = `playwright test --project=chromium`（本地仅 chromium 快速反馈）
   - AC-XB-2/3：14 核心流 E2E 在 firefox/webkit 下全绿（跨浏览器行为一致性）
   - AC-XB-4/5：8 a11y E2E 在 firefox/webkit 下 0 violations（axe-core 多浏览器一致性）
   - AC-XB-6：三浏览器全量 E2E 一致性（66 tests 全绿）
   - AC-XB-8：既有 22 E2E chromium + 1272 vitest 全绿无回归
   - AC-XB-9：S-23 第三次触发评估（不触发声明）
2. **R21 固化的 S-23 第三次触发评估** → ✅ 不触发验证：
   - Tech Lead 按 S-23 提示词在 spec 阶段核验 @playwright/test@1.61.1 devices API 复用 + @axe-core/playwright@4.12.1 浏览器无关性 + firefox/webkit 二进制可下载性
   - 4 项核验结论完整：①不引入新第三方库 ②devices 既有 API 复用 ③@axe-core/playwright 浏览器无关性 ④firefox/webkit 二进制非 npm 依赖
   - BA 声明核验准确（R24 仅扩展 projects 数组，无新第三方库）
3. **R20/R23 既有成果协同保持** → ✅ 验证通过：
   - R20 playwright.config.ts webServer 双进程 + 临时 DB 隔离 + globalTeardown 保留（浏览器无关）
   - R20 22 E2E 用例浏览器无关性核验（零硬编码 browserType() 引用）
   - R23 @axe-core/playwright a11y.spec.ts 浏览器无关直接复用
   - 既有 1272 vitest + 22 E2E chromium 全绿无回归证明 R20/R23 成果不被 R24 破坏
4. **G6 Reviewer 验收**：verdict=pass，9 AC 对齐（8 pass + 1 conditional-pass），2 项 advisory 偏离反向同步闭合（D3 降级 + D4 系统依赖），0 Blocker + 5 Suggestion

**结果速览**：typecheck ✅ exit 0 / lint:rules ✅ exit 0（META-003/META-004 双向绑定持续闭合）/ vitest ✅ 58 files 1272 tests passed（与 R23 一致零回归）/ E2E ✅ 66 passed 1.4m（chromium 22 + firefox 22 + webkit 22 三浏览器全绿）/ 改动文件 2 改 + 2 新增 docs / 9 AC 全对齐（8 pass + 1 conditional-pass）/ 2 项 advisory 偏离反向同步闭合（5 处 Spec 章节实际编辑）/ S-23 第三次触发评估不触发 / R20/R23 协同保持 / 0 新立 S 级。

## 1 · 本轮核心验证结论

### 1.1 跨浏览器 E2E 覆盖 D1-D8 全部落地（AC-XB-1~9 9 条）

| 决策 | 落地 | AC | 判定 |
|------|------|-----|------|
| D1 三 project device descriptor | playwright.config.ts projects 数组扩展 | AC-XB-1 | ✅ |
| D2 移除顶层 use.browserName | device descriptor 的 defaultBrowserType 提供 | AC-XB-1 | ✅ |
| D3 CI 并行 → 降级 workers:1 | impl 阶段 [advisory] 偏离降级 | AC-XB-7 | ✅（conditional-pass） |
| D4 firefox/webkit 二进制安装 | npx playwright install firefox webkit + install-deps | AC-XB-2~5 | ✅ |
| D5 timeout 暂不调整 | 既有 timeout 60s 余量足够 webkit | - | ✅（未触发） |
| D6 a11y.spec.ts 直接复用 | 22 E2E 浏览器无关直接复用 | AC-XB-4/5 | ✅ |
| D7 test:e2e:local | package.json scripts 新增 | AC-XB-7 | ✅ |
| D8 不引入 CI workflow | [advisory] 留 R25 | - | ✅（advisory） |

**关键设计落地**：
- **D1 三 project device descriptor**：playwright.config.ts projects 数组扩展为 chromium + firefox + webkit 三 project，每 project 用 Playwright 内置 device descriptor（`devices['Desktop Chrome']` / `devices['Desktop Firefox']` / `devices['Desktop Safari']`），device descriptor 内含 `defaultBrowserType` 字段驱动 Playwright 启动对应浏览器。
- **D2 移除顶层 use.browserName**：移除顶层 `use.browserName: 'chromium'`，由 project device descriptor 的 `defaultBrowserType` 提供浏览器类型（语义清晰，无隐式默认值误导）。
- **D3 降级 workers:1**：impl 阶段实测 CI=true workers:3 跑 66 tests = 21 passed / 45 failed（chromium DB 写竞争 + firefox/webkit browserType.launch 并发失败），按 spec §3.3 D3 + §6.3 + §10.7 预案降级为 `workers: 1` 常量。核心发现：Playwright 单 worker pool 共享 + `fullyParallel: false` 仅保证"同一 spec 文件内 test 串行"，不保证"同 project 内不同 spec 文件串行"（spec 原假设不准确）。
- **22 E2E 浏览器无关直接复用**：R20 14 核心流 + R23 8 a11y = 22 E2E 全部使用浏览器无关 Playwright API（`page.goto` / `page.getByLabel` / `page.getByRole` / `page.route` / `AxeBuilder.analyze`），零新增测试代码（22 × 3 = 66 tests 仅扩展 projects 数组自动生成）。

### 1.2 R21 固化的 S-23 第三次触发评估（不触发）

R21 retro §1.1 固化的 S-23（Tech Lead 第三方库版本 API 核验缺口）在 R22 首次触发（react-window@1.8.11）+ R23 第二次触发（jest-axe@10.0.0 + @axe-core/playwright@4.12.1）验证生效。R24 第三次触发评估：

| # | 核验结论 | Tech-Spec 标注位置 | 判定 |
|---|---------|-------------------|------|
| 1 | R24 不引入新第三方库 | §1.3 + §10.6 | @playwright/test@1.61.1（R20 已装）+ @axe-core/playwright@4.12.1（R23 已装）无新 npm 依赖（npm ls 实测确认） |
| 2 | devices['Desktop Firefox']/'Desktop Safari' 既有 API 复用 | §2.4 + §3.1 D1 + §10.6 | Tech Lead 实测 node -e 输出含 defaultBrowserType 字段，属既有 API 复用非新 API 字段 |
| 3 | @axe-core/playwright@4.12.1 浏览器无关性 | §3.6 D6 + §10.6 | AxeBuilder.analyze() 在 page context 注入 axe-core JS（浏览器无关），R23 §10.6 已核验 |
| 4 | firefox/webkit 二进制非 npm 依赖 | §2.4 + §10.6 | 浏览器二进制安装非第三方库版本核验范围 |

**S-23 触发判定**：**不触发**（BA 声明核验准确，仅扩展 projects 数组，无新第三方库）。Tech Lead 仍按 S-23 提示词在 spec 阶段核验既有 API 复用（§2.4 实测 devices 字段），属既有 API 复用核验非新库核验。

### 1.3 advisory 偏离反向同步闭合（2 项 D3/D4，5 处 Spec 章节实际编辑）

R24 共 2 项 advisory 偏离全部反向同步闭合（R18 S-21 + R19 G6.5 第四次大规模触发）：

| advisory 偏离 | Spec 反向同步落地位置 | Reviewer 核实方式 | 判定 |
|--------------|----------------------|------------------|------|
| D3 workers:3→1 降级（Playwright 单 worker pool 共享 + DB 写竞争） | §3.3 D3 + §7.3 + §10.1 + §11 AC-XB-7（4 处章节实际编辑） | Reviewer Grep + Read 双重核验确认章节已含实测证据 + 降级声明 | ✅ 闭合 |
| D4 本地系统依赖补充（沙箱 Linux 也需 install-deps） | §10.2（1 处章节实际编辑） | Reviewer Read 确认 §10.2 含 impl 阶段实测补充 + 修正原 spec 假设 | ✅ 闭合 |

**S-21 伪同步检测**（R18 固化）：5 处 [advisory] 偏离章节（§3.3 / §7.3 / §10.1 / §10.2 / §11）全部实际编辑 Tech-Spec 文件（git diff 可见），非仅代码注释声明。R19 S-21 固化的"伪同步检测"机制在 R24 第四次大规模触发并验证可复用。

### 1.4 R20/R23 既有成果协同保持

R20 chromium E2E 基础设施 + R23 @axe-core/playwright a11y 扫描在 R24 协同扩展（非冲突）：

| 既有成果 | R24 保持核验 | 判定 |
|---------|-------------|------|
| R20 playwright.config.ts webServer 双进程 | webServer 浏览器无关，三 project 共享 | ✅ 保持 |
| R20 临时 DB 隔离 | globalTeardown 浏览器无关，每 run 全新临时 DB | ✅ 保持 |
| R20 22 E2E 浏览器无关 API | grep 确认零硬编码 browserType() 引用 | ✅ 保持 |
| R23 @axe-core/playwright a11y.spec.ts | AxeBuilder.analyze() 浏览器无关直接复用 | ✅ 保持 |
| R23 useFocusTrap hook + :focus-visible CSS | apps/web/src 零改动 | ✅ 保持 |

**协同保持验证结论**：既有 1272 vitest + 22 E2E chromium 全绿无回归证明 R20/R23 成果不被 R24 破坏。

### 1.5 G6 Reviewer 验收

verdict=pass，关键证据：
- 三件套全绿：typecheck exit 0 + lint:rules exit 0 + vitest 58 files/1272 tests（与 R23 一致零回归）+ E2E 66 passed（三浏览器一次性全绿无 flaky）
- 9 AC 全部对齐：8 pass + 1 conditional-pass（AC-XB-7 CI 并行部分降级为 advisory 可接受范围）
- 2 项 advisory 偏离反向同步闭合（D3 降级 + D4 系统依赖，5 处 Spec 章节实际编辑）
- S-23 第三次触发评估不触发（4 项核验结论 + 不触发声明）
- R20/R23 协同保持（既有测试全绿无回归证明）
- impl-writer 自报准确（S-17 通过）：git status 与自报清单一致（2 改 + 2 新增 docs）

5 项非 BLOCKING Suggestion（Reviewer Suggestion，非阻断）：
1. firefox/webkit project retries 调整为 1-2（当前 retries:0，firefox 首次跑可能 flaky）
2. CI 并行恢复（D3 未闭合优化项，留 R25 重新设计隔离方案）
3. CI workflow 文件引入（D8 未闭合项，留 R25）
4. R23 3 项 Reviewer Suggestion 收尾闭合（留 R25）
5. R22 Advisory #1 TS baseUrl 弃用（留 R25）

## 2 · 本轮新发现的问题（S 级，不阻断）

本轮无新发现 S 级教训。Reviewer 不建议立 S 级，理由：

### D3 降级触发的"Playwright 单 worker pool 共享"核心发现——是否立 S-24？

**现象**：spec §3.3 D3 原假设"Playwright 按 project 分配 worker（每 project 独立 worker pool），同 project 内 test 文件串行"。impl 阶段实测发现：Playwright 单 worker pool 共享 + `fullyParallel: false` 仅保证"同一 spec 文件内 test 串行"，不保证"同 project 内不同 spec 文件串行"——workers > 1 时同 project 内不同 spec 文件会被分配到不同 worker 并发跑。

**Reviewer 不建议立 S-24 的理由**：
1. **属 Playwright 行为一次性知识缺口**：Playwright worker pool 行为是 Playwright 框架知识（非跨轮系统性模式），Tech Lead 在 spec 阶段写 D3 时未核验 Playwright worker pool 实际行为，属一次性知识缺口。
2. **spec §3.3 D3 + §6.3 + §10.7 已预期此场景为 [advisory] 偏离**：spec 明示"若 impl 阶段 CI 并行 66 tests 出 SQLITE_BUSY 或 DB 写竞争，降级为方案 C"，impl-writer 按 spec 预案执行降级，未引入新决策。
3. **R18 S-21 反向同步机制已覆盖响应闭环**：impl-writer 在 impl 阶段发现后按 R19 S-21 固化机制实际编辑 Tech-Spec §3.3/§7.3/§10.1/§11 反向同步标注，反向同步机制已覆盖响应闭环。
4. **S 级教训体系保持精简**：S-23 已连续三轮业务轮触发评估可复用（R22 react-window + R23 jest-axe/@axe-core/playwright + R24 不触发评估），S 级教训体系保持精简即可。

**判定**：不立 S-24。D3 降级触发的"Playwright 单 worker pool 共享"核心发现属 Playwright 框架一次性知识缺口，非跨轮系统性模式，R18 S-21 反向同步机制已覆盖响应闭环。

## 3 · 量化对比（二十四轮演进表）

| 指标 | R20 | R21 | R22 | R23 | R24 |
|---|---|---|---|---|---|
| 用例数（vitest） | 1256（无回归） | 1256（无源码改动） | 1263（+7 性能专项） | 1272（+9 jest-axe a11y） | **1272**（零新增，跨浏览器扩展不改 vitest） |
| 用例数（E2E） | 14（新增） | 14 | 14 | 22（+8 @axe-core/playwright） | **66**（22 × 3 浏览器，零新增测试代码） |
| 累计用例 | 1256 vitest + 14 E2E | 1256 vitest + 14 E2E | 1263 vitest + 14 E2E | 1272 vitest + 22 E2E | **1272 vitest + 66 E2E** |
| blocker | 0 | 0 | 0 | 0 | 0 |
| suggestion/advisory | 5（非阻断） | N/A（元改进轮） | 1（既有/环境性） | 3（cosmetic + 测试覆盖扩展） | **5**（retries + CI 并行恢复 + CI workflow + R23 收尾 + R22 Advisory） |
| Reviewer verdict | pass | N/A（G6.5） | pass | pass | **pass** |
| AC 对齐 | 19/19 | N/A | 15/15 | 11/11 | **9/9**（8 pass + 1 conditional-pass） |
| 影响层 | 测试基础设施层 | 元资产层 | 前端性能层 | 前端可访问性层 | **测试基础设施层**（playwright.config.ts + package.json scripts，零业务代码改动） |
| 新架构模式 | E2E 三真实联调 + vitest workspace | 元改进轮 #4（固化 S-23） | 前端性能加固 | 可访问性深化 | **跨浏览器 E2E 覆盖**（firefox + webkit 多浏览器扩展） |
| 轮次类型 | 业务 | 元改进 | 业务 | 业务 | **业务**（第 17 个） |
| 提示词骨架条数 | 5角色+25条 | 5角色+27条 | 5角色+27条 | 5角色+27条 | **5角色+27条**（R21 固化 S-23 在 R24 第三次触发评估不触发，无新固化） |
| 固化教训数（本轮） | 0 | 1（S-23）+ 1 衍生 | 0 | 0 | **0**（无新发现 S 级，S-23 第三次触发评估不触发） |

> R24 E2E 用例数 66 = R23 22 × 3 浏览器（chromium + firefox + webkit），零新增测试代码（22 E2E 浏览器无关直接复用）。vitest 1272 与 R23 一致零回归。lint:rules exit 0 + META-003/META-004 双向绑定持续闭合。

## 4 · 二十四轮演进脉络

- **第二十轮**：业务轮 #14（引入 Playwright E2E 测试 + 闭合 R12 遗留 S-5）。E2E 三真实联调覆盖核心流全链路（login → users → roles → transfer → 登出，14 AC）。S-5 经 9 轮最终闭合。R18 S-21 首次大规模触发验证生效。retro 耗时根因分析新发现 S-23。
- **第二十一轮**：元改进轮 #4（固化 R20 S-23 共 1 项教训 + BA 凭据核验衍生），S-23 两层固化。
- **第二十二轮**：业务轮 #15（前端性能加固 React.memo + react-window + React.lazy）。R21 固化的 S-23 首次触发验证生效（react-window@1.8.11）。
- **第二十三轮**：业务轮 #16（可访问性深化 modal focus trap/ESC/restore + Tab + :focus-visible + axe-core 双轨 WCAG AA）。R21 固化的 S-23 第二次触发验证生效（jest-axe@10.0.0 + @axe-core/playwright@4.12.1）。
- **第二十四轮**：**业务轮 #17**（跨浏览器 E2E 覆盖 firefox + webkit 多浏览器扩展 + 核心流 14 + a11y 8 跨浏览器一致性验证 = 22 × 3 = 66 tests）。测试基础设施层变更（playwright.config.ts + package.json scripts，零业务代码改动 + 零新增测试代码）。**R21 固化的 S-23 第三次触发评估不触发**——R24 仅扩展既有 @playwright/test@1.61.1 projects API + devices 既有 API 复用，无新第三方库。R20/R23 既有成果协同保持。D3 降级（workers:3→1）+ D4 系统依赖 2 项 advisory 偏离反向同步闭合（5 处 Spec 章节实际编辑）。Reviewer 不建议立新 S 级（D3 降级触发的"Playwright 单 worker pool 共享"核心发现属 Playwright 框架一次性知识缺口，非跨轮系统性模式）。

## 5 · 反推优化三个层面执行情况

### 5.1 规则层执行情况

| 反推项 | R24 状态 | 证据 |
|---|---|---|
| META-003 声明即实现 | ✅ 持续闭合 | lint:rules exit 0 |
| META-004 实现即声明 | ✅ 持续闭合 | 无新增 enforcement ID |
| ARCH-001/002/003 | ✅ 全部保持 | git status 确认零业务代码改动 |

### 5.2 Spec 模板层执行情况

| 反推项 | R24 状态 | 证据 |
|---|---|---|
| R18 S-21 [约束] 偏离反向同步闭环性 | ✅ R24 第四次大规模触发验证生效 | D3 降级 [advisory] 偏离 5 处 Spec 章节实际编辑 |
| R20 S-23 第三方库版本 API 差异 | ✅ R24 第三次触发评估不触发 | Tech Lead spec 阶段核验既有 API 复用（devices）+ §10.6 4 项核验结论 + 不触发声明 |
| §10 组合副作用预判范式（R17 固化） | ✅ 持续生效 + §10.1 impl 阶段已触发降级 | §10.1 预判 DB 写竞争 → impl 阶段实测触发 → 降级执行 + 反向同步 |

### 5.3 提示词层执行情况

| 固化项 | 角色 | R24 状态 | 证据 |
|---|---|---|---|
| S-21 Tech Lead §10 预判 [约束] 偏离反向同步闭环性 | Tech Lead | ✅ R24 第四次大规模触发 | §10.1/§10.8 预判已落 |
| S-21 impl-writer 反向同步同标准 | impl-writer | ✅ R24 第四次大规模触发验证生效 | D3 降级 5 处 Spec 章节实际编辑 |
| S-21 Reviewer 闸门核验 | Reviewer | ✅ R24 第四次大规模触发验证生效 | Grep + Read 双重核验 5 处 [advisory] 偏离章节实际编辑 |
| S-23 Tech Lead §10 预判第三方库版本 API 差异 | Tech Lead | ✅ R24 第三次触发评估不触发 | §10.6 4 项核验结论 + 不触发声明 |
| S-17 impl-writer 自报准确性 | impl-writer | ✅ 持续生效 | git status 与自报清单一致 |

**合计**：R24 后提示词骨架共 5 角色 + 27 条固化项持续生效（R24 无新固化，R21 固化的 S-23 在 R24 第三次触发评估不触发）。

## 6 · 结论 + 剩余改进项

第二十四轮是"业务轮 #17 · 跨浏览器 E2E 覆盖 + S-23 第三次触发评估不触发 + R20/R23 协同保持"的标志——承接 R23 retro §6 候选清单第 1 项，本轮完成跨浏览器 E2E 扩展（22 × 3 = 66 tests 全绿）+ S-23 第三次触发评估不触发（BA 声明核验准确）+ R20/R23 既有成果协同保持。

关键证据：
1. **跨浏览器 E2E 覆盖 D1-D8 全部落地**：playwright.config.ts projects 数组扩展为三 project（chromium + firefox + webkit）+ 移除顶层 use.browserName + workers:1 降级 + test:e2e:local 本地仅 chromium。22 E2E 浏览器无关直接复用为 66 tests（零新增测试代码）。
2. **S-23 第三次触发评估不触发**：R24 仅扩展既有 @playwright/test@1.61.1 projects API + devices 既有 API 复用，无新第三方库。Tech Lead 在 spec 阶段核验 4 项结论 + §10.6 反向同步标注。
3. **R20/R23 协同保持**：既有 1272 vitest + 22 E2E chromium 全绿无回归证明 R20/R23 成果不被 R24 破坏。
4. **D3 降级 + D4 系统依赖 advisory 偏离反向同步闭合**：impl 阶段实测发现 Playwright 单 worker pool 共享（spec 原假设不准确），按 spec 预案降级为 workers:1。5 处 Spec 章节实际编辑（§3.3/§7.3/§10.1/§10.2/§11），R18 S-21 + R19 G6.5 第四次大规模触发验证可复用。

剩余改进项（S 级，不阻断）：
- **本轮无新立 S 级**：5 项 Reviewer Suggestion 全部非阻断，建议 R25 项目维护轮处理。
- **既有 S 级全部持续生效**：S-23（R21 固化）在 R24 第三次触发评估不触发，无新固化需求。

> **下一轮候选**（按 R23 §6 + R24 §6 状态排序）：
> 1. **R25 项目维护轮**（修复 R22 Advisory #1 TS baseUrl 弃用 + R23 3 项 Suggestion 收尾 + R24 5 项 Suggestion 收尾 + CI 并行恢复 + CI workflow 引入）—— 元改进轮 #5，可走 G6.5 第四次落地。
> 2. **R26 screen reader 端到端人工核验**（须搭建真实 NVDA/JAWS/VoiceOver 环境，CI 不可重复，成本最高）—— R23 已留 future。
