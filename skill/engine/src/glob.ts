// engine/src/glob.ts —— 极简 glob 匹配器（无外部依赖）
// P0-4 产出：实现核心引擎需要的文件路径匹配，避免引入 fast-glob 等依赖。
//
// 支持：
// - `*` 单层通配
// - `**` 多层通配
// - `{a,b,c}` 选择
// - `?` 单字符
//
// 不支持（YAGNI）：
// - 字符类 `[abc]`（用 {a,b,c} 替代）
// - 取反 `[!abc]`
// - 转义

import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 匹配 glob 模式，返回所有匹配的文件绝对路径。
 *
 * @param rootDir 项目根目录（绝对路径）
 * @param pattern glob 模式，支持 `**` 多层通配、`*` 单层通配、`{a,b,c}` 选择。
 *                示例：`src/{router,service}/` 后跟多层通配再后跟 `.ts` 后缀。
 */
export function matchGlob(rootDir: string, pattern: string): string[] {
  const result: string[] = [];
  const normalizedPattern = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
  const segments = normalizedPattern.split('/');
  walk(rootDir, segments, 0, result);
  return result;
}

function walk(currentDir: string, segments: string[], idx: number, result: string[]): void {
  if (idx >= segments.length) return;

  const segment = segments[idx];
  const isLast = idx === segments.length - 1;

  if (!existsSync(currentDir)) return;

  // `**` 递归通配
  if (segment === '**') {
    // 不消费 `**` 后跟 `/`（即 `**/x` 表示任意层目录下的 x）
    if (idx + 1 < segments.length) {
      // 递归所有子目录
      walk(currentDir, segments, idx + 1, result);
      let entries: string[] = [];
      try {
        entries = readdirSync(currentDir);
      } catch {
        return;
      }
      for (const name of entries) {
        const p = join(currentDir, name);
        try {
          if (statSync(p).isDirectory()) {
            walk(p, segments, idx, result); // 同 idx 继续 `**`
          }
        } catch {
          continue;
        }
      }
    } else {
      // `**` 在最后，匹配所有文件
      collectAllFiles(currentDir, result);
    }
    return;
  }

  // `{a,b,c}` 选择
  const choices = expandBraces(segment);
  let entries: string[] = [];
  try {
    entries = readdirSync(currentDir);
  } catch {
    return;
  }

  for (const name of entries) {
    if (!matchSegment(name, choices)) continue;
    const p = join(currentDir, name);
    try {
      const stat = statSync(p);
      if (isLast) {
        if (stat.isFile()) result.push(p);
      } else if (stat.isDirectory()) {
        walk(p, segments, idx + 1, result);
      }
    } catch {
      continue;
    }
  }
}

function collectAllFiles(dir: string, result: string[]): void {
  if (!existsSync(dir)) return;
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const p = join(dir, name);
    try {
      const stat = statSync(p);
      if (stat.isFile()) result.push(p);
      else if (stat.isDirectory()) collectAllFiles(p, result);
    } catch {
      continue;
    }
  }
}

/**
 * 展开 `{a,b,c}` 为 ['a', 'b', 'c']。
 * 不支持嵌套（YAGNI）。
 */
function expandBraces(segment: string): string[] {
  const m = segment.match(/^\{(.+)\}$/);
  if (!m) return [segment];
  return m[1].split(',').map((s) => s.trim());
}

/**
 * 匹配单层文件名/目录名。
 */
function matchSegment(name: string, choices: string[]): boolean {
  for (const choice of choices) {
    if (matchSingle(name, choice)) return true;
  }
  return false;
}

function matchSingle(str: string, pattern: string): boolean {
  // 简单实现：支持 * 和 ?
  return matchImpl(str, 0, pattern, 0);
}

function matchImpl(s: string, si: number, p: string, pi: number): boolean {
  while (pi < p.length) {
    if (p[pi] === '*') {
      // `*` 匹配 0 或多个字符（不含 /，但单层已切分，无需考虑）
      if (pi + 1 >= p.length) return true; // `*` 在末尾匹配剩余全部
      for (let k = si; k <= s.length; k++) {
        if (matchImpl(s, k, p, pi + 1)) return true;
      }
      return false;
    }
    if (p[pi] === '?') {
      if (si >= s.length) return false;
      si++;
      pi++;
      continue;
    }
    if (si >= s.length || s[si] !== p[pi]) return false;
    si++;
    pi++;
  }
  return si === s.length;
}

/**
 * 从源码提取正则匹配位置，返回行号（1-based）+ 匹配文本。
 */
export function extractMatches(regex: RegExp, source: string): Array<{ line: number; text: string }> {
  const result: Array<{ line: number; text: string }> = [];
  // 重置 lastIndex（防止 sticky/g 标志导致状态污染）
  regex.lastIndex = 0;
  const flags = regex.flags.includes('g') ? regex.flags : regex.flags + 'g';
  const globalRegex = new RegExp(regex.source, flags);

  let m: RegExpExecArray | null;
  while ((m = globalRegex.exec(source)) !== null) {
    const upto = source.slice(0, m.index);
    const line = upto.split('\n').length;
    result.push({ line, text: m[0] });
    if (m.index === globalRegex.lastIndex) globalRegex.lastIndex++; // 防止零宽匹配死循环
  }
  return result;
}

/**
 * 收集规则适用文件清单（按多个 glob 模式匹配 + 去重）。
 * 抽自 engine.ts，使核心只做"调度 + 报告"，文件扫描集中在 glob.ts（建议 3）。
 *
 * @param rootDir 项目根目录
 * @param patterns glob 模式数组
 * @returns 去重后的绝对路径数组
 */
export function collectFiles(rootDir: string, patterns: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    const matched = matchGlob(rootDir, pattern);
    for (const f of matched) {
      if (!seen.has(f)) {
        seen.add(f);
        result.push(f);
      }
    }
  }
  return result;
}
