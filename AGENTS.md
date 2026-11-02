# OURJIA PAAS

通过 SSH 进行服务器运维的工具。

## 技术栈（锁定版本）
- Node.js 24.22.2（后端 + 工具链）
- Vite 7.3.7
- React / React-DOM 19.2.9（TypeScript）
- 后端：Express 5 + ssh2（ESM，无 Python）

## 项目结构
- `web/` 前端（Vite + React），dev 端口 5180，`/api` 代理到 `127.0.0.1:8787`
- `server/` 后端（Express + ssh2），端口 8787；数据存 `server/data/`（gitignore，凭据 AES-256-GCM 加密）
- `.temp/design.html` UI 设计稿（玻璃拟态），实现需复用其 tokens 与布局（已落地为 `web/src/styles.css`）
- SSH 密钥连接：添加服务器勾选「密钥连接」后，首次用密码登录并安装 ed25519 公钥（生成必须用 `ssh2.utils.generateKeyPairSync`，Node crypto 的 PKCS8 ed25519 私钥 ssh2 解析不了），之后仅用密钥连接，密码不落盘

## 常用命令
- `npm run dev:server` 启动后端（node --watch）
- `npm run dev:web` 启动前端
- `npm run build` 构建前端（tsc --noEmit + vite build）
- `npm start` 生产模式：后端托管 `web/dist`
