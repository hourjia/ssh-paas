import os
import shlex
import time

from django.db import close_old_connections
from django.utils import timezone

from ..models import EnvTask, Server
from . import ssh
from .crypto import decrypt

# 国内网络可设置环境变量切换安装源与镜像加速
DOCKER_INSTALL_URL = os.environ.get('OURJIA_DOCKER_INSTALL_URL', 'https://get.docker.com')
DOCKER_MIRROR_URL = os.environ.get('OURJIA_DOCKER_MIRROR_URL', 'https://mirrors.aliyun.com/docker-ce')
REGISTRY_MIRRORS = [m.strip() for m in os.environ.get(
    'OURJIA_REGISTRY_MIRRORS', 'https://docker.m.daocloud.io').split(',') if m.strip()]
DOCKER_PKGS = 'docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin'
INSTALL_SCRIPT_PATH = '/tmp/ourjia-get-docker.sh'
MAX_LOG_LINES = 600

DAEMON_PROBE = 'docker info >/dev/null 2>&1 && echo running'

CHECKS = (
    {'key': 'os', 'label': '操作系统', 'required': False,
     'probe': 'cat /etc/os-release 2>/dev/null | head -2 || uname -sr'},
    {'key': 'docker', 'label': 'Docker', 'required': True, 'probe': 'docker --version'},
    {'key': 'dockerd', 'label': 'Docker 守护进程', 'required': True},
    {'key': 'compose', 'label': 'Docker Compose', 'required': True,
     'probe': 'docker compose version 2>/dev/null || docker-compose --version 2>/dev/null'},
    {'key': 'curl', 'label': 'curl', 'required': False, 'probe': 'curl --version 2>/dev/null | head -1'},
)


def run_pipeline(task_id: int) -> None:
    """在后台线程中执行：连接 → 检查环境 → 尝试自动准备 → 复查。"""
    close_old_connections()
    task = EnvTask.objects.select_related('server').get(pk=task_id)
    server = task.server
    logs = []
    report = {'items': [], 'actions': [], 'needs_manual': [], 'logs': logs}
    started = time.monotonic()
    status = EnvTask.Status.FAILED

    def emit(tone, text):
        if len(logs) < MAX_LOG_LINES:
            logs.append({'t': tone, 's': text})

    try:
        ctx = {'client': ssh.connect(server)}
    except ssh.AuthError as exc:
        emit('err', str(exc))
        server.status = Server.Status.ERROR
        ctx = None
    except ssh.SshError as exc:
        emit('err', str(exc))
        server.status = Server.Status.OFFLINE
        ctx = None

    if ctx is not None:
        try:
            server.status = Server.Status.ONLINE
            emit('ssh', f'已连接 {server.username}@{server.host}:{server.port}')
            status = _pipeline(ctx, server, emit, report)
        except ssh.NeedsManual as exc:
            emit('err', f'需要人工介入：{exc}')
            report['needs_manual'].append(str(exc))
            status = EnvTask.Status.NEEDS_MANUAL
            server.env_status = Server.EnvStatus.NEEDS_MANUAL
        except ssh.SshError as exc:
            emit('err', f'连接中断：{exc}')
            status = EnvTask.Status.FAILED
            server.status = Server.Status.OFFLINE
        finally:
            try:
                ctx['client'].close()
            except Exception:
                pass

    task.status = status
    task.report = report
    task.finished_at = timezone.now()
    task.duration_ms = int((time.monotonic() - started) * 1000)
    task.save()
    server.last_checked_at = task.finished_at
    server.save(update_fields=['status', 'os_info', 'env_status', 'last_checked_at'])
    close_old_connections()


def _pipeline(ctx, server: Server, emit, report) -> str:
    emit('info', '开始环境检查')
    _run_checks(ctx['client'], server, emit, report)
    if report.get('os'):
        server.os_info = report['os'][:255]
    bad = [i for i in report['items'] if i['required'] and i['status'] != 'ok']

    if bad and not server.auto_prepare:
        emit('dim', '该服务器未开启自动准备环境，跳过修复步骤')
    elif bad:
        relogin = _prepare(ctx, server, bad, emit, report)
        if relogin:
            emit('info', '用户组变更需要重新登录生效，正在重连')
            ctx['client'].close()
            ctx['client'] = ssh.connect(server)
        emit('info', '重新检查未通过项')
        _run_checks(ctx['client'], server, emit, report, only=[i['key'] for i in bad])
        bad = [i for i in report['items'] if i['required'] and i['status'] != 'ok']

    if bad:
        names = '、'.join(i['label'] for i in bad)
        emit('err', f'环境仍未就绪：{names} 需人工确认')
        report['needs_manual'].append(f'{names} 未能自动修复')
        server.env_status = Server.EnvStatus.NEEDS_MANUAL
        return EnvTask.Status.NEEDS_MANUAL

    emit('ok', '环境检查通过，可以开始部署服务')
    server.env_status = Server.EnvStatus.READY
    return EnvTask.Status.SUCCESS


def _run_checks(client, server: Server, emit, report, only=None) -> None:
    docker_missing = False
    for check in CHECKS:
        if only is not None and check['key'] not in only:
            continue
        if check['key'] == 'dockerd':
            if docker_missing:
                status, detail = 'broken', 'Docker 未安装'
            else:
                status, detail = _probe_daemon(client, emit)
            ok = status == 'ok'
        else:
            emit('cmd', f'$ {check["probe"]}')
            res = ssh.run(client, check['probe'], timeout=30)
            lines = (res.stdout.strip() or res.stderr.strip()).splitlines()
            detail = (lines[0] if lines else '')[:200]
            ok = res.ok
            if check['key'] == 'os':
                detail = detail.replace('\n', ' · ')
                if detail.startswith('PRETTY_NAME='):
                    detail = detail.split('=', 1)[1].strip().strip('"')
                if ok and not report.get('os'):
                    report['os'] = detail
            elif ok:
                pass
            else:
                status = 'missing' if res.exit_code == 127 else 'broken'
                if check['key'] == 'docker':
                    docker_missing = status == 'missing'

        if check['key'] == 'dockerd':
            item_status = status
        else:
            item_status = 'ok' if ok else status

        item = {'key': check['key'], 'label': check['label'],
                'required': check['required'], 'status': item_status, 'detail': detail}
        _upsert_item(report, item)
        emit('ok' if ok else 'err', f'{check["label"]}：{detail or "不可用"}')


def _probe_daemon(client, emit):
    """守护进程可能刚被拉起还没就绪，失败时给一个短重试窗口；仍失败时区分
    「没在运行」和「运行中但当前用户无权限」（不在 docker 组），后者可以自动修。"""
    res = ssh.run(client, DAEMON_PROBE, timeout=30)
    for attempt in range(3):
        if res.ok:
            return 'ok', '守护进程运行中'
        if attempt < 2:
            emit('dim', f'守护进程未就绪，5 秒后重试（{attempt + 1}/2）')
            time.sleep(5)
            res = ssh.run(client, DAEMON_PROBE, timeout=30)
    if ssh.run(client, 'sudo -n docker info >/dev/null 2>&1', timeout=30).ok:
        return 'no_permission', '守护进程运行中，但当前用户无权访问（不在 docker 组）'
    return 'broken', '守护进程未运行'


def _upsert_item(report, item):
    for idx, existing in enumerate(report['items']):
        if existing['key'] == item['key']:
            report['items'][idx] = item
            return
    report['items'].append(item)


def _prepare(ctx, server: Server, bad, emit, report) -> bool:
    """针对未通过项尝试自动修复，返回 True 表示用户组变更需要重连生效。"""
    keys = {i['key'] for i in bad}
    statuses = {i['key']: i['status'] for i in bad}
    ssh_password = decrypt(server.password_enc) if server.auth_type == Server.AuthType.PASSWORD else None
    client = ctx['client']

    def action(step, ok, message):
        report['actions'].append({'step': step, 'status': 'ok' if ok else 'failed', 'message': message})
        emit('ok' if ok else 'err', message)

    relogin = False

    if {'docker', 'compose'} & keys:
        _install_docker(client, server, ssh_password, emit, report, action)
        _add_user_to_docker_group(client, server, ssh_password, emit, report, action)
        return True

    if 'dockerd' not in keys:
        return False

    if statuses['dockerd'] == 'no_permission':
        ok = _add_user_to_docker_group(client, server, ssh_password, emit, report, action)
        return ok
    emit('info', '尝试启动 Docker 守护进程')
    emit('cmd', '$ systemctl enable --now docker || service docker start')
    res = ssh.sudo_run(client, 'systemctl enable --now docker || service docker start',
                       ssh_password, timeout=60, max_seconds=180)
    emit('docker', (res.stdout + res.stderr).strip() or f'退出码 {res.exit_code}')
    action('start_dockerd', res.ok, 'Docker 守护进程已启动' if res.ok else '启动 Docker 守护进程失败')
    if not res.ok:
        report['needs_manual'].append('启动 Docker 守护进程失败，请登录服务器执行 systemctl status docker 查看')
    return False


def _install_docker(client, server, ssh_password, emit, report, action) -> str:
    """安装 Docker，先官方脚本后国内镜像仓库回退，返回 'ok' 或 'failed'。"""
    pkg = _detect_pkg(client)
    if pkg is None:
        report['needs_manual'].append('无法识别包管理器（apt/dnf/yum），请手动安装 Docker')
        emit('err', '无法识别包管理器，请手动安装 Docker')
        return 'failed'

    if _upsert_check(client, emit, report, 'curl') != 'ok':
        emit('info', '目标机缺少 curl，先安装 curl')
        emit('cmd', f'$ {pkg} install -y curl')
        res = ssh.sudo_run(client, f'{pkg} install -y curl', ssh_password,
                           timeout=120, max_seconds=300)
        emit('dim', (res.stdout + res.stderr).strip()[-500:] or f'退出码 {res.exit_code}')
        if not res.ok:
            report['needs_manual'].append('安装 curl 失败，无法继续自动安装 Docker')
            emit('err', '安装 curl 失败，无法继续自动安装 Docker')
            return 'failed'

    # 路线一：官方安装脚本（先下载后执行，避免 curl | sh 管道吞掉下载失败的退出码）
    emit('info', f'尝试通过官方脚本安装 Docker（{DOCKER_INSTALL_URL}，可能需要几分钟）')
    installed = _install_via_official_script(client, ssh_password, emit)
    if not installed:
        # 路线二：国内镜像仓库直装（mirrors.aliyun.com 海内外都可达）
        emit('info', '官方脚本安装失败，改用镜像仓库安装')
        installed = _install_via_mirror_repo(client, pkg, ssh_password, emit, report)
        if installed:
            _configure_registry_mirrors(client, ssh_password, emit, report, action)

    if not installed:
        action('install_docker', False, 'Docker 自动安装失败')
        report['needs_manual'].append('Docker 自动安装失败，请查看上方日志排查网络后重试')
        return 'failed'

    res = ssh.run(client, 'command -v docker', timeout=15)
    if not res.ok:
        action('install_docker', False, '安装流程结束但 docker 命令不存在')
        report['needs_manual'].append('安装流程显示成功但 docker 命令不存在，请登录服务器排查')
        return 'failed'

    action('install_docker', True, 'Docker 环境安装完成')
    return 'ok'


def _install_via_official_script(client, ssh_password, emit) -> bool:
    emit('cmd', f'$ curl -fsSL {DOCKER_INSTALL_URL} -o {INSTALL_SCRIPT_PATH}')
    res = ssh.run(client, f'curl -fsSL {DOCKER_INSTALL_URL} -o {INSTALL_SCRIPT_PATH}',
                  timeout=120, max_seconds=300)
    if not res.ok:
        detail = (res.stderr or res.stdout).strip()[-300:]
        emit('err', f'下载官方安装脚本失败（curl 退出码 {res.exit_code}）：{detail or "无输出"}')
        return False
    emit('ok', f'安装脚本下载完成（{INSTALL_SCRIPT_PATH}）')

    emit('cmd', f'$ sh {INSTALL_SCRIPT_PATH}')
    res = ssh.sudo_run(client, f'sh {INSTALL_SCRIPT_PATH}', ssh_password,
                       timeout=120, max_seconds=900, on_line=lambda line: emit('docker', line))
    if res.timed_out:
        emit('err', '官方脚本执行超时（15 分钟）')
        return False
    if not res.ok:
        emit('err', f'官方脚本执行失败（退出码 {res.exit_code}）')
        return False
    return True


def _install_via_mirror_repo(client, pkg, ssh_password, emit, report) -> bool:
    """用阿里云 docker-ce 仓库直装，不依赖 get.docker.com 脚本。"""
    steps = []
    if pkg == 'apt-get':
        distro = ssh.run(client, '(. /etc/os-release && echo $ID)', timeout=15).stdout.strip()
        codename = ssh.run(client, '(. /etc/os-release && echo $VERSION_CODENAME)', timeout=15).stdout.strip()
        if not distro or not codename:
            report['needs_manual'].append('无法确定发行版与代号，无法配置 docker-ce 镜像仓库')
            emit('err', '无法确定发行版与代号（/etc/os-release），请手动安装 Docker')
            return False
        steps = [
            'install -m 0755 -d /etc/apt/keyrings',
            f'curl -fsSL {DOCKER_MIRROR_URL}/linux/{distro}/gpg -o /etc/apt/keyrings/docker.asc',
            f'echo "deb [signed-by=/etc/apt/keyrings/docker.asc] {DOCKER_MIRROR_URL}/linux/{distro} {codename} stable" > /etc/apt/sources.list.d/docker.list',
            'apt-get update',
            f'apt-get install -y {DOCKER_PKGS}',
        ]
    else:
        steps = [
            f'curl -fsSL {DOCKER_MIRROR_URL}/linux/centos/docker-ce.repo -o /etc/yum.repos.d/docker-ce.repo',
            f'{pkg} install -y {DOCKER_PKGS}',
        ]

    for step in steps:
        emit('cmd', f'$ {step}')
        res = ssh.sudo_run(client, step, ssh_password, timeout=180, max_seconds=900,
                           on_line=lambda line: emit('dim', line))
        if res.timed_out or not res.ok:
            detail = (res.stderr or res.stdout).strip()[-300:]
            emit('err', f'镜像仓库安装失败（{"超时" if res.timed_out else f"退出码 {res.exit_code}"}）：{detail or "无输出"}')
            return False
    return True


def _configure_registry_mirrors(client, ssh_password, emit, report, action) -> None:
    """走镜像源安装的机器通常在国内，顺手配置 daemon 拉镜像加速。不覆盖已有 daemon.json。"""
    if not REGISTRY_MIRRORS:
        return
    probe = ssh.run(client, 'test -f /etc/docker/daemon.json && echo exists', timeout=10)
    if probe.stdout.strip() == 'exists':
        emit('dim', '已存在 /etc/docker/daemon.json，跳过镜像加速配置（如需加速请手动加 registry-mirrors）')
        return

    import json as _json
    daemon_json = _json.dumps({'registry-mirrors': REGISTRY_MIRRORS})
    steps = [
        'mkdir -p /etc/docker',
        f'echo {shlex.quote(daemon_json)} > /etc/docker/daemon.json',
        'systemctl restart docker 2>/dev/null || systemctl enable --now docker || service docker restart',
    ]
    for step in steps:
        emit('cmd', f'$ {step}')
        res = ssh.sudo_run(client, step, ssh_password, timeout=60, max_seconds=180)
        if not res.ok:
            detail = (res.stderr or res.stdout).strip()[-200:]
            emit('err', f'配置镜像加速失败（退出码 {res.exit_code}）：{detail or "无输出"}')
            action('configure_registry_mirrors', False, '镜像加速配置失败，不影响 Docker 本身')
            return
    verify = ssh.run(client, "docker info 2>/dev/null | grep -A2 -i 'registry mirrors'", timeout=30)
    mirrors_shown = '、'.join(REGISTRY_MIRRORS)
    if verify.ok and verify.stdout.strip():
        emit('ok', f'镜像加速已生效：{mirrors_shown}')
    else:
        emit('dim', f'已写入镜像加速配置（{mirrors_shown}），守护进程重启后生效')
    action('configure_registry_mirrors', True, f'已配置镜像拉取加速：{mirrors_shown}')


def _add_user_to_docker_group(client, server, ssh_password, emit, report, action) -> bool:
    if server.username == 'root':
        return False
    emit('info', f'将用户 {server.username} 加入 docker 组')
    emit('cmd', f'$ usermod -aG docker {server.username}')
    res = ssh.sudo_run(client, f'usermod -aG docker {shlex.quote(server.username)}',
                       ssh_password, timeout=30)
    emit('dim', (res.stdout + res.stderr).strip() or f'退出码 {res.exit_code}')
    ok = res.ok
    action('add_docker_group', ok,
           f'用户 {server.username} 已加入 docker 组' if ok else '加入 docker 组失败')
    if not ok:
        report['needs_manual'].append(
            f'加入 docker 组失败，请登录服务器执行 usermod -aG docker {server.username}')
    return ok


def _detect_pkg(client):
    res = ssh.run(client, 'command -v apt-get || command -v dnf || command -v yum', timeout=15)
    lines = res.stdout.strip().splitlines()
    if not lines:
        return None
    path = lines[-1].strip()
    return path.rsplit('/', 1)[-1] if path else None


def _upsert_check(client, emit, report, key) -> str:
    """单独复查某一项，返回其状态并同步进 report。"""
    check = next(c for c in CHECKS if c['key'] == key)
    emit('cmd', f'$ {check["probe"]}')
    res = ssh.run(client, check['probe'], timeout=30)
    status = 'ok' if res.ok else ('missing' if res.exit_code == 127 else 'broken')
    lines = (res.stdout.strip() or res.stderr.strip()).splitlines()
    detail = (lines[0] if lines else '')[:200]
    _upsert_item(report, {'key': key, 'label': check['label'],
                          'required': check['required'], 'status': status, 'detail': detail})
    return status
