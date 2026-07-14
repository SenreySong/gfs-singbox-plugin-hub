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
- 面板默认只展示已经配置中转的节点，减少无关节点干扰。
- 已配置中转以单行展示，左侧为节点，右侧为中转节点。
- 支持通过“新增中转”按钮选择未配置节点并指定中转节点。
- 新增中转时左侧支持多选节点；多选后需要回到外层逐条配置中转节点。
- 可选择节点会过滤到插件明确支持链式代理的出站类型。
- 中转节点不存在时本次启动会跳过对应规则并提示，不会写回清空已保存配置。
- 源节点或中转节点不存在的失效配置会继续在面板显示，并可一键清理。
- 对于当前面板不可见但仍保存在插件文件里的失效配置，也会计入清理按钮。
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
- 同一个节点会加入所有命中的分组，便于为相同节点配置不同出口选择。
- 分组规则只使用策略组 tag，不再维护重复的名称字段。
- 面板使用固定规则头部和分层表单网格，避免列宽错乱与横向滚动。
- 插件下载地址指向不可变版本标签，避免更新元数据后仍命中旧脚本缓存。
- 支持 Other 组收纳未命中分组的节点。
- 可把生成的策略组插入到未隐藏策略组中。
- 会跳过旧版测速插件遗留的内部策略组，避免启动迁移期间误改旧 selector。
- 保存后如果核心正在运行，会触发核心重启。

### 测试版核心配置迁移

文件：

- `plugin-singbox-beta-migrator.js`
- `plugin-singbox-beta-migrator.metadata.json`

功能：

- 在启动核心前处理最终生成配置，用于适配 sing-box 测试版核心的新配置要求。
- 处理 1.14 相关 DNS/TUN/HTTP/ACME 配置迁移。
- 处理 1.14 远程规则集 HTTP client 显式化，并配置共享默认 HTTP client，避免 `download_detour` 和隐式默认 HTTP client 警告。
- 修正 bridge 出站规则里的 `preferred_by`，避免把 `bridge` 类型名误写成出站 tag。
- 支持注入 ICMP bridge 出站和前置 ICMP 路由规则，让 ping 流量直接三层转发。
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
- 开启后核心启动前注入 `127.0.0.1:7899` HTTP 测速入站，为每个节点生成内部认证用户和 `auth_user` 路由规则。
- 不再注入 selector 策略组，测速入口不会出现在 sing-box 策略组列表中；启动时会清理旧版遗留的 `__tcp_speed_test__` selector。
- 注入前会用当前 sing-box 核心执行配置检查，检查失败时跳过注入并保留原配置。
- 延迟测试通过当前核心 Clash API 直接测试待测节点，下载测速通过带认证的本地 HTTP 入站直接路由到同一节点。
- 下载测速使用 GFS 流式文件下载接口，不会把测速文件整体传入 JavaScript 内存；临时文件会在每个节点完成或失败后删除。
- 插件界面的超时继续按毫秒填写，调用 GFS 请求接口时会转换为其要求的秒单位。
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
