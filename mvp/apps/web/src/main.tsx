// apps/web/src/main.tsx —— 应用挂载入口（TECH-WEB-AUTH-USER-001 §2.1）
// BrowserRouter 包裹 App（AuthProvider 内 useNavigate 须在 Router 上下文内）。
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.js';
import './index.css'; // R23 D7：全局 :focus-visible 焦点可见规则（AC-A11y-6）

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <BrowserRouter>
      <App />
    </BrowserRouter>,
  );
}
