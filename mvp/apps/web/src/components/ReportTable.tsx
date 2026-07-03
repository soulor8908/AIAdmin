// apps/web/src/components/ReportTable.tsx —— 报表聚合表格组件（TECH-WEB-NOTIFICATION-REPORT-001 §6.5）
//
// 职责：
//   - 动态列渲染（D11）：据 result.group_by 渲染列头（维度列 + "计数"列）
//   - 每行 item 据 dim key 取值（item[dim]/item.count，AC-F7-8）
//   - group_by 变化时列头动态更新（N6 Q7 决策②动态列）
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部。
// [约束] D3：ReportResult 经 z.infer 派生。
// [约束] D11：动态列展示（据 result.group_by 渲染列头，N6 Q7 决策②）。
import type { ReportGroupByDim, ReportResult } from '@admin/contracts';

/** ReportTable 组件 props。 */
export type ReportTableProps = {
  result: ReportResult | null;
};

/**
 * 维度中文名映射（纯 UI 文案，PRD §数据实体草图 Q7，R13 S-2 不须同步 Spec §10）。
 * 用于列头展示 + checkbox label（与 ReportFilter 共享语义，此处仅本组件用列头）。
 */
const DIM_LABEL: Record<ReportGroupByDim, string> = {
  operator_id: '操作者',
  entity_type: '实体类型',
  action: '动作',
  date: '日期',
};

/** ReportTable 组件（动态列聚合表格）。
 * result=null → 返回 null（初始未应用筛选态，由 ReportPage 展示引导提示，§6.3）；
 * result.items=[] → "暂无统计数据"（AC-F7-9 空状态）。
 */
export function ReportTable(props: ReportTableProps): JSX.Element | null {
  const { result } = props;
  if (!result) return null;
  if (result.items.length === 0) {
    return <div>暂无统计数据</div>;
  }
  const dims = result.group_by;
  return (
    <table>
      <thead>
        <tr>
          {dims.map((dim) => (
            <th key={dim}>{DIM_LABEL[dim]}</th>
          ))}
          <th>计数</th>
        </tr>
      </thead>
      <tbody>
        {result.items.map((item, idx) => (
          <tr key={idx}>
            {dims.map((dim) => (
              <td key={dim}>{item[dim] !== undefined ? String(item[dim]) : ''}</td>
            ))}
            <td>{item.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
