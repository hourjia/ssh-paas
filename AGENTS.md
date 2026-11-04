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
- 脚本运维：`server/scripts.js` + `web/src/pages/ScriptsPage.tsx`。脚本内容与固定环境变量整体加密存 `server/data/scripts.json`；配置时只保存「默认服务器」，执行用户默认取本次所选服务器的 SSH 用户，运行时可在运行弹窗改选其他服务器（执行身份随之切换），也可选用 sudo 提权（要求免密 sudo，`sudo -n`）。运行时把 `export` 语句和脚本一起通过 stdin 交给远端 `bash -s`（不落盘、不进 ps）。支持预声明「运行参数」（文本/开关），运行时填写后作为临时环境变量注入，值不落库、不进日志；脚本相关接口只允许本机访问
- PostgreSQL 共享服务模板只初始化内置管理员（`postgres`），不创建业务用户；业务用户和数据库由「PostgreSQL 创建数据库」脚本按需创建：用户名已存在时先做密码登录校验，密码错误拒绝创建；用户名不存在时需勾选「用户不存在时创建新用户（二次确认）」后重试才会创建
- 应用和共享服务支持手动停止/启动：停止只 `docker compose stop`，保留容器与数据目录；启动只 `docker compose start`，不拉镜像、不改配置；要更新配置用「重新部署」

## 常用命令
- `npm run dev:server` 启动后端（node --watch）
- `npm run dev:web` 启动前端
- `npm run build` 构建前端（tsc --noEmit + vite build）
- `npm start` 生产模式：后端托管 `web/dist`
