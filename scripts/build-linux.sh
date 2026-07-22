#!/usr/bin/env bash
set -euo pipefail

# 在 Linux Docker 容器中构建 .deb / .AppImage 安装包
# 用法: ./scripts/build-linux.sh

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="dbmanager-linux-builder"

echo "==> 构建 Docker 镜像（包含所有 Linux 构建依赖）..."
docker build -t "$IMAGE" -f - "$REPO_ROOT" << 'DOCKERFILE'
FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    curl wget \
    build-essential pkg-config \
    libwebkit2gtk-4.1-dev librsvg2-dev patchelf \
    libgtk-3-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev \
    libayatana-appindicator3-dev \
    libdbus-1-dev libssl-dev libaio-dev libclang-dev

# Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs

# Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /build
CMD ["bash", "-c", "npm ci && npx tauri build --bundles deb,appimage"]
DOCKERFILE

echo "==> 在容器中编译..."
docker run --rm -v "$REPO_ROOT:/build" "$IMAGE"

echo "==> 完成！产物在:"
ls -lh "$REPO_ROOT/src-tauri/target/release/bundle/deb/"*.deb 2>/dev/null || true
ls -lh "$REPO_ROOT/src-tauri/target/release/bundle/appimage/"*.AppImage 2>/dev/null || true
