# ourjia-paas
当前项目是简易的 paas 平台
`design` 中是当前项目界面的原型设计（纯前端原型，mock 数据，仅作视觉/交互蓝本）

## 项目结构

```
ourjia-paas/
├─ design/   # 界面原型（Vite + React，玻璃分层设计，遵循 design/design.md）
├─ server/   # 后端（Python + Django + DRF，SQLite，paramiko 驱动 SSH）
└─ web/      # 前端（TS + Vite + React，从 design/ 演进，对接真实 API）
```

## 启动方式

后端（端口 8000）：

```bash
cd server
python -m venv venv                      # 首次
venv/Scripts/python -m pip install -r requirements.txt   # 首次（Windows）
venv/Scripts/python manage.py migrate    # 首次
venv/Scripts/python manage.py runserver 127.0.0.1:8000
```

前端（端口 5180，`/api` 代理到 8000）：

```bash
cd web
npm install    # 首次
npm run dev
```

## 当前进度（第一步：绑定服务器 + 连接检查/准备环境）

- 服务器 CRUD：`/api/servers/`，SSH 凭据（密码/私钥）Fernet 加密存储，接口只回显 `*_set` 布尔
- 连接检查：`POST /api/servers/{id}/connect/` 创建后台任务（线程），立即返回 `task_id`；
  `GET /api/env-tasks/{id}/` 轮询结果（report 内含 items/actions/needs_manual/logs）
- 检查项：操作系统、Docker、Docker 守护进程、Docker Compose、curl
- 自动准备（auto_prepare=true 时）：守护进程未运行则拉起；用户不在 docker 组则 usermod 加组后重连；
  Docker/Compose 缺失时先下载官方脚本再执行（不走 `curl | sh` 管道，下载失败能正确报错），
  官方源失败自动回退阿里云 docker-ce 仓库直装，装完配置 registry 镜像加速（不覆盖已有 daemon.json）；
  可用环境变量：`OURJIA_DOCKER_INSTALL_URL`（官方脚本地址）、`OURJIA_DOCKER_MIRROR_URL`（docker-ce 仓库镜像）、
  `OURJIA_REGISTRY_MIRRORS`（拉镜像加速，逗号分隔）；
  失败的任务标记 `needs_manual`，等待人工确认后重新检查
- SSH 执行细节：root 直登 / 免密 sudo / 密码 sudo（stdin 传入，不进命令行）三种提权链
- 已知边界：host key 暂为自动接受；API 未做认证；暂不支持带口令的私钥

## 约定

- 后端凭据一律加密落库，任何接口不得回显明文
- 部署流水线的目标形态：配置页生成 docker-compose.yml 作为部署单元，SSH 驱动目标机构建部署
