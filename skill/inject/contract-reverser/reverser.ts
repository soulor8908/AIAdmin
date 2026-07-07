// inject/contract-reverser/reverser.ts —— P2-3 API 逆向契约生成
// 从现有路由 / Controller 提取元数据 → 生成 OpenAPI + JSON Schema。
//
// 当前实现：
// - TS：扫 server.ts / router 文件的 defineRoute / app.get/post 调用
// - Java Spring：扫 @RestController + @GetMapping / @PostMapping 注解
// - Python FastAPI：扫 @app.get / @app.post 装饰器

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import type { ProjectProfile } from '../detector/types.js';
import type { ReversedEndpoint, ReversedOpenApi, ReverseResult, AccuracyTag } from './types.js';

interface RouteCall {
  method: string;
  path: string;
  handler?: string;
  requestType?: string;
  responseType?: string;
}

/**
 * 计算准确性标记（建议 7 / 问题 6）。
 * - high_confidence：置信度 ≥ 0.9 且 request/response 类型都已知（问题 6：原 verified 改名）
 * - partial：置信度 0.7-0.9 或仅知单一类型
 * - inferred：置信度 < 0.7 或类型全无
 * - verified：本函数不返回（保留给人工确认后赋值）
 */
function computeAccuracy(confidence: number, hasRequest: boolean, hasResponse: boolean): AccuracyTag {
  if (confidence >= 0.9 && hasRequest && hasResponse) return 'high_confidence';
  if (confidence >= 0.7 && (hasRequest || hasResponse)) return 'partial';
  return 'inferred';
}

/**
 * 逆向生成 OpenAPI 契约。
 */
export function reverseApi(rootDir: string, profile: ProjectProfile): ReverseResult {
  const warnings: string[] = [];
  const files = collectSourceFiles(rootDir, profile);
  const calls: RouteCall[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf8');
      const fileCalls = profile.language === 'java'
        ? extractSpringRoutes(content, file)
        : profile.language === 'python'
          ? extractFastApiRoutes(content, file)
          : extractTsRoutes(content, file);
      calls.push(...fileCalls);
    } catch {
      // 读失败 → 跳过
    }
  }

  if (calls.length === 0) {
    warnings.push('未找到路由 / Controller，可能项目未实现 HTTP 端点');
  }

  // 转 ReversedEndpoint（建议 7：加 accuracy 标记）
  const endpoints: ReversedEndpoint[] = calls.map((c) => {
    const confidence = c.requestType && c.responseType ? 0.9 : c.handler ? 0.7 : 0.5;
    const hasReq = !!c.requestType;
    const hasResp = !!c.responseType;
    const accuracy = computeAccuracy(confidence, hasReq, hasResp);
    return {
      method: c.method.toUpperCase(),
      path: c.path,
      handler_file: c.handler,
      request_schema: c.requestType ? { $ref: `#/components/schemas/${c.requestType}` } : undefined,
      response_schema: c.responseType ? { $ref: `#/components/schemas/${c.responseType}` } : undefined,
      confidence,
      accuracy,
      notes: accuracy === 'inferred' ? '未提取到请求/响应类型，需人工 review' : undefined,
    };
  });

  // 汇总 accuracy（问题 6：verified 改为 high_confidence）
  const accuracySummary = {
    inferred: endpoints.filter((e) => e.accuracy === 'inferred').length,
    partial: endpoints.filter((e) => e.accuracy === 'partial').length,
    high_confidence: endpoints.filter((e) => e.accuracy === 'high_confidence').length,
    verified: endpoints.filter((e) => e.accuracy === 'verified').length, // 机器不自动赋值，未来人工确认
  };
  if (accuracySummary.inferred > 0) {
    warnings.push(`${accuracySummary.inferred} 个端点为 inferred（置信度 < 0.7），需人工 review 后标记为 verified`);
  }

  // 生成 OpenAPI（带 accuracy 标记）
  const openapi = buildOpenApi(endpoints, profile);

  // markdown 报告
  const md = renderMarkdown(endpoints, warnings, accuracySummary);

  return {
    endpoints,
    openapi,
    markdown_report: md,
    warnings,
    accuracy_summary: accuracySummary,
  };
}

// ============ TS 路由提取 ============

function extractTsRoutes(content: string, file: string): RouteCall[] {
  const calls: RouteCall[] = [];
  // app.get('/path', handler) / app.post('/path', handler) / defineRoute('GET', '/path', ...)
  const patterns: Array<{ re: RegExp; method: string }> = [
    { re: /app\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g, method: '' },
    { re: /router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g, method: '' },
    { re: /defineRoute\(\s*['"`](GET|POST|PUT|PATCH|DELETE)['"`]\s*,\s*['"`]([^'"`]+)['"`]/g, method: '' },
    { re: /fastify\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g, method: '' },
  ];
  for (const { re } of patterns) {
    let m;
    while ((m = re.exec(content)) !== null) {
      const method = (m[1] ?? '').toUpperCase();
      const path = m[2] ?? '';
      if (!method || !path) continue;
      calls.push({
        method,
        path,
        handler: relative('', file),
      });
    }
  }
  return calls;
}

// ============ Spring Boot 路由提取 ============

function extractSpringRoutes(content: string, file: string): RouteCall[] {
  const calls: RouteCall[] = [];
  // @RestController 标识类为 Controller
  const isController = /@RestController|@Controller/.test(content);
  if (!isController) return [];

  // 类级 @RequestMapping('/prefix')
  const classMapping = content.match(/@RequestMapping\(\s*['"]([^'"]+)['"]\s*\)/);
  const prefix = classMapping?.[1] ?? '';

  // 方法级 @GetMapping('/path') / @PostMapping 等
  const methodPatterns: Array<{ re: RegExp; method: string }> = [
    { re: /@GetMapping\(\s*(?:['"]([^'"]*)['"])?\s*\)/g, method: 'GET' },
    { re: /@PostMapping\(\s*(?:['"]([^'"]*)['"])?\s*\)/g, method: 'POST' },
    { re: /@PutMapping\(\s*(?:['"]([^'"]*)['"])?\s*\)/g, method: 'PUT' },
    { re: /@PatchMapping\(\s*(?:['"]([^'"]*)['"])?\s*\)/g, method: 'PATCH' },
    { re: /@DeleteMapping\(\s*(?:['"]([^'"]*)['"])?\s*\)/g, method: 'DELETE' },
  ];

  for (const { re, method } of methodPatterns) {
    let m;
    while ((m = re.exec(content)) !== null) {
      const path = (prefix + (m[1] ?? '')).replace(/\/+/g, '/');
      calls.push({
        method,
        path: path || '/',
        handler: relative('', file),
      });
    }
  }
  return calls;
}

// ============ FastAPI 路由提取 ============

function extractFastApiRoutes(content: string, file: string): RouteCall[] {
  const calls: RouteCall[] = [];
  // @app.get('/path') / @router.get('/path')
  const re = /@(?:app|router)\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const method = (m[1] ?? '').toUpperCase();
    const path = m[2] ?? '';
    if (!method || !path) continue;
    calls.push({ method, path, handler: relative('', file) });
  }
  return calls;
}

// ============ OpenAPI 构建 ============

function buildOpenApi(endpoints: ReversedEndpoint[], profile: ProjectProfile): ReversedOpenApi {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const ep of endpoints) {
    if (!paths[ep.path]) paths[ep.path] = {};
    paths[ep.path][ep.method.toLowerCase()] = {
      summary: ep.handler_file ? `Handler: ${ep.handler_file}` : 'Unknown handler',
      // 建议 7：每个端点标记 accuracy（OpenAPI extension 字段 x-ai-spec-accuracy）
      'x-ai-spec-accuracy': ep.accuracy,
      'x-ai-spec-confidence': ep.confidence,
      responses: {
        '200': {
          description: '成功响应',
          content: ep.response_schema
            ? { 'application/json': { schema: ep.response_schema } }
            : undefined,
        },
      },
      requestBody: ep.request_schema
        ? {
            content: { 'application/json': { schema: ep.request_schema } },
          }
        : undefined,
    };
  }
  // 整体 accuracy：所有 high_confidence → high_confidence；否则 inferred 或 partial
  // 问题 6：verified 仅人工赋值，机器不自动升为 verified
  const allHighConfidence = endpoints.length > 0 && endpoints.every((e) => e.accuracy === 'high_confidence' || e.accuracy === 'verified');
  const anyInferred = endpoints.some((e) => e.accuracy === 'inferred');
  const overallAccuracy: AccuracyTag = allHighConfidence ? 'high_confidence' : anyInferred ? 'inferred' : 'partial';
  return {
    openapi: '3.0.3',
    info: {
      title: `${profile.language} 项目（自动逆向）`,
      version: '0.1.0',
    },
    paths,
    accuracy: overallAccuracy,
  };
}

// ============ Markdown 报告 ============

function renderMarkdown(
  endpoints: ReversedEndpoint[],
  warnings: string[],
  accuracySummary: { inferred: number; partial: number; high_confidence: number; verified: number },
): string {
  const lines: string[] = [];
  lines.push('# API 逆向契约报告');
  lines.push('');
  lines.push(`> 自动生成 · ${new Date().toISOString()}`);
  lines.push('');
  // 建议 7：accuracy 汇总（问题 6：verified 拆分为 high_confidence + verified）
  if (endpoints.length > 0) {
    lines.push('## 准确性汇总');
    lines.push('');
    lines.push('| 标记 | 数量 | 含义 |');
    lines.push('|---|---|---|');
    lines.push(`| [high_confidence] | ${accuracySummary.high_confidence} | 机器推断置信度 ≥ 0.9 且类型完整，可直接使用 |`);
    lines.push(`| [partial] | ${accuracySummary.partial} | 部分类型已知，需补充 |`);
    lines.push(`| [inferred] | ${accuracySummary.inferred} | 推断生成，置信度 < 0.7，须人工 review |`);
    lines.push(`| [verified] | ${accuracySummary.verified} | 人工确认过（机器不自动赋值） |`);
    lines.push('');
  }
  if (endpoints.length === 0) {
    lines.push('未提取到任何 API 端点。');
  } else {
    lines.push('| 方法 | 路径 | 处理文件 | 置信度 | 准确性 | 备注 |');
    lines.push('|---|---|---|---|---|---|');
    for (const ep of endpoints) {
      lines.push(
        `| ${ep.method} | ${ep.path} | ${ep.handler_file ?? '-'} | ${ep.confidence.toFixed(2)} | [${ep.accuracy}] | ${ep.notes ?? ''} |`,
      );
    }
  }
  if (warnings.length > 0) {
    lines.push('');
    lines.push('## 警告');
    for (const w of warnings) lines.push(`- ${w}`);
  }
  return lines.join('\n');
}

// ============ 文件收集 ============

function collectSourceFiles(rootDir: string, profile: ProjectProfile): string[] {
  const files: string[] = [];
  const exts =
    profile.language === 'java'
      ? ['.java']
      : profile.language === 'python'
        ? ['.py']
        : ['.ts', '.tsx', '.js', '.jsx'];
  const skipDirs = ['node_modules', '.git', 'dist', 'build', 'target', '__pycache__'];

  function walk(dir: string) {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (skipDirs.includes(name)) continue;
      const abs = join(dir, name);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(abs);
      else if (st.isFile() && exts.includes(extname(name))) files.push(abs);
    }
  }
  walk(rootDir);
  return files;
}
