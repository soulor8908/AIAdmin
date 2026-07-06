// inject/rule-injector/types.ts —— P2-4 渐进式规则注入类型

export type SeverityLevel = 'advisory' | 'warning' | 'blocking';

export interface InjectionConfig {
  /** 注入目录（默认 .ai-spec/） */
  out_dir: string;
  /** 默认级别（注入时新规则的初始级别） */
  default_level: SeverityLevel;
  /** 各规则的级别覆盖（ruleId → level） */
  overrides: Record<string, SeverityLevel>;
  /** 是否 dry-run（只生成计划不写入） */
  dry_run: boolean;
}

export interface InjectionPlan {
  /** 计划生成时间 ISO */
  generated_at: string;
  /** 全部待写入项 */
  writes: InjectionWrite[];
  /** 影响范围摘要 */
  impact: {
    new_files: number;
    modified_files: number;
    rules_count: number;
    advisory_count: number;
    warning_count: number;
    blocking_count: number;
  };
  /** 回滚点（备份目录） */
  backup_dir?: string;
  /** dry-run 标记 */
  dry_run: boolean;
  /** markdown 计划（人可读） */
  markdown: string;
}

export interface InjectionWrite {
  /** 目标文件相对 root */
  path: string;
  /** 写入内容 */
  content: string;
  /** 是否新建文件 */
  is_new: boolean;
  /** 备份路径（若改既有文件，备份到此） */
  backup_path?: string;
  /** 关联规则 ID */
  rule_ids?: string[];
  /** 该文件规则的级别 */
  severity?: SeverityLevel;
  /** 写入原因 */
  reason: string;
}

/**
 * 规则的"升级就绪"判定标准。
 */
export interface RuleReadinessCriteria {
  rule_id: string;
  /** advisory → warning 的判定（人工填） */
  to_warning_when: string;
  /** warning → blocking 的判定 */
  to_blocking_when: string;
  /** 当前级别 */
  current: SeverityLevel;
}
