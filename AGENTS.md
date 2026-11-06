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
- 后端默认只监听 `127.0.0.1:8787`，可用 `HOST` 环境变量覆盖（如 `HOST=0.0.0.0` 开放局域网，会在启动时打印警告）；本程序没有登录鉴权，端口可达即等于拿到全部已纳管服务器的操作权，远程访问请走 SSH 隧道或 Tailscale，不要用同机反代（反代会把来源变成 127.0.0.1，让 `requireLocal` 形同失效）
- `.temp/design.html` UI 设计稿（玻璃拟态），实现需复用其 tokens 与布局（已落地为 `web/src/styles.css`）
- SSH 密钥连接：添加服务器勾选「密钥连接」后，首次用密码登录并安装 ed25519 公钥（生成必须用 `ssh2.utils.generateKeyPairSync`，Node crypto 的 PKCS8 ed25519 私钥 ssh2 解析不了），之后仅用密钥连接，密码不落盘
- 脚本运维：`server/scripts.js` + `web/src/pages/ScriptsPage.tsx`。脚本内容与固定环境变量整体加密存 `server/data/scripts.json`；配置时只保存「默认服务器」，执行用户默认取本次所选服务器的 SSH 用户，运行时可在运行弹窗改选其他服务器（执行身份随之切换），也可选用 sudo 提权（要求免密 sudo，`sudo -n`）。运行时把 `export` 语句和脚本一起通过 stdin 交给远端 `bash -s`（不落盘、不进 ps）。支持预声明「运行参数」（文本/开关），运行时填写后作为临时环境变量注入，值不落库、不进日志；脚本相关接口只允许本机访问
- 运行参数还支持「文件」类型：运行弹窗里先选文件，浏览器把文件原始字节发到 `POST /api/uploads`（`server/uploads.js`，暂存在 `server/data/uploads`，6 小时过期，上限 2 GB）；任务启动后通过 SFTP 送到脚本的「上传目录」（`uploadDir`，服务器上的绝对路径，需 SSH 用户可写），参数值即文件在服务器上的绝对路径。上传进度写进任务日志，本机副本传完即删，任务因此多一个「上传文件到服务器」步骤
- 脚本可绑定「目标应用」：绑定后容器名由平台按部署规则推导为 `ourjia_<应用 ID>`，运行时注入 `APP_CONTAINER`（保留变量名，参数/环境变量不能重名），卡片、编辑表单和运行弹窗都会显示容器名；没绑定（例如容器不是本平台部署的）时才手填容器名。fitnote 发版脚本见 `scripts/fitnote-release.sh`，已建为「fitnote 应用发版」并绑定 `fitnote-backend`（上传目录 `/tmp/ourjia-release`，`docker cp` 进容器后执行 `publish_release publish`）
- 安卓自动发版：`scripts/fitnote-android-release.sh`（已建为「fitnote 安卓自动发版」，绑定 `fitnote-backend`）。按附件名里的 `vc<versionCode>` 从 GitHub Releases 选 build 最大的正式版（跳过 draft/prerelease），读 `build-info.json` 得到 versionName/versionCode 与 APK 的 sha256；再在容器里用 `manage.py shell` 查最高的已发布 build（含已下架，避免把下架版本重新推上线），只有远端更大时才下载 APK → 校验大小与 sha256 → `docker cp` → `publish_release publish`。可反复执行，`DRY_RUN` 只检查，`FORCED` 默认 false；依赖固定环境变量 `GITHUB_TOKEN`（私有仓库，Contents: Read），服务器出网需要代理时用 `GITHUB_PROXY`
- PostgreSQL 共享服务模板只初始化内置管理员（`postgres`），不创建业务用户；业务用户和数据库由「PostgreSQL 创建数据库」脚本按需创建：用户名已存在时先做密码登录校验，密码错误拒绝创建；用户名不存在时需勾选「用户不存在时创建新用户（二次确认）」后重试才会创建
- 应用和共享服务支持手动停止/启动：停止只 `docker compose stop`，保留容器与数据目录；启动只 `docker compose start`，不拉镜像、不改配置；要更新配置用「重新部署」
- 媒体卷：宿主目录默认 root 所有；镜像以非 root 用户运行时，必须在应用编辑页填写「目录所有者」（容器 UID:GID，例如 fitnote 后端的 `10001:10001`）。部署会 `chown -R` 该目录，并以容器用户实际执行写测试，失败时直接报错并提示应填的 UID:GID
- HTTPS：证书由 Traefik 的 ACME（Let's Encrypt）自动签发/续期，默认 90 天有效期，平台不管理证书时长；HSTS 由 Traefik 在应用路由上下发 `max-age=31536000`（`deploy.js` 的 `hstsLabels`），会覆盖应用自己发的 STS 头。暂不启用 `includeSubDomains`/`preload`：子域还有只跑 HTTP 的（例如 `www` 目前没有证书），而 preload 很难撤回

## 常用命令
- `npm run dev:server` 启动后端（node --watch）
- `npm run dev:web` 启动前端
- `npm run build` 构建前端（tsc --noEmit + vite build）
- `npm start` 生产模式：后端托管 `web/dist`
