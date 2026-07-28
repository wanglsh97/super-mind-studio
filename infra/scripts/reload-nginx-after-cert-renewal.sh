#!/usr/bin/env sh
set -eu

container_id="$(
  docker ps \
    --filter 'label=com.docker.compose.project=super-mind-studio-prod' \
    --filter 'label=com.docker.compose.service=nginx' \
    --format '{{.ID}}'
)"

if [ -z "$container_id" ]; then
  echo '生产 Nginx 容器未运行，跳过证书热加载。' >&2
  exit 0
fi

docker kill --signal=HUP "$container_id" >/dev/null
echo '生产 Nginx 已热加载续期证书。'
