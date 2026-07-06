// inject/arch-analyzer/types.ts —— 架构分析器类型定义
// P2-2 产出：分层报告 + 违规检测的数据结构。

/**
 * 分层分析结果。
 */
export interface ArchAnalysis {
  /** 项目根目录 */
  root_dir: string;
  /** 探测时的语言 */
  language: string;
  /** 识别到的分层 */
  layers: LayerInfo[];
  /** 分层违规 */
  violations: ArchViolation[];
  /** 统计指标 */
  stats: ArchStats;
  /** markdown 报告（人可读） */
  markdown_report: string;
  /** 探测警告 */
  warnings: string[];
}

export interface LayerInfo {
  /** 通用层名（domain / repository / service / router / controller / view 等） */
  name: string;
  /** 实际目录路径（相对 root_dir） */
  directories: string[];
  /** 文件数 */
  file_count: number;
  /** 顶层导出符号（如 class / function 名） */
  exports: string[];
  /** 识别置信度 0-1 */
  confidence: number;
}

export interface ArchViolation {
  /** 违规类型 */
  kind:
    | 'reverse-import' // 反向依赖（如 domain import router）
    | 'cross-layer-direct' // 跨层直连（如 router 直接 import repository）
    | 'cycle'; // 循环依赖
  /** 起点文件（相对 root_dir） */
  from: string;
  /** 终点文件（相对 root_dir） */
  to: string;
  /** 违规描述 */
  message: string;
  /** 严重度 */
  severity: 'error' | 'warning' | 'info';
}

export interface ArchStats {
  /** 总文件数 */
  total_files: number;
  /** 总 import 数 */
  total_imports: number;
  /** 跨层 import 数 */
  cross_layer_imports: number;
  /** 违规数 */
  violation_count: number;
  /** 分层覆盖率（识别到分层的文件 / 总源码文件） */
  layer_coverage: number;
}
