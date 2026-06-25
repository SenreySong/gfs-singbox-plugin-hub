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
- 会跳过插件内部使用的测速策略组，避免修改临时测速 selector。
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
- 启动时在克隆配置上执行迁移；插件关闭、仅预览或核心非测试版时，会恢复上次迁移前配置。
- 核心运行中可查看 `data/sing-box/config.json` 的完整运行时配置，方便确认转换效果。

### TCP 延迟与测速

文件：

- `plugin-tcp-speed-tester.js`
- `plugin-tcp-speed-tester.metadata.json`

功能：

- 可选择一个或多个节点进行 TCP 延迟与下载测速。
- 不提供策略组选择，避免预览阶段拿不到其他插件处理后的策略组导致结果不一致。
- 节点列表支持搜索、全选当前显示节点和清空选择。
- TCP 延迟默认使用 `https://cp.cloudflare.com/generate_204`。
- 下载测速默认使用 `https://speed.cloudflare.com/__down?bytes=25000000`。
- 测速地址、延迟地址和超时均可自定义。
- 测试按节点队列逐个执行，不做并发测速。
- 测试结果持久化保存，方便多次对比。
- 默认不修改核心配置；需要测速时，在插件面板显式开启启动注入。
- 开启后核心启动前注入 `127.0.0.1:7899` HTTP 测速入站和 `__tcp_speed_test__` selector 策略组。
- 注入的 selector 仅使用 sing-box 官方支持字段，避免核心严格解析失败。
- 注入前会用当前 sing-box 核心执行配置检查，检查失败时跳过注入并保留原配置。
- 测速时通过当前核心 Clash API 切换 `__tcp_speed_test__` 到待测节点，并通过测速入站发起下载请求。
- 修改启动注入开关、测速入口端口、节点订阅或节点配置后，需要重启核心让注入配置重新生效。
- 不再启动独立临时核心，也不再尝试旁路当前 TUN；测速结果按当前核心的真实出站链路计算。

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
