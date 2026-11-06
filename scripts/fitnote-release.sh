#!/usr/bin/env bash
# fitnote 发版：把平台上传的安装包送进容器，再执行 publish_release publish
#
# 平台注入的变量/参数：
#   APP_CONTAINER  目标容器名（脚本绑定「目标应用」后由平台自动注入，如 ourjia_app_2535046669a9）
#   PLATFORM       平台，android / ios
#   VERSION        版本号，如 1.5.0
#   BUILD          构建号，如 150
#   CHANGELOG      更新说明，可留空
#   FORCED         强制更新，'true' / 'false'
#   APK_FILE       文件参数：平台上传后的绝对路径（如 /tmp/ourjia-release/fitnote-1.5.0-150.apk）
#
# 平台会先把选中的文件 SFTP 到「上传目录」，脚本里通过 $APK_FILE 拿到路径。
set -euo pipefail

CONTAINER=${APP_CONTAINER:?平台没有注入 APP_CONTAINER：请在脚本编辑里绑定目标应用，或手动填写容器名}
PLATFORM=${PLATFORM:?缺少参数 PLATFORM}
VERSION=${VERSION:?缺少参数 VERSION}
BUILD=${BUILD:?缺少参数 BUILD}
APK_HOST=${APK_FILE:?缺少文件参数 APK_FILE}
CHANGELOG=${CHANGELOG:-}
FORCED=${FORCED:-false}

CONTAINER_DIR=/tmp/ourjia-release
APK_NAME=$(basename "$APK_HOST")
CONTAINER_APK="${CONTAINER_DIR}/${APK_NAME}"

die() {
  echo "✗ $*" >&2
  exit 1
}

# ---- 先校验，免得装了几十兆才发现参数不对 ----
case "$PLATFORM" in
  android|ios) ;;
  *) die "PLATFORM 只能是 android 或 ios，当前：$PLATFORM" ;;
esac
[[ "$BUILD" =~ ^[0-9]+$ ]] || die "BUILD 只能是数字，当前：$BUILD"
[[ "$VERSION" =~ ^[0-9]+(\.[0-9]+){1,3}([-+._][0-9A-Za-z._]+)?$ ]] || die "VERSION 格式不对（应类似 1.5.0），当前：$VERSION"
[[ -f "$APK_HOST" ]] || die "安装包不存在：$APK_HOST"
[[ -r "$APK_HOST" ]] || die "安装包不可读：$APK_HOST"
command -v docker >/dev/null 2>&1 || die "服务器上没有 docker 命令"

RUNNING=$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || true)
[[ "$RUNNING" == "true" ]] || die "容器 $CONTAINER 不在运行中，请先确认应用状态（docker ps -a）"

FORCED_LABEL=''
if [[ "$FORCED" == "true" ]]; then
  FORCED_LABEL=' · 强制更新'
fi

echo "▶ 容器 $CONTAINER"
echo "▶ 安装包 $APK_HOST（$(du -h "$APK_HOST" | cut -f1)）"
echo "▶ 版本 $VERSION（build $BUILD，$PLATFORM）${FORCED_LABEL}"

# 容器里的安装包只是给 publish_release 读一次，结束时无论成败都清掉
cleanup() {
  docker exec "$CONTAINER" rm -rf "$CONTAINER_DIR" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "▶ 复制安装包到容器 $CONTAINER:$CONTAINER_APK"
docker exec "$CONTAINER" mkdir -p "$CONTAINER_DIR"
docker cp "$APK_HOST" "$CONTAINER:$CONTAINER_APK"
docker exec "$CONTAINER" test -f "$CONTAINER_APK" || die "容器里没有找到 $CONTAINER_APK"

ARGS=(publish --platform "$PLATFORM" --version "$VERSION" --build "$BUILD" --upload "$CONTAINER_APK")
if [[ -n "$CHANGELOG" ]]; then
  ARGS+=(--changelog "$CHANGELOG")
fi
if [[ "$FORCED" == "true" ]]; then
  ARGS+=(--forced)
fi

echo "▶ docker exec $CONTAINER python manage.py publish_release ${ARGS[*]}"
docker exec "$CONTAINER" python manage.py publish_release "${ARGS[@]}"

echo "✓ 发布完成：$PLATFORM $VERSION（build $BUILD）"
