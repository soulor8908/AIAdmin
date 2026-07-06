// test/kernel-no-node-keyword.test.ts —— DoD #1：共享内核规则集无 Node.js 关键字
//
// 验证：kernel/rules/*.yaml 与 kernel/roles/*.md 与 kernel/templates/*.hbs
// 不应出现 Node.js 特定关键字（require / node: / .mjs / process.env 等），
// 确保共享内核技术栈无关。

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'kernel');
const FORBIDDEN_KEYWORDS = [
  /\brequire\s*\(/g,        // CommonJS require
  /\bnode:/g,                // node: 内置模块前缀
  /\.mjs\b/g,                // .mjs 扩展名
  /\bprocess\.env\b/g,       // Node.js process.env（内核不应依赖环境变量）
  /\b__dirname\b/g,          // Node.js __dirname
  /\b__filename\b/g,         // Node.js __filename
  /\bmodule\.exports\b/g,    // CommonJS 导出
];

function walkFiles(dir: string, exts: string[], acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkFiles(p, exts, acc);
    else if (exts.some((e) => name.endsWith(e))) acc.push(p);
  }
  return acc;
}

describe('DoD #1: 共享内核无 Node.js 关键字', () => {
  const kernelFiles = [
    ...walkFiles(join(ROOT, 'rules'), ['.yaml', '.yml', '.json']),
    ...walkFiles(join(ROOT, 'roles'), ['.md', '.json']),
    ...walkFiles(join(ROOT, 'templates'), ['.hbs', '.md']),
    ...walkFiles(join(ROOT, 'schema'), ['.json']),
  ];

  it('应有 ≥ 5 个内核文件被检查', () => {
    expect(kernelFiles.length).toBeGreaterThanOrEqual(5);
  });

  for (const file of kernelFiles) {
    const rel = file.replace(process.cwd() + '/', '');
    it(`${rel} 不含 Node.js 关键字`, () => {
      const src = readFileSync(file, 'utf8');
      const hits: string[] = [];
      for (const kw of FORBIDDEN_KEYWORDS) {
        const matches = src.match(kw);
        if (matches) hits.push(...matches);
      }
      expect(hits, `发现 Node.js 关键字: ${hits.join(', ')}`).toEqual([]);
    });
  }
});
