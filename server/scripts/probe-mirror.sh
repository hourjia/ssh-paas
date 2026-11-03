# 探测镜像加速器能否真正提供指定镜像（manifest + 首个 layer 可达）
# 入参由调用方以变量 PREPEND 形式注入：IMG / TAG / MIRROR
set -u
host="$MIRROR"
base="https://$host"
hdr=$(curl -sSI -m 6 "$base/v2/" 2>/dev/null | tr -d '\r')
realm=$(printf '%s\n' "$hdr" | sed -n 's/.*realm="\([^"]*\)".*/\1/p' | head -1)
service=$(printf '%s\n' "$hdr" | sed -n 's/.*service="\([^"]*\)".*/\1/p' | head -1)
[ -z "$realm" ] && { echo "RESULT|fail|无 registry v2 认证入口"; exit 0; }

tok=$(curl -sS -m 8 "$realm?service=$service&scope=repository:$IMG:pull" 2>/dev/null | \
      sed -n 's/.*"token":"\([^"]*\)".*/\1/p;s/.*"access_token":"\([^"]*\)".*/\1/p' | head -1)
[ -z "$tok" ] && { echo "RESULT|fail|无法获取镜像仓库 token"; exit 0; }

code=$(curl -sS -m 12 -o /tmp/.oj-manifest -w '%{http_code}' -H "Authorization: Bearer $tok" \
  -H 'Accept: application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.docker.distribution.manifest.v2+json' \
  "$base/v2/$IMG/manifests/$TAG" 2>/dev/null || echo 000)
[ "$code" != "200" ] && { rm -f /tmp/.oj-manifest; echo "RESULT|fail|manifest 返回 HTTP $code"; exit 0; }

digest=$(sed -n 's/.*"digest":"\(sha256:[a-f0-9]\{64\}\)".*/\1/p' /tmp/.oj-manifest | head -1)
rm -f /tmp/.oj-manifest
if [ -n "$digest" ]; then
  bcode=$(curl -sSI -m 12 -H "Authorization: Bearer $tok" -o /dev/null -w '%{http_code}' \
    "$base/v2/$IMG/blobs/$digest" 2>/dev/null || echo 000)
  echo "RESULT|ok|manifest 与镜像层均可用（layer HTTP $bcode）"
else
  echo "RESULT|ok|manifest 可用"
fi
