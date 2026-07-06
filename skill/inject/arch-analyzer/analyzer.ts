// inject/arch-analyzer/analyzer.ts —— 架构分析器实现
// P2-2 产出：扫描现有代码 → 识别分层 → 检测违规 → 输出报告。
//
// 当前实现：TypeScript / JavaScript 项目为主（基于 import 语句分析）。
// P2-8 阶段扩展 Java（import）+ Python（import）适配。

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname, dirname } from 'node:path';
import type {
  ArchAnalysis,
  LayerInfo,
  ArchViolation,
  ArchStats,
} from './types.js';
import type { ProjectProfile } from '../detector/types.js';

interface FileNode {
  /** 相对 root 的路径 */
  path: string;
  /** 绝对路径 */
  abs: string;
  /** 文件扩展名 */
  ext: string;
  /** 推断的层名 */
  layer?: string;
  /** import 的目标文件（相对 root） */
  imports: string[];
}

const LAYER_HINTS: Record<string, string[]> = {
  router: ['router', 'routers', 'routes', 'controller', 'controllers', 'endpoint', 'endpoints'],
  service: ['service', 'services', 'usecase', 'usecases', 'application'],
  repository: ['repository', 'repositories', 'dao', 'mapper', 'mappers', 'repo'],
  domain: ['domain', 'entities', 'entity', 'model', 'models'],
};

/**
 * 分析项目架构。
 *
 * @param rootDir 项目根目录
 * @param profile 探测引擎输出的项目画像（用于选择语言特化策略）
 */
export function analyzeArchitecture(rootDir: string, profile: ProjectProfile): ArchAnalysis {
  const warnings: string[] = [];

  // 1. 收集源码文件
  const files = collectSourceFiles(rootDir, profile);
  if (files.length === 0) {
    warnings.push('未找到源码文件，可能不是受支持的项目类型');
  }

  // 2. 推断每个文件的层
  for (const file of files) {
    file.layer = inferLayer(file.path);
  }

  // 3. 提取 import（按语言）
  for (const file of files) {
    try {
      file.imports = extractImports(file, rootDir, profile);
    } catch {
      // 读文件失败 / 语法错误 → 跳过
    }
  }

  // 4. 聚合层信息
  const layerMap = new Map<string, FileNode[]>();
  for (const file of files) {
    if (!file.layer) continue;
    if (!layerMap.has(file.layer)) layerMap.set(file.layer, []);
    layerMap.get(file.layer)!.push(file);
  }
  const layers: LayerInfo[] = [];
  for (const [name, filesInLayer] of layerMap) {
    const exports = filesInLayer.flatMap((f) => extractExports(f));
    const directories = unique(filesInLayer.map((f) => dirname(f.path)));
    layers.push({
      name,
      directories,
      file_count: filesInLayer.length,
      exports,
      confidence: 0.8, // 基于目录命名的推断
    });
  }

  // 5. 检测违规
  const violations = detectViolations(files);

  // 6. 统计
  const totalImports = files.reduce((sum, f) => sum + f.imports.length, 0);
  const layerFiles = files.filter((f) => f.layer).length;
  const crossLayerImports = countCrossLayerImports(files);
  const stats: ArchStats = {
    total_files: files.length,
    total_imports: totalImports,
    cross_layer_imports: crossLayerImports,
    violation_count: violations.length,
    layer_coverage: files.length === 0 ? 0 : round(layerFiles / files.length, 2),
  };

  // 7. markdown 报告
  const markdown = renderMarkdownReport({
    root_dir: rootDir,
    language: profile.language,
    layers,
    violations,
    stats,
    warnings,
  });

  return {
    root_dir: rootDir,
    language: profile.language,
    layers,
    violations,
    stats,
    markdown_report: markdown,
    warnings,
  };
}

// ============ 文件收集 ============

function collectSourceFiles(rootDir: string, profile: ProjectProfile): FileNode[] {
  const files: FileNode[] = [];
  const exts = sourceExtensions(profile);
  const skipDirs = ['node_modules', '.git', 'dist', 'build', 'target', '.next', '__pycache__', '.pytest_cache'];

  function walk(dir: string) {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (skipDirs.includes(name)) continue;
      const abs = join(dir, name);
      const rel = relative(rootDir, abs);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(abs);
      } else if (st.isFile() && exts.includes(extname(name))) {
        files.push({ path: rel, abs, ext: extname(name), imports: [] });
      }
    }
  }
  walk(rootDir);
  return files;
}

function sourceExtensions(profile: ProjectProfile): string[] {
  switch (profile.language) {
    case 'typescript':
    case 'javascript':
      return ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
    case 'java':
      return ['.java'];
    case 'python':
      return ['.py'];
    case 'go':
      return ['.go'];
    case 'rust':
      return ['.rs'];
    default:
      return ['.ts', '.js', '.java', '.py']; // 兜底
  }
}

// ============ 层推断 ============

function inferLayer(filePath: string): string | undefined {
  const parts = filePath.split('/');
  for (const part of parts) {
    const lower = part.toLowerCase();
    for (const [layer, hints] of Object.entries(LAYER_HINTS)) {
      if (hints.some((h) => lower === h || lower.startsWith(h))) {
        return layer;
      }
    }
  }
  return undefined;
}

// ============ import 提取 ============

function extractImports(file: FileNode, rootDir: string, profile: ProjectProfile): string[] {
  const content = readFileSync(file.abs, 'utf8');
  if (profile.language === 'typescript' || profile.language === 'javascript') {
    return extractTsImports(content, file, rootDir);
  }
  if (profile.language === 'python') {
    return extractPythonImports(content, file, rootDir);
  }
  if (profile.language === 'java') {
    return extractJavaImports(content, file, rootDir);
  }
  return [];
}

function extractTsImports(content: string, file: FileNode, rootDir: string): string[] {
  const imports: string[] = [];
  // import ... from '...'
  const re = /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const target = m[1];
    if (target.startsWith('.') || target.startsWith('/')) {
      const resolved = resolveRelative(target, file.path, rootDir);
      if (resolved) imports.push(resolved);
    }
  }
  return imports;
}

function extractPythonImports(content: string, file: FileNode, _rootDir: string): string[] {
  // from X import Y / import X
  const imports: string[] = [];
  const re = /^\s*(?:from\s+([^\s]+)\s+import\s+|import\s+([^\s]+))/gm;
  let m;
  while ((m = re.exec(content)) !== null) {
    imports.push(m[1] ?? m[2] ?? '');
  }
  return imports.filter(Boolean);
}

function extractJavaImports(content: string, file: FileNode, _rootDir: string): string[] {
  const imports: string[] = [];
  const re = /^import\s+([^;]+);/gm;
  let m;
  while ((m = re.exec(content)) !== null) {
    imports.push(m[1].trim());
  }
  return imports;
}

function resolveRelative(target: string, fromPath: string, _rootDir: string): string | undefined {
  // 简化：返回标准化后的相对路径（不解析符号链接）
  const fromDir = dirname(fromPath);
  const resolved = join(fromDir, target).replace(/\\/g, '/');
  // 补全扩展名（假设 .ts / .tsx）
  if (!extname(resolved)) {
    return `${resolved}.ts`; // 简化：默认 .ts
  }
  return resolved;
}

// ============ 违规检测 ============

function detectViolations(files: FileNode[]): ArchViolation[] {
  const violations: ArchViolation[] = [];

  // 层级顺序：domain < repository < service < router
  const LAYER_ORDER: Record<string, number> = {
    domain: 0,
    repository: 1,
    service: 2,
    router: 3,
  };

  for (const file of files) {
    if (!file.layer) continue;
    const fromLayer = LAYER_ORDER[file.layer];
    if (fromLayer === undefined) continue;
    for (const imp of file.imports) {
      const target = files.find((f) => f.path === imp || f.path.startsWith(imp.replace(/\.[jt]sx?$/, '')));
      if (!target || !target.layer) continue;
      const toLayer = LAYER_ORDER[target.layer];
      if (toLayer === undefined) continue;
      // 反向依赖：from 较低层 import 较高层
      if (fromLayer < toLayer) {
        violations.push({
          kind: 'reverse-import',
          from: file.path,
          to: target.path,
          message: `${file.layer} (${file.path}) 反向依赖 ${target.layer} (${target.path})`,
          severity: 'error',
        });
      }
      // 跨层直连：router 直连 repository（跳过 service）
      if (file.layer === 'router' && target.layer === 'repository') {
        violations.push({
          kind: 'cross-layer-direct',
          from: file.path,
          to: target.path,
          message: `router (${file.path}) 跨层直连 repository (${target.path})，应经 service`,
          severity: 'warning',
        });
      }
    }
  }

  return violations;
}

function countCrossLayerImports(files: FileNode[]): number {
  let count = 0;
  const layerMap = new Map(files.map((f) => [f.path, f.layer]));
  for (const file of files) {
    if (!file.layer) continue;
    for (const imp of file.imports) {
      const targetLayer = layerMap.get(imp);
      if (targetLayer && targetLayer !== file.layer) count++;
    }
  }
  return count;
}

// ============ 导出符号提取（简化版） ============

function extractExports(file: FileNode): string[] {
  try {
    const content = readFileSync(file.abs, 'utf8');
    const exports: string[] = [];
    // export class X / export function Y / export const Z
    const re = /export\s+(?:class|function|const|interface|type|enum)\s+(\w+)/g;
    let m;
    while ((m = re.exec(content)) !== null) {
      exports.push(m[1]);
    }
    return exports;
  } catch {
    return [];
  }
}

// ============ 报告渲染 ============

function renderMarkdownReport(analysis: Omit<ArchAnalysis, 'markdown_report'>): string {
  const lines: string[] = [];
  lines.push('# 架构分析报告');
  lines.push('');
  lines.push(`> 由 ai-spec inject 自动生成 · ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## 1 · 识别到的分层');
  lines.push('');
  if (analysis.layers.length === 0) {
    lines.push('（未识别到分层，可能目录命名不匹配标准层名 domain/repository/service/router）');
  } else {
    lines.push('| 层 | 目录 | 文件数 | 主要导出 | 置信度 |');
    lines.push('|---|---|---|---|---|');
    for (const layer of analysis.layers) {
      lines.push(
        `| ${layer.name} | ${layer.directories.slice(0, 3).join(', ')}${layer.directories.length > 3 ? '...' : ''} | ${layer.file_count} | ${layer.exports.slice(0, 5).join(', ')}${layer.exports.length > 5 ? '...' : ''} | ${layer.confidence} |`,
      );
    }
  }
  lines.push('');
  lines.push('## 2 · 违规');
  lines.push('');
  if (analysis.violations.length === 0) {
    lines.push('✅ 未检测到架构违规');
  } else {
    lines.push('| 类型 | 严重度 | 起点文件 | 终点文件 | 描述 |');
    lines.push('|---|---|---|---|---|');
    for (const v of analysis.violations) {
      lines.push(`| ${v.kind} | ${v.severity} | ${v.from} | ${v.to} | ${v.message} |`);
    }
  }
  lines.push('');
  lines.push('## 3 · 统计');
  lines.push('');
  lines.push(`- 总源码文件：${analysis.stats.total_files}`);
  lines.push(`- 总 import 数：${analysis.stats.total_imports}`);
  lines.push(`- 跨层 import 数：${analysis.stats.cross_layer_imports}`);
  lines.push(`- 违规数：${analysis.stats.violation_count}`);
  lines.push(`- 分层覆盖率：${(analysis.stats.layer_coverage * 100).toFixed(1)}%`);
  if (analysis.warnings.length > 0) {
    lines.push('');
    lines.push('## 4 · 警告');
    lines.push('');
    for (const w of analysis.warnings) lines.push(`- ${w}`);
  }
  return lines.join('\n');
}

// ============ 工具函数 ============

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function round(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}
