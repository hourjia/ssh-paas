#!/usr/bin/env bash
# fitnote 安卓自动发版：GitHub Release 上有新构建时，才发布到 fitnote 后端
#
# 与 fitnote-release.sh 的区别：那个由人上传安装包；这个从 GitHub Releases 自己
# 取最新构建，和服务器上已发布的版本比，只有 GitHub 上更新才发版，可以反复执行。
#
# 判断依据是 versionCode（Android 的 build）：后端的版本门禁按 build 比较，
# versionName 只用于展示，同一个版本号重新打包也可能带来更大的 build。
#
# 平台注入：
#   APP_CONTAINER  绑定「目标应用」后由平台自动注入的容器名
# 固定环境变量（脚本编辑页配置，加密保存、运行时 export，不落服务器磁盘）：
#   GITHUB_TOKEN   必填，能读该仓库的 GitHub 令牌（细粒度 PAT 勾 Contents: Read 即可）
#   GITHUB_REPO    默认 ourjia-fitnote/android-app
#   GITHUB_API     默认 https://api.github.com（GitHub Enterprise 才需要改）
#   GITHUB_PROXY   可选，例如 http://127.0.0.1:7890
# 运行参数：
#   TAG            只处理指定的 Release（默认取 build 最大的正式版）
#   CHANGELOG      更新说明；留空则取 Release 正文第一行有效文字
#   FORCED         强制更新（true / false，默认 false）
#   DRY_RUN        只检查、不发布（true / false，默认 false）
set -euo pipefail

CONTAINER=${APP_CONTAINER:?平台没有注入 APP_CONTAINER：请在脚本编辑里绑定目标应用}
GITHUB_REPO=${GITHUB_REPO:-ourjia-fitnote/android-app}
GITHUB_API=${GITHUB_API:-https://api.github.com}
GITHUB_TOKEN=${GITHUB_TOKEN:?缺少 GITHUB_TOKEN：请在脚本的固定环境变量里配置一个能读仓库的 GitHub 令牌}
TAG=${TAG:-}
CHANGELOG=${CHANGELOG:-}
FORCED=${FORCED:-false}
DRY_RUN=${DRY_RUN:-false}

GITHUB_API=${GITHUB_API%/}
CONTAINER_DIR=/tmp/ourjia-release

die() {
  echo "✗ $*" >&2
  exit 1
}

step() {
  echo "▶ $*"
}

for tool in curl jq docker sha256sum; do
  command -v "$tool" >/dev/null 2>&1 || die "服务器上没有 $tool 命令"
done

TMP=$(mktemp -d "${TMPDIR:-/tmp}/fitnote-release.XXXXXX")
cleanup() {
  rm -rf "$TMP"
  # 容器里的安装包只是给 publish_release 读一次，结束时无论成败都清掉
  docker exec "$CONTAINER" rm -rf "$CONTAINER_DIR" >/dev/null 2>&1 || true
}
trap cleanup EXIT

CURL=(curl -sSL --retry 3 --retry-delay 2 --connect-timeout 20)
if [[ -n "${GITHUB_PROXY:-}" ]]; then
  CURL+=(--proxy "$GITHUB_PROXY")
fi

# GitHub API 请求：$1=path，$2=输出文件。出错时给出可执行的提示，而不是一段 HTML
gh_api() {
  local path=$1 dest=$2 code
  code=$("${CURL[@]}" --max-time 90 \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -H "User-Agent: ourjia-paas" \
    -o "$dest" -w '%{http_code}' \
    "$GITHUB_API$path") ||
    die "无法访问 GitHub API（$GITHUB_API），请检查服务器出网，或配置 GITHUB_PROXY"
  case "$code" in
    2*) ;;
    401) die "GitHub 令牌无效或已过期（HTTP 401）：请更新 GITHUB_TOKEN" ;;
    403) die "GitHub 拒绝访问（HTTP 403）：令牌权限不足，或触发了 API 限流" ;;
    404)
      if [[ "$path" == */releases/tags/* ]]; then
        die "找不到 Release 标签 $TAG"
      fi
      die "GitHub 返回 404：仓库 $GITHUB_REPO 不存在，或令牌没有读取权限"
      ;;
    *) die "GitHub API $path 返回 HTTP $code" ;;
  esac
}

# 下载 Release 附件：API 会 302 到带签名的下载地址，curl -L 负责跟随
download_asset() {
  local id=$1 dest=$2 code
  code=$("${CURL[@]}" --max-time 900 \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/octet-stream" \
    -H "User-Agent: ourjia-paas" \
    -o "$dest" -w '%{http_code}' \
    "$GITHUB_API/repos/$GITHUB_REPO/releases/assets/$id") ||
    die "下载 Release 附件失败：网络中断或被代理拦截"
  case "$code" in
    2*) ;;
    *) die "下载 Release 附件返回 HTTP $code" ;;
  esac
}

RUNNING=$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || true)
[[ "$RUNNING" == "true" ]] || die "容器 $CONTAINER 不在运行中，请先确认应用状态（docker ps -a）"

# ---- 1. 找 GitHub 上最新的正式 Release ----
# 不能只看「最新创建」：补发旧版本时创建时间会更新，但 build 反而更小。
# 这里按附件名里的 vc<versionCode> 取最大，没有 vc 的旧版本再按发布时间兜底。
step "读取 GitHub Release：$GITHUB_REPO"
REL_FILE=$TMP/release.json
if [[ -n "$TAG" ]]; then
  gh_api "/repos/$GITHUB_REPO/releases/tags/$TAG" "$REL_FILE"
else
  gh_api "/repos/$GITHUB_REPO/releases?per_page=30" "$REL_FILE"
fi

RELEASE=$(jq -c --arg tag "$TAG" '
  (if type == "array" then . else [.] end)
  # 自动模式只认正式版；显式指定 TAG 时按操作者的选择来，draft/prerelease 也放行
  | (if $tag == "" then
       map(select((.draft // false) == false and (.prerelease // false) == false))
     else . end)
  | map(. + {vc: ([.assets[].name
        | (try capture("vc(?<n>[0-9]+)").n catch empty)
        | tonumber] | max // 0)})
  | sort_by([.vc, (.published_at // "")])
  | last // empty
' "$REL_FILE")
[[ -n "$RELEASE" ]] || die "没有可发布的 Release（可能都是 draft / prerelease）"

REMOTE_TAG=$(jq -r '.tag_name' <<<"$RELEASE")
REMOTE_BODY=$(jq -r '.body // ""' <<<"$RELEASE")
APK_NAME=$(jq -r 'first(.assets[] | select(.name | test("-vc[0-9]+-release\\.apk$")) | .name) // empty' <<<"$RELEASE")
APK_ID=$(jq -r 'first(.assets[] | select(.name | test("-vc[0-9]+-release\\.apk$")) | .id) // empty' <<<"$RELEASE")
BI_ID=$(jq -r 'first(.assets[] | select(.name == "build-info.json") | .id) // empty' <<<"$RELEASE")
[[ -n "$APK_ID" && -n "$APK_NAME" ]] ||
  die "Release $REMOTE_TAG 里没有 *-vc*-release.apk：签名 secrets 没配时 CI 不会产出 release 包"

# build-info.json 是构建时写下的真值（版本号、构建号、APK 大小与 sha256）
VERSION=""
BUILD=""
APK_SHA=""
APK_BYTES=""
if [[ -n "$BI_ID" ]]; then
  download_asset "$BI_ID" "$TMP/build-info.json"
  VERSION=$(jq -r '.versionName // empty' "$TMP/build-info.json")
  BUILD=$(jq -r '.versionCode // empty' "$TMP/build-info.json")
  APK_SHA=$(jq -r --arg file "$APK_NAME" 'first(.artifacts[]? | select(.file == $file) | .sha256) // empty' "$TMP/build-info.json")
  APK_BYTES=$(jq -r --arg file "$APK_NAME" 'first(.artifacts[]? | select(.file == $file) | .bytes) // empty' "$TMP/build-info.json")
fi
# 老 Release 没有 build-info.json：版本号回落到 tag，构建号回落到附件名
if [[ -z "$VERSION" ]]; then
  VERSION=${REMOTE_TAG#v}
fi
if [[ -z "$BUILD" ]]; then
  BUILD=$(sed -n 's/.*-vc\([0-9]\+\)-release\.apk$/\1/p' <<<"$APK_NAME")
fi
[[ "$BUILD" =~ ^[0-9]+$ ]] || die "无法确定构建号（Release $REMOTE_TAG，附件 $APK_NAME）"
[[ "$VERSION" =~ ^[0-9]+(\.[0-9]+){1,3}([-+._][0-9A-Za-z._]+)?$ ]] ||
  die "版本号格式不对（应类似 1.5.0），当前：$VERSION"

# ---- 2. 读服务器上已发布（含已下架）的最高 build ----
# 比较对象用「所有记录」而不是「在线记录」：下架的构建不能被自动发版重新推上线。
step "读取服务器已发布版本"
# manage.py shell 启动时会打印一行「N objects imported automatically」，
# 用固定前缀标记结果，避免被这类无关输出干扰。
SERVER_RAW=$(docker exec "$CONTAINER" python manage.py shell -c "
from api.models import AppRelease
import json
rows = AppRelease.objects.filter(platform='android')
top = rows.order_by('-build_number').first()
active = rows.filter(is_active=True).order_by('-build_number').first()
print('OURJIA_RESULT:' + json.dumps({
    'max_build': top.build_number if top else 0,
    'max_version': top.version if top else '',
    'max_active': bool(top and top.is_active),
    'active_build': active.build_number if active else 0,
    'active_version': active.version if active else '',
}))
" 2>&1 || true)
SERVER_JSON=$(printf '%s\n' "$SERVER_RAW" | sed -n 's/^OURJIA_RESULT://p' | tail -n 1)
[[ -n "$SERVER_JSON" ]] ||
  die "读取服务器已发布版本失败：$(printf '%s' "$SERVER_RAW" | tail -n 3 | tr '\n' ' ')"

SERVER_BUILD=$(jq -r '.max_build // 0' <<<"$SERVER_JSON" 2>/dev/null || true)
[[ "$SERVER_BUILD" =~ ^[0-9]+$ ]] || die "解析服务器版本失败：$SERVER_JSON"
SERVER_VERSION=$(jq -r '.max_version // ""' <<<"$SERVER_JSON")
SERVER_ACTIVE=$(jq -r '.max_active // false' <<<"$SERVER_JSON")

echo "▶ GitHub：$VERSION（build $BUILD，$REMOTE_TAG）"
if ((SERVER_BUILD > 0)); then
  echo "▶ 服务器：$SERVER_VERSION（build $SERVER_BUILD，$([[ "$SERVER_ACTIVE" == "true" ]] && echo 在线 || echo 已下架)）"
else
  echo "▶ 服务器：还没有任何发布记录"
fi

if ((BUILD < SERVER_BUILD)); then
  echo "！GitHub 上的构建比服务器旧（$BUILD < $SERVER_BUILD），跳过：不做降级"
  exit 0
fi
if ((BUILD == SERVER_BUILD)); then
  if [[ "$SERVER_ACTIVE" == "true" ]]; then
    echo "✓ 已是最新：build $BUILD 已在服务器上线，无需发版"
  else
    echo "！build $BUILD 已在服务器登记但处于下架状态，跳过（要重新上线请用 publish_release activate）"
  fi
  exit 0
fi

# ---- 3. 下载并校验安装包 ----
step "下载安装包 $APK_NAME"
APK_PATH="$TMP/$APK_NAME"
download_asset "$APK_ID" "$APK_PATH"

SIZE=$(stat -c%s "$APK_PATH")
((SIZE > 0)) || die "下载到的安装包是空文件"
if [[ -n "$APK_BYTES" && "$SIZE" != "$APK_BYTES" ]]; then
  die "安装包大小不对：下载 $SIZE 字节，build-info 记录 $APK_BYTES"
fi
if [[ -n "$APK_SHA" ]]; then
  ACTUAL_SHA=$(sha256sum "$APK_PATH" | awk '{print $1}')
  [[ "$ACTUAL_SHA" == "$APK_SHA" ]] ||
    die "sha256 校验失败：下载 $ACTUAL_SHA，build-info 记录 $APK_SHA"
  echo "  ✓ sha256 ${APK_SHA:0:12}…（$((SIZE / 1024)) KB）"
else
  echo "  ✓ 下载完成（$((SIZE / 1024)) KB，该 Release 没有 build-info.json，未校验 sha256）"
fi

# 更新说明：Release 正文通常只有 GitHub 自动生成的 Full Changelog 链接
if [[ -z "$CHANGELOG" ]]; then
  CHANGELOG=$(printf '%s\n' "$REMOTE_BODY" |
    grep -v '^\*\*Full Changelog\*\*' |
    sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' |
    grep -v '^$' |
    head -n 1 || true)
fi

if [[ "$DRY_RUN" == "true" ]]; then
  echo "▶ DRY_RUN：跳过发布，实际会执行："
  echo "  docker cp $APK_PATH $CONTAINER:$CONTAINER_DIR/$APK_NAME"
  echo "  docker exec $CONTAINER python manage.py publish_release publish --platform android --version $VERSION --build $BUILD --upload $CONTAINER_DIR/$APK_NAME"
  [[ -n "$CHANGELOG" ]] && echo "    更新说明：$CHANGELOG"
  [[ "$FORCED" == "true" ]] && echo "    （强制更新）"
  exit 0
fi

# ---- 4. 放进容器并发布 ----
step "复制安装包到容器 $CONTAINER:$CONTAINER_DIR/$APK_NAME"
docker exec "$CONTAINER" mkdir -p "$CONTAINER_DIR"
docker cp "$APK_PATH" "$CONTAINER:$CONTAINER_DIR/$APK_NAME"
docker exec "$CONTAINER" test -f "$CONTAINER_DIR/$APK_NAME" || die "容器里没有找到 $CONTAINER_DIR/$APK_NAME"

ARGS=(publish --platform android --version "$VERSION" --build "$BUILD" --upload "$CONTAINER_DIR/$APK_NAME")
if [[ -n "$CHANGELOG" ]]; then
  ARGS+=(--changelog "$CHANGELOG")
fi
if [[ "$FORCED" == "true" ]]; then
  ARGS+=(--forced)
fi

step "docker exec $CONTAINER python manage.py publish_release ${ARGS[*]}"
docker exec "$CONTAINER" python manage.py publish_release "${ARGS[@]}"

echo "✓ 发版完成：android $VERSION（build $BUILD）"
