set -u
kv() { printf '%s=%s\n' "$1" "$2"; }

# --- 系统 ---
if [ -r /etc/os-release ]; then . /etc/os-release; fi
kv OS_PRETTY "${PRETTY_NAME:-}"
kv OS_ID "${ID:-}"
kv OS_VERSION "${VERSION_ID:-}"
kv ARCH "$(uname -m)"
kv KERNEL "$(uname -r)"
kv HOSTNAME "$(hostname)"
kv UPTIME_SEC "$(cut -d. -f1 /proc/uptime 2>/dev/null || echo 0)"
kv NOW_EPOCH "$(date +%s)"
kv TZ "$( (timedatectl show -p Timezone --value 2>/dev/null) || cat /etc/timezone 2>/dev/null || echo '')"
kv TZ_SYNC "$(timedatectl show -p NTPSynchronized --value 2>/dev/null || echo unknown)"
kv VIRT "$(systemd-detect-virt 2>/dev/null || echo unknown)"
kv CGROUP "$(stat -fc %T /sys/fs/cgroup 2>/dev/null || echo unknown)"

# --- 权限 ---
kv UID "$(id -u)"
kv USER "$(id -un)"
if [ "$(id -u)" = 0 ]; then
  kv SUDO yes
elif sudo -n true 2>/dev/null; then
  kv SUDO yes
else
  kv SUDO no
fi

# --- 资源 ---
kv CPU "$(nproc 2>/dev/null || echo 0)"
kv MEM_TOTAL_MB "$(awk '/MemTotal/{printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)"
kv MEM_AVAIL_MB "$(awk '/MemAvailable/{printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)"
kv SWAP_TOTAL_MB "$(awk '/SwapTotal/{printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)"
kv SWAPPINESS "$(cat /proc/sys/vm/swappiness 2>/dev/null || echo '')"
kv SWAP_ACTIVE "$(swapon --show=NAME --noheadings 2>/dev/null | head -1 | tr -d ' \n' || true)"
kv DISK_TOTAL_KB "$(df -Pk / 2>/dev/null | awk 'NR==2{print $2}')"
kv DISK_AVAIL_KB "$(df -Pk / 2>/dev/null | awk 'NR==2{print $4}')"
kv SWAPFILES "$(grep -c ' swap ' /etc/fstab 2>/dev/null || echo 0)"

# --- Docker ---
if command -v docker >/dev/null 2>&1; then
  kv DOCKER_BIN "$(command -v docker)"
  kv DOCKER_VERSION "$(docker --version 2>/dev/null | sed 's/,.*//')"
  if docker info >/dev/null 2>&1; then kv DOCKER_RUNNING yes; else kv DOCKER_RUNNING no; fi
  kv COMPOSE_VERSION "$(docker compose version --short 2>/dev/null || echo '')"
  kv BUILDX_VERSION "$(docker buildx version 2>/dev/null | awk '{print $2}' || echo '')"
  kv DOCKER_ROOT "$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || echo '')"
  kv DOCKER_MIRRORS "$(docker info -f '{{join .RegistryConfig.Mirrors ","}}' 2>/dev/null || echo '')"
  kv DOCKER_NETWORKS "$(docker network ls --format '{{.Name}}' 2>/dev/null | paste -sd, - || echo '')"
else
  kv DOCKER_BIN ""
  kv DOCKER_VERSION ""
  kv DOCKER_RUNNING no
  kv COMPOSE_VERSION ""
  kv BUILDX_VERSION ""
  kv DOCKER_MIRRORS ""
  kv DOCKER_NETWORKS ""
fi
kv DOCKER_SERVICE "$(systemctl is-active docker 2>/dev/null || echo inactive)"

# --- daemon.json 现状 ---
if [ -r /etc/docker/daemon.json ]; then
  kv DAEMON_JSON_PRESENT yes
  kv DAEMON_JSON_MIRRORS "$( (jq -r '."registry-mirrors" // [] | join(",")' /etc/docker/daemon.json 2>/dev/null) || echo '')"
  kv DAEMON_JSON_DNS "$( (jq -r '.dns // [] | join(",")' /etc/docker/daemon.json 2>/dev/null) || echo '')"
  kv DAEMON_JSON_POOLS "$( (jq -r '."default-address-pools" // [] | map(.base) | join(",")' /etc/docker/daemon.json 2>/dev/null) || echo '')"
else
  kv DAEMON_JSON_PRESENT no
  kv DAEMON_JSON_MIRRORS ""
  kv DAEMON_JSON_DNS ""
  kv DAEMON_JSON_POOLS ""
fi

# --- 网络 ---
kv DNS_UPSTREAM "$( (resolvectl status 2>/dev/null | awk '/DNS Servers:/{for(i=3;i<=NF;i++){printf "%s%s", sep, $i; sep=","}}') || echo '')"
kv DNS_RESOLV "$(awk '/^nameserver/{printf "%s%s", sep, $2; sep=","}' /etc/resolv.conf 2>/dev/null || echo '')"
kv IP_ROUTES "$(ip -o -4 route show scope link 2>/dev/null | awk '{print $1}' | paste -sd, - 2>/dev/null || echo '')"
kv IP_ADDRS "$(ip -o -4 addr show scope global 2>/dev/null | awk '$2 !~ /^(docker|br-|veth|lo)/ {print $4}' | paste -sd, - 2>/dev/null || echo '')"
kv GATEWAY "$(ip -o -4 route show default 2>/dev/null | awk '{print $3}' | head -1)"

# --- 端口占用 ---
kv PORT80 "$( (ss -ltnH 2>/dev/null | awk '$4 ~ /:80$/ {print $4; exit}') || echo '')"
kv PORT443 "$( (ss -ltnH 2>/dev/null | awk '$4 ~ /:443$/ {print $4; exit}') || echo '')"
kv PORT80_PROC "$( (ss -ltnpH 2>/dev/null | awk '$4 ~ /:80$/ {print; exit}') || echo '')"

# --- 平台骨架 ---
for d in /srv /srv/apps /srv/shared /srv/traefik /srv/data /srv/.ourjia; do
  key="DIR_$(printf '%s' "$d" | tr '/.-' '___')"
  if [ -d "$d" ]; then kv "$key" yes; else kv "$key" no; fi
done

if [ -r /srv/.ourjia/init.json ]; then
  kv INIT_RECORD yes
  kv INIT_RECORD_BODY "$(tr -d '\n' < /srv/.ourjia/init.json | head -c 4000)"
else
  kv INIT_RECORD no
  kv INIT_RECORD_BODY ""
fi

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  kv NET_PROXY "$(docker network inspect proxy-net -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}' 2>/dev/null || echo '')"
  kv NET_SHARED "$(docker network inspect shared-net -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}' 2>/dev/null || echo '')"
  kv NET_NAMES "$(docker network ls --format '{{.Name}}' 2>/dev/null | paste -sd, - || echo '')"
  kv TRAEFIK_STATE "$(docker inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' traefik 2>/dev/null || echo '')"
  kv TRAEFIK_IMAGE "$(docker inspect -f '{{.Config.Image}}' traefik 2>/dev/null || echo '')"
  kv TRAEFIK_CMD "$(docker inspect -f '{{join .Config.Cmd " "}}' traefik 2>/dev/null | head -c 2000 || echo '')"
  kv CONTAINERS_ALL "$(docker ps -a --format '{{.Names}}|{{.Image}}|{{.Status}}' 2>/dev/null | paste -sd';' - || echo '')"
else
  kv NET_PROXY ""
  kv NET_SHARED ""
  kv NET_NAMES ""
  kv TRAEFIK_STATE ""
  kv TRAEFIK_IMAGE ""
  kv TRAEFIK_CMD ""
  kv CONTAINERS_ALL ""
fi

# --- 防火墙 ---
if command -v ufw >/dev/null 2>&1; then
  kv UFW_INSTALLED yes
  kv UFW_STATUS "$(ufw status 2>/dev/null | head -1 | sed 's/^Status: *//')"
else
  kv UFW_INSTALLED no
  kv UFW_STATUS missing
fi
if command -v firewall-cmd >/dev/null 2>&1; then kv FIREWALLD "$(firewall-cmd --state 2>/dev/null || echo inactive)"; else kv FIREWALLD missing; fi
kv IPTABLES_POLICY "$(iptables -S 2>/dev/null | awk '/^-P INPUT/{print $3}' | head -1)"

# --- 依赖 ---
for c in git curl jq tar gzip; do
  key="TOOL_$(printf '%s' "$c" | tr 'a-z' 'A-Z')"
  if command -v "$c" >/dev/null 2>&1; then kv "$key" yes; else kv "$key" no; fi
done

# --- apt 源与锁 ---
kv APT_URI "$(grep -hs '^URIs:' /etc/apt/sources.list.d/*.sources /etc/apt/sources.list 2>/dev/null | head -1 | sed 's/^URIs: *//')"
kv APT_LOCK "$( (fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 && echo busy) || echo free)"
kv UNATTENDED "$(systemctl is-active unattended-upgrades 2>/dev/null || echo inactive)"

# --- 云元数据 ---
kv CLOUD_IP "$(curl -sS -m 3 -H 'Metadata: true' http://100.100.100.200/latest/meta-data/eipv4 2>/dev/null || echo '')"
kv CLOUD_REGION "$(curl -sS -m 3 -H 'Metadata: true' http://100.100.100.200/latest/meta-data/region-id 2>/dev/null || echo '')"

# --- 公网出口 IP：单个服务（尤其 ipify）在境内经常不可达，逐个回退 ---
PUBLIC_IP=""
for url in https://api.ipify.org https://ifconfig.me/ip https://ipinfo.io/ip https://api.ip.sb/ip; do
  cand=$(curl -4 -fsS -m 5 "$url" 2>/dev/null | tr -d '[:space:]')
  case "$cand" in
    '') continue ;;
  esac
  if printf '%s' "$cand" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; then
    PUBLIC_IP="$cand"
    break
  fi
done
# 回退到云厂商元数据里的弹性公网 IP
if [ -z "$PUBLIC_IP" ]; then
  cand=$(curl -sS -m 3 -H 'Metadata: true' http://100.100.100.200/latest/meta-data/eipv4 2>/dev/null | tr -d '[:space:]')
  if printf '%s' "$cand" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; then PUBLIC_IP="$cand"; fi
fi
kv PUBLIC_IP "$PUBLIC_IP"
