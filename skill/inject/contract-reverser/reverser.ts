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
import type { ReversedEndpoint, ReversedOpenApi, ReverseResult } from './types.js';

interface RouteCall {
  method: string;
  path: string;
  handler?: string;
  requestType?: string;
  responseType?: string;
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

  // 转 ReversedEndpoint
  const endpoints: ReversedEndpoint[] = calls.map((c) => ({
    method: c.method.toUpperCase(),
    path: c.path,
    handler_file: c.handler,
    request_schema: c.requestType ? { $ref: `#/components/schemas/${c.requestType}` } : undefined,
    response_schema: c.responseType ? { $ref: `#/components/schemas/${c.responseType}` } : undefined,
    confidence: c.requestType && c.responseType ? 0.9 : c.handler ? 0.7 : 0.5,
    notes: !c.requestType && !c.responseType ? '未提取到请求/响应类型，需人工 review' : undefined,
  }));

  // 生成 OpenAPI
  const openapi = buildOpenApi(endpoints, profile);

  // markdown 报告
  const md = renderMarkdown(endpoints, warnings);

  return { endpoints, openapi, markdown_report: md, warnings };
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
  return {
    openapi: '3.0.3',
    info: {
      title: `${profile.language} 项目（自动逆向）`,
      version: '0.1.0',
    },
    paths,
  };
}

// ============ Markdown 报告 ============

function renderMarkdown(endpoints: ReversedEndpoint[], warnings: string[]): string {
  const lines: string[] = [];
  lines.push('# API 逆向契约报告');
  lines.push('');
  lines.push(`> 自动生成 · ${new Date().toISOString()}`);
  lines.push('');
  if (endpoints.length === 0) {
    lines.push('未提取到任何 API 端点。');
  } else {
    lines.push('| 方法 | 路径 | 处理文件 | 置信度 | 备注 |');
    lines.push('|---|---|---|---|---|');
    for (const ep of endpoints) {
      lines.push(
        `| ${ep.method} | ${ep.path} | ${ep.handler_file ?? '-'} | ${ep.confidence.toFixed(2)} | ${ep.notes ?? ''} |`,
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
