# GFS sing-box 插件中心

这是 GUI.for.SingBox / GUI.for.Cores 自用插件中心，集中维护多个 sing-box 相关插件。

## 插件中心订阅

在 GFS 插件中心中添加下面的订阅源：

```text
https://raw.githubusercontent.com/SenreySong/gfs-singbox-plugin-hub/main/plugin-subscription.json
```

## 包含插件

### 指定节点中转

文件：

- `plugin-single-node-relay.js`
- `plugin-single-node-relay.metadata.json`

功能：

- 为指定 sing-box 出站节点配置中转节点。
- 启动核心前写入 `detour`。
- 配置独立保存，不修改订阅和 GUI profile。
- 订阅或配置更新后，中转关系继续保留。
- 中转节点不存在时自动清理对应规则。
- 禁止循环链路，例如 `A -> B -> A`、`A -> B -> C -> A`。
- 保存后如果核心正在运行，会触发核心重启。

### 出站 DNS 解析器

文件：

- `plugin-outbound-dns-resolver.js`
- `plugin-outbound-dns-resolver.metadata.json`

功能：

- 按多条规则为 sing-box 出站写入 `domain_resolver`。
- DNS 服务使用当前配置中的 DNS tag 下拉选择。
- 支持为没有 DNS 且属于域名类的出站补默认 DNS。
- 保存后如果核心正在运行，会触发核心重启。

### 策略组自动整理

文件：

- `plugin-policy-group-manager.js`
- `plugin-policy-group-manager.metadata.json`

功能：

- 按可配置规则自动生成国家或地区策略组。
- 默认包含香港、台湾、日本、美国、澳大利亚、德国等分组。
- 台湾组默认只收纳名称包含 `CN2` 或 `CFT` 的节点。
- 支持 Other 组收纳未命中分组的节点。
- 可把生成的策略组插入到未隐藏策略组中。
- 保存后如果核心正在运行，会触发核心重启。

### 测试版核心配置迁移

文件：

- `plugin-singbox-beta-migrator.js`
- `plugin-singbox-beta-migrator.metadata.json`

功能：

- 在启动核心前处理最终生成配置，用于适配 sing-box 测试版核心的新配置要求。
- 处理 1.14 相关 DNS/TUN/HTTP/ACME 配置迁移。
- 支持强制类转换和推荐类转换的分区展示。
- 支持通过功能开关注入新配置能力。
- 核心运行中可查看 `data/sing-box/config.json` 的完整运行时配置，方便确认转换效果。

### TCP 延迟与测速

文件：

- `plugin-tcp-speed-tester.js`
- `plugin-tcp-speed-tester.metadata.json`

功能：

- 可选择一个或多个节点进行 TCP 延迟与下载测速。
- 可选择一个或多个策略组，策略组会展开为组内节点并去重。
- TCP 延迟默认使用 `https://cp.cloudflare.com/generate_204`。
- 下载测速默认使用 `https://speed.cloudflare.com/__down?bytes=25000000`。
- 测速地址、延迟地址、超时、并发数和测速字节数均可自定义。
- 测试结果持久化保存，方便多次对比。
- 测试时启动独立临时 sing-box 核心，不修改当前运行核心。
- 默认启用旁路当前 TUN，自动检测系统默认物理接口并写入 `bind_interface` / `route.default_interface`，也可手动指定接口名。

## 文件结构

```text
plugin-subscription.json
plugin-*.js
plugin-*.metadata.json
```

## 维护说明

- 插件源码和 metadata 中的 raw URL 都指向本仓库。
- 旧的分散插件仓库已迁移到本仓库统一维护。
- 插件配置仍由 GFS 保存到各插件自己的 `data/third/...` 路径。
