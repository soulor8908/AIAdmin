// tools/gen-snapshot.ts —— 全量上下文快照生成器（通用版）
// P0-7 产出：从 mvp/scripts/gen-context-snapshot.mjs 提取，参数化项目路径。
//
// 通用化要点：
// - 路径不再硬编码 mvp/，由 project config 声明
// - 输出 markdown，含：架构概览 + 规则速查 + 路由表 + Contracts 速查 + 关键约定速查
// - 五角色 subagent 按需读取（A1 优化：先读 delta < 3KB，按需再读本快照）
//
// 用法：
//   tsx tools/gen-snapshot.ts
//   tsx tools/gen-snapshot.ts --config path/to/ai-spec.config.json

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { load as parseYaml } from 'js-yaml';

interface AiSpecConfig {
  root_dir?: string;
  docs_dir?: string;
  context_snapshot?: string;
  rules_dir?: string;
  contract_dir?: string;
  router_dir?: string;
  file_types?: string[];
}

function loadConfig(configPath?: string): AiSpecConfig {
  const path = configPath ?? 'ai-spec.config.json';
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
  return {};
}

function parseArgs(): { configPath?: string } {
  const args = process.argv.slice(2);
  const opts: { configPath?: string } = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config') opts.configPath = args[++i];
  }
  return opts;
}

function walk(dir: string, exts: string[], acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, exts, acc);
    else if (exts.some((e) => name.endsWith(e))) acc.push(p);
  }
  return acc;
}

function generateSnapshot(): string {
  const opts = parseArgs();
  const config = loadConfig(opts.configPath);
  const rootDir = config.root_dir ?? process.cwd();
  const docsDir = config.docs_dir ?? 'docs';
  const outPath = join(rootDir, config.context_snapshot ?? `${docsDir}/context-snapshot.md`);
  const rulesDir = config.rules_dir ?? 'kernel/rules';
  const contractDir = config.contract_dir ?? 'packages/contracts/src';
  const routerDir = config.router_dir ?? 'apps/api/src/router';
  const fileTypes = config.file_types ?? ['.ts', '.tsx'];

  const lines: string[] = [];
  lines.push('# Context Snapshot');
  lines.push('');
  lines.push('> 全量上下文快照。五角色 subagent 按需读取（先读 round-N-delta.md < 3KB 把握本轮范围）。');
  lines.push(`> 自动生成，勿手改。`);
  lines.push('');

  // 1. 规则速查
  lines.push('## 规则速查');
  lines.push('');
  if (existsSync(rulesDir)) {
    const ruleFiles = walk(rulesDir, ['.yaml', '.yml', '.json']);
    for (const f of ruleFiles) {
      try {
        const content = readFileSync(f, 'utf8');
        const parsed = parseYaml(content) as { rules?: Array<{ id: string; title: string; severity: string }> };
        if (parsed.rules) {
          for (const rule of parsed.rules) {
            const icon = rule.severity === 'error' ? '❌' : rule.severity === 'warning' ? '⚠️' : 'ℹ️';
            lines.push(`- ${icon} **${rule.id}** ${rule.title}`);
          }
        }
      } catch {
        // 跳过非 YAML/JSON 文件（如 README.md）
      }
    }
  }
  lines.push('');

  // 2. 路由表
  lines.push('## 路由表');
  lines.push('');
  if (existsSync(routerDir)) {
    const routerFiles = walk(routerDir, fileTypes);
    for (const f of routerFiles) {
      const src = readFileSync(f, 'utf8');
      // 简单提取 HTTP method + path
      const matches = src.matchAll(/(?:GET|POST|PUT|PATCH|DELETE|get|post|put|patch|delete|@GetMapping|@PostMapping|@PutMapping|@PatchMapping|@DeleteMapping|@RequestMapping)[^;\n]*?['"]?\/[^\s'"`,)]+/g);
      const rel = f.replace(rootDir + '/', '').replace(/\\/g, '/');
      const endpoints = [...matches].map((m) => m[0]).slice(0, 20);
      if (endpoints.length) {
        lines.push(`### ${rel}`);
        for (const ep of endpoints) {
          lines.push(`- \`${ep.trim()}\``);
        }
        lines.push('');
      }
    }
  }

  // 3. Contracts 速查
  lines.push('## Contracts 速查');
  lines.push('');
  if (existsSync(contractDir)) {
    const contractFiles = walk(contractDir, fileTypes);
    for (const f of contractFiles) {
      const src = readFileSync(f, 'utf8');
      // 提取 export const XXXSchema
      const matches = src.matchAll(/export\s+const\s+(\w+Schema)\s*=/g);
      const rel = f.replace(rootDir + '/', '').replace(/\\/g, '/');
      const schemas = [...matches].map((m) => m[1]).slice(0, 20);
      if (schemas.length) {
        lines.push(`### ${rel}`);
        for (const s of schemas) lines.push(`- \`${s}\``);
        lines.push('');
      }
    }
  }

  // 4. 关键约定速查
  lines.push('## 关键约定速查');
  lines.push('');
  lines.push('- **AI-001**：先读 Spec 再写码');
  lines.push('- **AI-002**：测试先行，断言级红（非导入级红）');
  lines.push('- **AI-003**：advisory 偏离须反向同步 Spec');
  lines.push('- **AI-004**：每次改动必跑三件套（typecheck + lint:rules + test）');
  lines.push('- **AI-005**：跨域枚举断言用 SSOT 派生（`[...schema.options]`）');
  lines.push('- **AI-006**：Tech-Spec §9 受影响测试清单两类标注完整');
  lines.push('- **AI-007**：PRD 每条 AC 须有端到端测试覆盖');
  lines.push('- **ARCH-001~003**：四层单向依赖 / contracts 纯净 / 跨层只经契约');
  lines.push('- **CODE-001~004**：禁 any / 禁吞错 / 禁 eval / schema 命名带 Schema 后缀');
  lines.push('- **SEC-001~003b**：路由默认受保护 / 越权在 service / PII 边界');
  lines.push('- **META-001~004**：规则与实现双向绑定');
  lines.push('');

  const output = lines.join('\n');
  writeFileSync(outPath, output);
  console.log(`✅ 全量上下文快照已生成: ${outPath} (${output.length} bytes)`);
  return outPath;
}

generateSnapshot();
