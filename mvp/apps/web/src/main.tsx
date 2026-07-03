// apps/web/src/main.tsx —— 应用挂载入口（TECH-WEB-AUTH-USER-001 §2.1）
// 最小实现：ReactDOM.createRoot 挂载 App（不抛，入口文件非 stub）。
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(<App />);
}
