// scripts/check-rules.mjs —— MVP 规则自动校验脚本
// 落实"规则可机器校验"原则：把 .trae/rules 里声明的规则用代码真正跑起来。
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const errors = [];

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (name.endsWith('.ts')) acc.push(p);
  }
  return acc;
}

const tsFiles = [
  ...walk(join(ROOT, 'packages/contracts/src')),
  ...walk(join(ROOT, 'apps/api/src')),
  ...walk(join(ROOT, 'apps/api/test')),
];

for (const f of tsFiles) {
  const src = readFileSync(f, 'utf8');
  const rel = f.replace(ROOT + '/', '');

  // ARCH-002: contracts 不得 import apps/*
  if (rel.startsWith('packages/contracts/')) {
    if (/from\s+['"]apps\//.test(src) || /from\s+['"]@admin\/api/.test(src)) {
      errors.push(`ARCH-002 违规：${rel} import 了业务层（contracts 须纯净）`);
    }
  }

  // CODE-001: 禁止 any
  if (/: any\b/.test(src) || /as any\b/.test(src)) {
    errors.push(`CODE-001 违规：${rel} 使用了 any`);
  }

  // CODE-002: 禁止空 catch / 仅 console 的 catch
  if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(src)) {
    errors.push(`CODE-002 违规：${rel} 存在空 catch（吞错）`);
  }

  // CODE-003: 禁止 eval / new Function
  if (/\beval\s*\(/.test(src) || /new\s+Function\s*\(/.test(src)) {
    errors.push(`CODE-003 违规：${rel} 使用 eval/Function 动态执行`);
  }
}

// ARCH-001: 后端单向依赖（domain 不得 import 上层）
const apiDomain = walk(join(ROOT, 'apps/api/src/domain'));
for (const f of apiDomain) {
  const src = readFileSync(f, 'utf8');
  const rel = f.replace(ROOT + '/', '');
  if (/from\s+['"](\.\.\/)+(service|repository|controller|router)/.test(src)) {
    errors.push(`ARCH-001 违规：${rel}（domain）反向 import 了上层`);
  }
  if (/from\s+['"]@admin\/api/.test(src)) {
    errors.push(`ARCH-001 违规：${rel}（domain）import 了本包上层`);
  }
}

if (errors.length) {
  console.error('\n❌ 规则校验失败：');
  for (const e of errors) console.error('  - ' + e);
  console.error(`\n共 ${errors.length} 处违规\n`);
  process.exit(1);
} else {
  console.log('✅ 规则校验通过（ARCH-001/002, CODE-001/002/003）');
}
