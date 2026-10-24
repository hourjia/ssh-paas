import io
import shlex
import socket
import time

import paramiko

from ..models import Server
from .crypto import decrypt

CONNECT_TIMEOUT = 10


class SshError(Exception):
    """SSH 连接类失败（网络不可达、连接中断等）。"""


class AuthError(SshError):
    """认证失败或凭据无法解析。"""


class NeedsManual(Exception):
    """自动准备无法继续，需要人工登录服务器处理。"""


class CommandResult:
    def __init__(self, exit_code: int, stdout: str = '', stderr: str = '', timed_out: bool = False):
        self.exit_code = exit_code
        self.stdout = stdout
        self.stderr = stderr
        self.timed_out = timed_out

    @property
    def ok(self) -> bool:
        return self.exit_code == 0 and not self.timed_out


def connect(server: Server) -> paramiko.SSHClient:
    client = paramiko.SSHClient()
    # v1 自动接受 host key；后续版本应改为首次记录、之后严格校验
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    kwargs = dict(
        hostname=server.host,
        port=server.port,
        username=server.username,
        timeout=CONNECT_TIMEOUT,
        banner_timeout=CONNECT_TIMEOUT,
        auth_timeout=CONNECT_TIMEOUT,
        allow_agent=False,
        look_for_keys=False,
    )
    try:
        if server.auth_type == Server.AuthType.PASSWORD:
            kwargs['password'] = decrypt(server.password_enc)
        else:
            kwargs['pkey'] = _load_key(decrypt(server.private_key_enc))
        client.connect(**kwargs)
    except paramiko.AuthenticationException as exc:
        client.close()
        raise AuthError(f'认证失败，请检查用户名与凭据：{exc}') from exc
    except (paramiko.SSHException, OSError) as exc:
        client.close()
        raise SshError(f'无法连接 {server.host}:{server.port}：{exc}') from exc
    return client


def _load_key(pem: str) -> paramiko.PKey:
    errors = []
    for key_cls in (paramiko.Ed25519Key, paramiko.ECDSAKey, paramiko.RSAKey):
        try:
            return key_cls.from_private_key(io.StringIO(pem))
        except paramiko.SSHException as exc:
            errors.append(f'{key_cls.__name__}: {exc}')
    raise AuthError('无法解析私钥（暂不支持带口令的私钥）：' + '；'.join(errors))


def run(client, cmd, timeout=30, input_text=None, on_line=None, max_seconds=None) -> CommandResult:
    """在目标机上执行命令。

    on_line 提供时逐行回调 stdout（stderr 行加前缀后同样回调），用于长任务日志流；
    max_seconds 限制总时长，socket 层 settimeout 限制单次等待，两者超时都按超时处理。
    """
    transport = client.get_transport()
    if transport is None or not transport.is_active():
        raise SshError('SSH 连接已断开')
    chan = transport.open_session()
    chan.settimeout(timeout)
    chan.exec_command(cmd)
    if input_text:
        chan.sendall(input_text.encode('utf-8'))
    chan.shutdown_write()

    out_buf, err_buf = [], []
    tail = b''
    timed_out = False
    start = time.monotonic()

    def split_lines(data: bytes, mark_stderr: bool):
        nonlocal tail
        tail += data
        lines = []
        while b'\n' in tail:
            line, tail = tail.split(b'\n', 1)
            lines.append(line)
        for line in lines:
            text = line.decode('utf-8', 'replace').rstrip('\r')
            if not text:
                continue
            on_line(('[stderr] ' + text) if mark_stderr else text)

    try:
        while True:
            got = False
            while chan.recv_ready():
                got = True
                chunk = chan.recv(8192)
                out_buf.append(chunk)
                if on_line:
                    split_lines(chunk, mark_stderr=False)
            while chan.recv_stderr_ready():
                got = True
                chunk = chan.recv_stderr(8192)
                err_buf.append(chunk)
                if on_line:
                    split_lines(chunk, mark_stderr=True)
            if chan.exit_status_ready() and not got:
                break
            if max_seconds is not None and time.monotonic() - start > max_seconds:
                timed_out = True
                chan.close()
                break
            time.sleep(0.05)
    except (socket.timeout, TimeoutError, paramiko.SSHException):
        timed_out = True

    if on_line and tail.strip():
        on_line(tail.decode('utf-8', 'replace').rstrip('\r'))
    stdout = b''.join(out_buf).decode('utf-8', 'replace')
    stderr = b''.join(err_buf).decode('utf-8', 'replace')
    if timed_out:
        return CommandResult(-1, stdout, stderr, timed_out=True)
    return CommandResult(chan.recv_exit_status(), stdout, stderr)


def is_root(client) -> bool:
    return run(client, 'id -u').stdout.strip() == '0'


def sudo_run(client, cmd, ssh_password=None, timeout=60, on_line=None, max_seconds=None) -> CommandResult:
    """以 root 权限执行 cmd，依次尝试 root 直登、免密 sudo、密码 sudo。

    密码通过 stdin 传入（sudo -S），不出现在命令行里。
    三种方式都不可用时抛 NeedsManual。
    """
    if is_root(client):
        return run(client, cmd, timeout=timeout, on_line=on_line, max_seconds=max_seconds)
    if run(client, 'sudo -n true', timeout=15).ok:
        return run(client, 'sudo -n sh -c ' + shlex.quote(cmd),
                   timeout=timeout, on_line=on_line, max_seconds=max_seconds)
    if ssh_password:
        return run(client, 'sudo -S -p "" sh -c ' + shlex.quote(cmd),
                   timeout=timeout, input_text=ssh_password + '\n',
                   on_line=on_line, max_seconds=max_seconds)
    raise NeedsManual('目标机需要 root 权限或免密 sudo 才能执行系统操作')
