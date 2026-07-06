// intelligence/spec-completeness.ts —— P3-5 智能化占位：Spec 完整性评分器
// 给定一份 Tech-Spec markdown，按章节存在性 + 字段填充率打分（0-100）。
//
// 设计：
// - 9 个章节，每个权重不同（核心章节 12 分，辅助章节 8 分）
// - 字段填充率：每个章节内统计 "已填字段 / 应填字段"（基于占位符 {{...}} 检测）
// - 输出 markdown 报告 + 0-100 分 + 改进建议
// - 占位实现：长期演进方向是基于规则集的自动补全建议（参见 P3-5 路线图）

import { readFileSync, existsSync } from 'node:fs';

/** Spec 章节定义 + 权重 */
interface SpecSection {
  /** 章节编号 */
  id: string;
  /** 章节标题关键词（用于在 markdown 中匹配） */
  title_keywords: string[];
  /** 权重（满分） */
  max_score: number;
  /** 应填字段清单（用于填充率检测） */
  expected_fields: string[];
}

const SECTIONS: SpecSection[] = [
  {
    id: '1-context',
    title_keywords: ['上下文', '背景', 'context'],
    max_score: 8,
    expected_fields: ['背景', '现状', '目标'],
  },
  {
    id: '2-architecture',
    title_keywords: ['架构', '层映射', 'architecture'],
    max_score: 12,
    expected_fields: ['domain', 'repository', 'service', 'router'],
  },
  {
    id: '3-contract',
    title_keywords: ['契约', 'contract', 'schema'],
    max_score: 12,
    expected_fields: ['output', 'storage', 'input', 'enum'],
  },
  {
    id: '4-rules',
    title_keywords: ['规则', '受影响', 'rules'],
    max_score: 12,
    expected_fields: ['ARCH', 'SEC', 'CODE', 'USER', 'AUDIT'],
  },
  {
    id: '5-data-model',
    title_keywords: ['数据模型', '数据库', 'data model', 'sql'],
    max_score: 10,
    expected_fields: ['CREATE TABLE', 'PRIMARY KEY', 'TIMESTAMPTZ'],
  },
  {
    id: '6-errors',
    title_keywords: ['错误码', 'error code', 'errors'],
    max_score: 10,
    expected_fields: ['DUPLICATE', 'NOT_FOUND', 'INVALID'],
  },
  {
    id: '7-tests',
    title_keywords: ['测试', '断言', 'tests', 'test case'],
    max_score: 12,
    expected_fields: ['Given', 'When', 'Then', '断言'],
  },
  {
    id: '8-blocking',
    title_keywords: ['BLOCKING', '决策', 'blocking'],
    max_score: 8,
    expected_fields: ['Q1', '决定'],
  },
  {
    id: '9-impact',
    title_keywords: ['受影响清单', '影响', 'impact'],
    max_score: 8,
    expected_fields: ['contracts', 'router', 'service'],
  },
];

export interface SectionScore {
  section_id: string;
  found: boolean;
  field_coverage: number; // 0-1
  score: number; // 0-max_score
  missing_fields: string[];
}

export interface SpecScoreResult {
  /** 总分（0-100） */
  total_score: number;
  /** 各章节得分 */
  sections: SectionScore[];
  /** 改进建议 */
  suggestions: string[];
  /** markdown 报告 */
  markdown_report: string;
}

/**
 * 评估 Spec 完整性。
 * @param specPath Tech-Spec markdown 文件路径
 */
export function scoreSpec(specPath: string): SpecScoreResult {
  if (!existsSync(specPath)) {
    return notFound(specPath);
  }

  const content = readFileSync(specPath, 'utf8');
  const sections: SectionScore[] = [];
  let totalScore = 0;
  const suggestions: string[] = [];

  for (const section of SECTIONS) {
    const found = findSection(content, section.title_keywords);
    const fieldResult = found ? checkFields(content, section.expected_fields) : { coverage: 0, missing: section.expected_fields };
    const score = found ? Math.round(section.max_score * fieldResult.coverage) : 0;
    sections.push({
      section_id: section.id,
      found,
      field_coverage: fieldResult.coverage,
      score,
      missing_fields: fieldResult.missing,
    });
    totalScore += score;

    if (!found) {
      suggestions.push(`缺章节：${section.id}（关键词：${section.title_keywords.join('/')}）`);
    } else if (fieldResult.coverage < 0.5) {
      suggestions.push(
        `章节 ${section.id} 字段填充率仅 ${Math.round(fieldResult.coverage * 100)}%，缺：${fieldResult.missing.join(', ')}`,
      );
    }
  }

  // 总分归一化到 0-100
  const maxTotal = SECTIONS.reduce((sum, s) => sum + s.max_score, 0);
  const normalizedScore = Math.round((totalScore / maxTotal) * 100);

  return {
    total_score: normalizedScore,
    sections,
    suggestions,
    markdown_report: renderReport(specPath, normalizedScore, sections, suggestions),
  };
}

// ============ 内部辅助 ============

function notFound(specPath: string): SpecScoreResult {
  return {
    total_score: 0,
    sections: [],
    suggestions: [`Spec 文件不存在：${specPath}`],
    markdown_report: `# Spec 完整性评分\n\n❌ 文件不存在：${specPath}\n`,
  };
}

function findSection(content: string, keywords: string[]): boolean {
  // 找 markdown 标题（## 或 ###）含任一关键词
  const lines = content.split('\n');
  for (const line of lines) {
    if (!line.startsWith('#')) continue;
    const lower = line.toLowerCase();
    if (keywords.some((k) => lower.includes(k.toLowerCase()))) return true;
  }
  return false;
}

function checkFields(content: string, fields: string[]): { coverage: number; missing: string[] } {
  const missing: string[] = [];
  let found = 0;
  for (const f of fields) {
    if (content.includes(f)) {
      found++;
    } else {
      missing.push(f);
    }
  }
  return { coverage: found / fields.length, missing };
}

function renderReport(
  specPath: string,
  total: number,
  sections: SectionScore[],
  suggestions: string[],
): string {
  const lines: string[] = [];
  lines.push('# Spec 完整性评分');
  lines.push('');
  lines.push(`> 文件：${specPath}`);
  lines.push(`> 总分：**${total} / 100**`);
  lines.push('');
  const grade = total >= 80 ? 'A' : total >= 60 ? 'B' : total >= 40 ? 'C' : 'D';
  lines.push(`> 等级：**${grade}**`);
  lines.push('');
  lines.push('## 章节得分');
  lines.push('');
  lines.push('| 章节 | 找到 | 字段填充率 | 得分 |');
  lines.push('|---|---|---|---|');
  for (const s of sections) {
    lines.push(
      `| ${s.section_id} | ${s.found ? '✓' : '✗'} | ${Math.round(s.field_coverage * 100)}% | ${s.score} |`,
    );
  }
  lines.push('');
  if (suggestions.length > 0) {
    lines.push('## 改进建议');
    lines.push('');
    for (const s of suggestions) lines.push(`- ${s}`);
  }
  return lines.join('\n');
}
