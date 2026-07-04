# 复盘教训索引（自动生成，勿手改）
> 由 `scripts/gen-retro-index.mjs` 扫描 docs/retro/*.md 生成 · 目标 ≤6KB · 原始 retro 不动。
> 供 subagent 替代全量 retro 阅读；如需明细循"来源"读对应 roundN-retro.md。

## 已固化规则表（已反推到规则/Spec/提示词层）
| ID | 来源 | 教训 | 固化方式 |
|---|---|---|---|
| S-1 | R7 | PRD §数据实体草图与 §Q&A 决策不一致（PRD … | 已固化 |
| S-2 | R7 | [约束] 项偏离处理流程待固化（AI-003 张力） | 已固化 |
| S-1 | R8 | role-inheritance 测试 permissi… | 已固化 |
| S-2 | R8 | R8 流程未及时闭环（review/retro 缺失，回… | 已固化 |
| S-1 | R9 | Spec 起草时未预判 Zod 框架限制（ZodEffe… | 已固化 |
| S-2 | R9 | AI-006 ①类契约测断言形式缺失（行为覆盖 vs 形… | 已固化 |
| S-3 | R9 | 第八轮 retro 文件缺失（流程未闭环） | 已固化 |
| S-1 | R10 | lint:rules 对注释中 "any" 字样的误报 | 已固化 |
| S-2 | R10 | PRD 起草时对既有路由表的核验不足 | 已固化 |
| S-1 | R11 | SEC-002 扫描器方法边界盲区（根因未修） | 已固化 |
| S-2 | R11 | AI-006 ①类隐式影响未覆盖（全集断言依赖枚举值） | 已固化 |
| S-3 | R11 | PRD 影响面估算未核验测试架构 | 已固化 |
| S-1 | R12 | AC-ARCH-4 partial（F4 toggle … | 已固化 |
| S-2 | R12 | advisory 偏离反向同步未闭环（3 项 UI 文案… | 已固化 |
| S-3 | R12 | 测试覆盖缺口（4 项 AC 边界未单测） | 已固化 |
| S-4 | R12 | CODE 扫描器前端覆盖盲区 | 已固化 |
| S-5 | R12 | setupFiles 全局副作用（test-writer… | 已固化 |
| S-6 | R13 | AI-005 前端测试盲区（apps/web/test … | 已固化 |
| S-7 | R13 | 元改进轮 Review 缺失（复盘替代 Review 作… | 规则层 |
| S-8 | R14 | getDeptTree 命名偏离 Spec §4.2.2… | 已固化 |
| S-9 | R14 | AuditLogPage useEffect 每键入触发… | 已固化 |
| S-10 | R14 | RoleForm/DeptForm aria-label… | 已固化 |
| S-11 | R14 | errorMapping.ts L62-63 注释过时（… | 已固化 |
| S-12 | R14 | test-writer 测试文件数偏离 Spec §9（… | 规则层 |
| S-13 | R15 | impl-writer 测试 setup 改动增多（UU… | 已固化 |
| S-14 | R15 | ReportFilter label 消歧需实现调整（c… | 已固化 |
| S-15 | R15 | vitest testTimeout 全局放宽（非 pe… | 已固化 |
| S-16 | R15 | 报表动态列空值兜底（Reviewer suggestio… | 规则层 |
| S-17 | R16 | impl-writer 自报准确性违规（自报"未改测试断… | 已固化 |
| S-18 | R16 | errorMapping AUDIT_LOG_NOT_F… | 已固化 |
| S-19 | R16 | SetParentModal UUID_RE 重复定义（… | 已固化 |
| S-20 | R16 | AC-F4-3 user-event v14.6.1 d… | 规则层 |
| S-21 | R18 | impl-writer [约束] 偏离反向同步滞后到收尾… | Spec 模板层 |
| S-22 | R18 | test-writer 确定性 token setup … | 提示词层 |
完整明细见对应 roundN-retro.md §5 反推优化。

## 仍在生效的 S 级改进项（不阻断，待未来轮次处理）
| ID | 来源 | 内容 | 状态 |
|---|---|---|---|
_（无）_
完整明细见最新 retro §6 剩余改进项。

## 关键教训一句话版
- MVP: 跑通（G1–G7 全绿），暴露 5 类系统性问题
- R2: 跑通且验证了所有复盘优化项；暴露规则声明 vs 实现漂移新问题
- R3: 跑通；META-003/004 消除漂移；暴露跨域联动代价与 test-writer 自检缺口
- R4: 跑通；三个 P1 反推优化点全部验证生效；跨域联动实现零测试改动/零救火/可预测
- R5: 跑通（经 1 轮 blocker 修复）；三个架构方向全部落地；首次暴露测试通过 ≠ 验收对齐新边界并闭环
- R6: 跑通；第五轮反推的三项优化点全部验证生效；验收对齐门禁首次闭合，Reviewer verdict=pass 0 
- R7: 跑通；第六轮反推的更复杂业务适应性建议验证生效；新架构模式（多步事务+补偿+事务感知埋点）在既有工作流下首次落地
- R8: 跑通；第七轮反推的更复杂业务适应性建议验证生效（权限继承方向）；递归继承 + 环检测 + 读时聚合权限传递三件套
- R9: 跑通；第八轮反推的权限继承方向已落地（R8）；本期转向HTTP 协议扩展 + 并发语义方向，HTTP 条件请求（
- R10: 跑通；R9 落地 If-Match 写条件，本期落地 If-None-Match 读条件（ETag 协商缓存），
- R11: 跑通；R10 落地 ETag 读条件（单层变更），本期落地鉴权域（新业务域 + 运行时入口层替换），首次验证 s
- R12: 跑通；ARCH-003 闭合；wire 适配 advisory 范例；多约束组合副作用预判首次大规模验证
- R13: S-1~S-4 固化 + S-5 记录未来方向；元改进轮不走标准 PRD→Spec 流程；三件套绿，0 回归
- R14: 跑通；多域适应性验证；R13 固化提示词首次大规模验证；①类显式影响处理范例
- R15: 跑通；七域全覆盖；client.ts 扩展范例；通知状态机+versioned 组合；R14 教训反推生效
- R16: 跑通；后端能力前端化闭合；errorMapping 全码映射收尾；事务性+继承链+聚合三形态；impl-writ
- R17: 跑通；6 项遗留 S 级教训全部固化；S-6 探针验证（lint:rules exit 0 + AI-005 扩
- R18: 跑通；D10/D19 两项历史 advisory 偏离消除 + D9 重分类 [约束] 闭合；24 AC 全对齐
- R19: 跑通；R18 S-21/S-22 两项教训全部固化至提示词层（impl-writer + Reviewer 双向
- R20: 跑通；19 AC 全对齐（AC-E1~E14 共 14 条 E2E + AC-S5-1~S5-5 共 5 条 S
