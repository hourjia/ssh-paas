// 应用模板：只负责预填新建表单，不改变部署逻辑。
// env 里的 {{domain}} 会在提交时替换成用户填写的域名。

export const TEMPLATES = [
  {
    id: 'django',
    label: 'Django API',
    kind: 'image',
    description: 'Django + Gunicorn；健康检查用 /admin/（302），媒体目录由平台 nginx 提供；记得补 DATABASE_URL',
    defaults: {
      port: 8001,
      healthPath: '/admin/',
      volumes: [{ name: 'media', mountPath: '/data/media', serveUrl: '/media/' }],
    },
    env: [
      { key: 'DJANGO_SETTINGS_MODULE', value: 'config.settings.production' },
      { key: 'DJANGO_ALLOWED_HOSTS', template: '{{domain}}' },
      { key: 'DJANGO_CSRF_TRUSTED_ORIGINS', template: 'https://{{domain}}' },
      { key: 'DJANGO_MEDIA_ROOT', value: '/data/media' },
      { key: 'GUNICORN_FORWARDED_ALLOW_IPS', value: '*' },
      { key: 'GUNICORN_WORKERS', value: '3' },
    ],
  },
  {
    id: 'node',
    label: 'Node 服务',
    kind: 'image',
    description: '任意 Node HTTP 服务，按健康路径检查',
    defaults: { port: 3000, healthPath: '/healthz' },
    env: [],
  },
  {
    id: 'static',
    label: '静态站点',
    kind: 'image',
    description: 'nginx 镜像，产物已打进镜像',
    defaults: { port: 80, healthPath: '/' },
    env: [],
  },
  {
    id: 'postgres',
    label: 'PostgreSQL 16',
    kind: 'service',
    description: 'PostgreSQL 16，数据落在 /srv/data，仅 shared-net 内可达',
    defaults: {
      image: 'postgres:16-alpine',
      port: 5432,
      alias: 'postgres',
      containerPath: '/var/lib/postgresql/data',
      healthCmd: 'pg_isready -U appuser -d appdb',
    },
    env: [
      { key: 'POSTGRES_DB', value: 'appdb' },
      { key: 'POSTGRES_USER', value: 'appuser' },
      { key: 'POSTGRES_PASSWORD', value: 'change-me' },
    ],
  },
  {
    id: 'redis',
    label: 'Redis 7',
    kind: 'service',
    description: 'Redis 7，数据落在 /srv/data，仅 shared-net 内可达',
    defaults: {
      image: 'redis:7-alpine',
      port: 6379,
      alias: 'redis',
      containerPath: '/data',
      healthCmd: 'redis-cli ping',
    },
    env: [],
  },
]

export function listTemplates() {
  return TEMPLATES
}
