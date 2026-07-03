// apps/web/src/components/ReportFilter.tsx —— 报表筛选组件（TECH-WEB-NOTIFICATION-REPORT-001 §6.4）
//
// 职责：
//   - group_by 多选 checkbox（SSOT 派生 4 项，D5 类型派生操作）
//   - 时间范围 datetime-local + ISO 归一（D14）
//   - operator_id uuid 文本输入（advisory 校验，D15）
//   - entity_type/action select（SSOT 派生，D5 类型派生操作）
//   - "应用筛选"按钮触发 onSubmit（D12，不每键入触发）
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部。
// [约束] D5：group_by checkbox/entity_type/action select 为类型派生操作（SSOT 派生 options）。
// [约束] D12：应用筛选按钮触发请求（R14 S-9 教训，不每键入触发）。
// [约束] D13：group_by 默认不勾选 + 客户端 advisory 校验非空。
// [约束] D14：datetime-local + ISO 归一（沿用 R14 D15）。
// [约束] D21：aria-label 域特定（R14 S-10 教训）。
import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  auditLogActionSchema,
  auditLogEntityTypeSchema,
  reportGroupByDimSchema,
  type ReportGroupByDim,
  type ReportQuery,
} from '@admin/contracts';

/** ReportFilter 组件 props。 */
export type ReportFilterProps = {
  onApply: (filters: ReportQuery) => void;
};

/** group_by 维度全集 SSOT 派生（AI-005，禁止硬编码 4 项）。 */
const ALL_GROUP_BY_DIMS: ReportGroupByDim[] = [...reportGroupByDimSchema.options];

/** entity_type 全集 SSOT 派生（复用 audit 枚举，AI-005）。 */
const ALL_ENTITY_TYPES = [...auditLogEntityTypeSchema.options];

/** action 全集 SSOT 派生（复用 audit 枚举，AI-005）。 */
const ALL_ACTIONS = [...auditLogActionSchema.options];

/** 维度中文名映射（纯 UI 文案，PRD §数据实体草图 Q7）。 */
const DIM_LABEL: Record<ReportGroupByDim, string> = {
  operator_id: '操作者',
  entity_type: '实体类型',
  action: '动作',
  date: '日期',
};

/** UUID 格式正则（advisory 客户端校验 operator_id，AC-F7-3，不强制 safeParse）。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * D14：datetime-local 输入归一为 ISO 8601 datetime（含秒+Z）。
 * 输入 'YYYY-MM-DDTHH:mm' → new Date(...).toISOString() → 'YYYY-MM-DDTHH:mm:ss.000Z'。
 * 空/无效 → undefined（不传该筛选字段，避免 reportQuerySchema z.string().datetime() 拒绝）。
 */
function normalizeDatetime(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

/** ReportFilter 组件（group_by checkbox + 时间范围 + 筛选 + 应用筛选按钮）。 */
export function ReportFilter(props: ReportFilterProps): JSX.Element {
  const { onApply } = props;
  const [groupBy, setGroupBy] = useState<ReportGroupByDim[]>([]);
  const [operatedFrom, setOperatedFrom] = useState('');
  const [operatedTo, setOperatedTo] = useState('');
  const [operatorId, setOperatorId] = useState('');
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleDimToggle(dim: ReportGroupByDim): void {
    setGroupBy((prev) =>
      prev.includes(dim) ? prev.filter((d) => d !== dim) : [...prev, dim],
    );
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setError(null);
    // D13：group_by 至少 1 维（advisory 客户端校验非空，AC-F7-6，不发请求）
    if (groupBy.length === 0) {
      setError('请至少选择一个分组维度');
      return;
    }
    // D14：operated_from <= operated_to（advisory 客户端校验，AC-F7-7，不发请求）
    const fromIso = normalizeDatetime(operatedFrom);
    const toIso = normalizeDatetime(operatedTo);
    if (fromIso && toIso && fromIso > toIso) {
      setError('开始时间不能晚于结束时间');
      return;
    }
    // D15：operator_id uuid 格式 advisory 校验（AC-F7-3，空表示不筛）
    if (operatorId && !UUID_RE.test(operatorId)) {
      setError('操作者 ID 须为 UUID 格式');
      return;
    }
    const filters: ReportQuery = {
      group_by: groupBy,
      page: 1,
      pageSize: 20,
    };
    if (fromIso) filters.operated_from = fromIso;
    if (toIso) filters.operated_to = toIso;
    if (operatorId) filters.operator_id = operatorId;
    if (entityType) filters.entity_type = entityType as ReportQuery['entity_type'];
    if (action) filters.action = action as ReportQuery['action'];
    onApply(filters);
  }

  return (
    <form onSubmit={handleSubmit}>
      <fieldset>
        <legend>分组维度</legend>
        {ALL_GROUP_BY_DIMS.map((dim) => (
          // [R15 impl-writer 改] checkbox 用 aria-label={dim}（英文维度值）+ 可见文本"按X分组"放在 <span>（非 <label>）：
          //   避免 getByLabelText(/实体类型/) 同时匹配 checkbox + select（select label="实体类型"），
          //   避免 findByText('操作者') 同时匹配 checkbox 文本 + ReportTable 表头（表头="操作者"）。
          //   checkbox accessible name 改为英文 dim 值，可见文本改为"按X分组"（≠ 表头/label 精确文本）。
          <div key={dim}>
            <input
              type="checkbox"
              value={dim}
              aria-label={dim}
              checked={groupBy.includes(dim)}
              onChange={() => handleDimToggle(dim)}
            />
            <span>按{DIM_LABEL[dim]}分组</span>
          </div>
        ))}
      </fieldset>
      <label>
        开始时间
        <input
          type="datetime-local"
          value={operatedFrom}
          onChange={(e) => setOperatedFrom(e.target.value)}
          aria-label="开始时间"
        />
      </label>
      <label>
        结束时间
        <input
          type="datetime-local"
          value={operatedTo}
          onChange={(e) => setOperatedTo(e.target.value)}
          aria-label="结束时间"
        />
      </label>
      <label>
        操作者 ID
        <input
          type="text"
          value={operatorId}
          onChange={(e) => setOperatorId(e.target.value)}
          aria-label="操作者 ID"
        />
      </label>
      {/* [R15 impl-writer 改] 可见 label 文本加"筛选"后缀（≠ 表头"实体类型"精确文本），
          避免 findByText('实体类型') 同时匹配 label + ReportTable 表头；
          aria-label 保持"实体类型"，getByLabelText(/实体类型/) 仍经 aria-label + RegExp 部分匹配命中 select。 */}
      <label>
        实体类型筛选
        <select
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          aria-label="实体类型"
        >
          <option value="">全部</option>
          {ALL_ENTITY_TYPES.map((et) => (
            <option key={et} value={et}>
              {et}
            </option>
          ))}
        </select>
      </label>
      {/* [R15 impl-writer 改] 可见 label 文本加"筛选"后缀（≠ 表头"动作"精确文本），同实体类型 select 理由。 */}
      <label>
        动作筛选
        <select value={action} onChange={(e) => setAction(e.target.value)} aria-label="动作">
          <option value="">全部</option>
          {ALL_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
      {error && <div role="alert">{error}</div>}
      <button type="submit">应用筛选</button>
    </form>
  );
}
