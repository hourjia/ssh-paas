from django.db import models


class Server(models.Model):
    class AuthType(models.TextChoices):
        PASSWORD = 'password', '密码'
        KEY = 'key', 'SSH 私钥'

    class Status(models.TextChoices):
        UNKNOWN = 'unknown', '未连接'
        ONLINE = 'online', '在线'
        OFFLINE = 'offline', '无法连接'
        ERROR = 'error', '认证失败'

    class EnvStatus(models.TextChoices):
        UNCHECKED = 'unchecked', '未检查'
        READY = 'ready', '环境就绪'
        NEEDS_MANUAL = 'needs_manual', '需人工确认'
        FAILED = 'failed', '检查失败'

    name = models.CharField('名称', max_length=64)
    host = models.CharField('主机', max_length=255)
    port = models.PositiveIntegerField('端口', default=22)
    username = models.CharField('用户名', max_length=64, default='root')
    auth_type = models.CharField('认证方式', max_length=16, choices=AuthType.choices, default=AuthType.PASSWORD)
    password_enc = models.TextField(blank=True, default='')
    private_key_enc = models.TextField(blank=True, default='')
    auto_prepare = models.BooleanField('自动准备环境', default=True)
    status = models.CharField('连接状态', max_length=16, choices=Status.choices, default=Status.UNKNOWN)
    os_info = models.CharField('操作系统', max_length=255, blank=True, default='')
    env_status = models.CharField('环境状态', max_length=16, choices=EnvStatus.choices, default=EnvStatus.UNCHECKED)
    last_checked_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = '服务器'

    def __str__(self):
        return f'{self.name}({self.host})'


class EnvTask(models.Model):
    class Status(models.TextChoices):
        RUNNING = 'running', '执行中'
        SUCCESS = 'success', '成功'
        NEEDS_MANUAL = 'needs_manual', '需人工确认'
        FAILED = 'failed', '失败'

    server = models.ForeignKey(Server, on_delete=models.CASCADE, related_name='tasks')
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.RUNNING)
    report = models.JSONField(default=dict, blank=True)
    duration_ms = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = '环境检查任务'
