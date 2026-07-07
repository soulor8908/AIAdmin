// cli/templates/web-scaffold.ts —— 前端骨架
// 问题 5：从 template-engine.ts 拆出。
//
// 包含：
// - React + Vite：main.tsx / App.tsx / index.html / package.json
// - experimental 前端防护：非 react-vite 显式 warning + 写入说明文件

import type { GenerateOptions } from '../options.js';
import type { WriteOp } from '../../spi/adapter.js';

// ============ 内联模板字符串 ============

const TSX_MAIN = `import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
`;

const TSX_APP = `import React from 'react';

export function App() {
  return (
    <div>
      <h1>AI Spec Project</h1>
      <p>由 create-ai-spec-app 生成。运行 <code>npm run spec:init</code> 初始化第一个业务域。</p>
    </div>
  );
}
`;

const HTML_INDEX = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>__TITLE__</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
`;

// ============ apps/web 渲染 ============

export function renderAppsWeb(opts: GenerateOptions, warnings: string[]): WriteOp[] {
  const writes: WriteOp[] = [];
  if (opts.stack.frontend !== 'react-vite') {
    // experimental 前端防护：显式警告 + 写入说明文件（不再静默 fallback）
    warnings.push(
      `frontend="${opts.stack.frontend}" 为 experimental，未生成 React 骨架（experimental 适配器防护，建议 1）`,
    );
    writes.push({
      path: '.ai-spec/experimental-frontend.txt',
      content: `前端栈 ${opts.stack.frontend} 在 MVP 期为 experimental，未生成骨架。\n如需使用，请手动配置。\n`,
      is_new: true,
      reason: 'P1-1 experimental 前端占位（显式警告）',
    });
    return writes;
  }

  writes.push({
    path: 'apps/web/src/main.tsx',
    content: TSX_MAIN,
    is_new: true,
    reason: 'P1-1 React 入口',
  });
  writes.push({
    path: 'apps/web/src/App.tsx',
    content: TSX_APP,
    is_new: true,
    reason: 'P1-1 React App 组件',
  });
  writes.push({
    path: 'apps/web/index.html',
    content: HTML_INDEX.replace('__TITLE__', opts.project_name),
    is_new: true,
    reason: 'P1-1 Vite 入口 HTML',
  });
  writes.push({
    path: 'apps/web/package.json',
    content: JSON.stringify({
      name: `@${opts.project_name}/web`,
      version: '0.0.0',
      private: true,
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'tsc && vite build',
        test: 'vitest run',
      },
      dependencies: {
        react: '^18.3.0',
        'react-dom': '^18.3.0',
      },
      devDependencies: {
        '@types/react': '^18.3.0',
        '@types/react-dom': '^18.3.0',
        '@vitejs/plugin-react': '^4.3.0',
        typescript: '^5.4.0',
        vite: '^5.3.0',
        vitest: '^1.6.0',
      },
    }, null, 2) + '\n',
    is_new: true,
    reason: 'P1-1 web 子包',
  });

  return writes;
}
