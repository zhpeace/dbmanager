# 构建安装包

## macOS（本机）

```bash
npm run tauri:build
# 产物: src-tauri/target/release/bundle/dmg/DBManager_*.dmg
```

## Linux（Docker）

不需要 Linux 机器，用 Docker 在本地打 .deb 和 .AppImage：

```bash
./scripts/build-linux.sh
```

首次运行会拉取 Ubuntu 22.04 + 安装所有依赖（约 10 分钟），后续只需 2-3 分钟。

## Windows

需要以下任一方式：

### 方式一：Windows 本机或虚拟机
在 Windows 上装好 Node.js + Rust + 运行 `npm run tauri:build`，生成 `.msi`。

### 方式二：Coding.net CI（国内免费，推荐）
1. 在 https://coding.net 创建仓库并推送代码
2. 进入「持续集成」→ 新建构建计划
3. 选择自定义构建，粘贴以下配置：

```yaml
pipeline:
  agent:
    image: codingci/tauri:latest
  stages:
    - stage: Build
      steps:
        - run: npm ci
        - run: npx tauri build --bundles msi,deb,appimage,dmg
  artifacts:
    - src-tauri/target/release/bundle/**
```

Coding.net 的 macOS/Windows/Linux 构建节点都在国内，速度快。

### 方式三：Gitee Go（推荐，国内访问最快）
1. 在 https://gitee.com 创建仓库，推送代码
2. 仓库 → 流水线 → 新建流水线 → 选择「Gitee Go」
3. 粘贴 `.gitee/workflows/build.yml` 的内容（已配置好）
4. 每次推送代码或打 `v*` 标签，自动构建 macOS/Windows/Linux 三平台安装包

仓库目录下已有 `.gitee/workflows/build.yml`，配置了：
- macOS → `.dmg`
- Windows → `.msi`  
- Linux → `.deb` + `.AppImage`
- 设置了 `DBMANAGER_SKIP_LICENSE=1` 跳过许可校验

## 为什么不能本机跨平台打包？

Tauri 的安装包依赖操作系统原生的工具链：
- `.dmg` → 需要 macOS 的 `hdiutil`
- `.msi` → 需要 Windows 的 WiX Toolset
- `.deb` → 需要 Linux 的 `dpkg-deb`
- `.AppImage` → 需要 Linux 的 `appimagetool`

Rust 本身可以交叉编译，但 Tauri 的 WebView 和系统集成层做不到跨平台交叉编译。
