const DATA_DIR = 'data/third/singbox-beta-migrator'
const SETTINGS_FILE = DATA_DIR + '/settings.json'
const STATE_FILE = DATA_DIR + '/state.json'

const RUN_MODES = [
  '仅测试版核心,beta_only',
  '总是启用,always',
  '仅预览,preview_only'
]
const DEFAULT_SETTINGS = {
  enabled: true,
  runMode: 'beta_only',
  manualKernelVersion: '',
  notifyOnApply: true,
  recommendationToggles: {
    dnsCache: true,
    cacheFileStoreDns: true,
    directOverride: true,
    dnsResponseMatch: true,
    outboundDomainStrategy: true,
    legacyDnsOutbound: true,
    dnsRuleCompatibility: true,
    remoteRuleSetHttpClient: true,
    remoteRuleSetDefaultHttpClient: true,
    bridgePreferredBy: true,
    inlineAcme: true,
    removedTailscaleHttpClient: true,
    hysteriaDeprecatedFields: false,
    inboundLegacyFields: false
  },
  featureToggles: {
    routeDefaultDomainResolver: true,
    dnsOptimistic: false,
    dnsTimeout: false,
    tunDnsMode: true,
    icmpBridge: true
  },
  featureOptions: {
    tunDnsAddress: '',
    icmpBridgeTag: 'icmp-bridge',
    icmpBridgeInterface: ''
  }
}
const CONVERSION_DEFINITIONS = [
  {
    id: 'legacy-dns-server',
    level: 'force',
    title: '旧 DNS 服务器格式转换',
    description: '把 dns.servers 中只有 address 的旧格式转换为 1.14 新格式。'
  },
  {
    id: 'legacy-rcode-dns-server',
    level: 'force',
    title: '旧 RCode DNS 服务器提示',
    description: 'rcode:// 服务器需要按域名规则迁移为 predefined action，插件只提示不自动改。'
  },
  {
    id: 'outbound-dns-rule',
    level: 'force',
    title: 'outbound DNS 规则迁移',
    description: '把 dns.rules 中的 outbound/server 规则迁移到出站 domain_resolver。'
  },
  {
    id: 'tun-route-address',
    level: 'force',
    title: 'TUN 路由地址字段合并',
    description: '把 inet4/inet6_route_address 与 exclude 字段合并为 route_address / route_exclude_address。'
  },
  {
    id: 'dns-cache',
    level: 'recommend',
    title: '移除 independent_cache',
    description: '1.14 中 DNS 缓存始终按传输分离，建议删除 dns.independent_cache。'
  },
  {
    id: 'cache-file-store-dns',
    level: 'recommend',
    title: 'store_rdrc 改为 store_dns',
    description: '把 experimental.cache_file.store_rdrc 迁移为 store_dns。'
  },
  {
    id: 'direct-override',
    level: 'recommend',
    title: 'direct 出站目标覆盖迁移',
    description: '把 direct 出站的 override_address / override_port 转为 route-options 规则。'
  },
  {
    id: 'dns-response-match',
    level: 'recommend',
    title: 'DNS 响应匹配迁移',
    description: '把旧 DNS 地址筛选规则迁移为 evaluate + match_response。'
  },
  {
    id: 'outbound-domain-strategy',
    level: 'recommend',
    title: '出站 domain_strategy 迁移',
    description: '把出站 domain_strategy 迁移到 domain_resolver.strategy。'
  },
  {
    id: 'legacy-dns-outbound',
    level: 'recommend',
    title: '旧 DNS 出站迁移',
    description: '把 type=dns 出站和对应 route 规则迁移为 hijack-dns。'
  },
  {
    id: 'dns-rule-compatibility',
    level: 'recommend',
    title: 'DNS 规则兼容性修正',
    description: '修正 1.14 中 ip_version/query_type 与旧地址筛选字段混用导致的启动失败。'
  },
  {
    id: 'remote-ruleset-http-client',
    level: 'recommend',
    title: '远程规则集 HTTP 客户端迁移',
    description: '把 rule_set.download_detour 迁移为 1.14 的 http_client。'
  },
  {
    id: 'remote-ruleset-default-http-client',
    level: 'recommend',
    title: '远程规则集默认 HTTP 客户端',
    description: '为远程规则集显式配置 http_clients 与 route.default_http_client，消除 1.14 隐式默认客户端警告。'
  },
  {
    id: 'bridge-preferred-by',
    level: 'recommend',
    title: 'Bridge preferred_by 修正',
    description: '把 bridge 类型名误用修正为实际 bridge 出站 tag，并为 bridge 规则补 preferred_by。'
  },
  {
    id: 'inline-acme',
    level: 'recommend',
    title: '内联 ACME 迁移',
    description: '把 tls.acme 迁移为 tls.certificate_provider。'
  },
  {
    id: 'removed-tailscale-http-client',
    level: 'recommend',
    title: 'Tailscale 已移除字段清理',
    description: '清理 1.14 中已移除的 Tailscale control_http_client。'
  },
  {
    id: 'hysteria-deprecated-fields',
    level: 'recommend',
    title: 'Hysteria 旧 QUIC 参数提示',
    description: '检测 Hysteria v1 旧窗口和 MTU 字段，提示迁移到统一 QUIC 参数。'
  },
  {
    id: 'inbound-legacy-fields',
    level: 'recommend',
    title: '旧入站字段迁移提示',
    description: 'sniff / domain_strategy 等旧入站字段可迁移到规则动作，插件只提示不自动改。'
  }
]
const FEATURE_DEFINITIONS = [
  {
    id: 'route-default-domain-resolver',
    title: '注入默认域名解析器',
    description: '当存在域名类出站且 route.default_domain_resolver 缺失时，按 1.14 新 DNS 处理注入默认解析器。'
  },
  {
    id: 'dns-optimistic',
    title: '注入 optimistic DNS 缓存',
    description: '按 1.14 新功能启用乐观 DNS 缓存；与 disable_cache / disable_expire 冲突时跳过。'
  },
  {
    id: 'dns-timeout',
    title: '注入 DNS 默认超时',
    description: '缺少 dns.timeout 时注入默认 DNS 查询超时。'
  },
  {
    id: 'tun-dns-mode',
    title: '注入 TUN DNS 模式',
    description: '有 TUN 入站时注入 dns_mode=hijack，并补充显式 hijack-dns 路由规则。'
  },
  {
    id: 'icmp-bridge',
    title: '注入 ICMP Bridge 出站',
    description: '有 TUN 入站时注入 bridge 出站和最前置 ICMP 规则，让 ping 流量直接三层转发。'
  }
]

const initState = () => {
  window[Plugin.id] = window[Plugin.id] || {}
  if (!window[Plugin.id].settings) {
    window[Plugin.id].settings = Vue.ref(clone(DEFAULT_SETTINGS))
  }
  if (!window[Plugin.id].preview) {
    window[Plugin.id].preview = Vue.ref(createEmptyReport())
  }
  if (typeof window[Plugin.id].loaded !== 'boolean') {
    window[Plugin.id].loaded = false
  }
  return window[Plugin.id]
}

initState()

const getState = () => initState()

const ensureDataFile = async () => {
  if (!(await Plugins.FileExists('data/third').catch(() => false))) {
    await Plugins.MakeDir('data/third')
  }
  if (!(await Plugins.FileExists(DATA_DIR).catch(() => false))) {
    await Plugins.MakeDir(DATA_DIR)
  }
  if (!(await Plugins.FileExists(SETTINGS_FILE).catch(() => false))) {
    await Plugins.WriteFile(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2))
  }
}

const readSettings = async () => {
  await ensureDataFile()
  const content = await Plugins.ReadFile(SETTINGS_FILE).catch(() => '{}')
  try {
    return normalizeSettings(JSON.parse(content))
  } catch {
    return normalizeSettings(DEFAULT_SETTINGS)
  }
}

const saveSettings = async (settings) => {
  await ensureDataFile()
  await Plugins.WriteFile(SETTINGS_FILE, JSON.stringify(normalizeSettings(settings), null, 2))
}

const readMigrationState = async () => {
  await ensureDataFile()
  if (!(await Plugins.FileExists(STATE_FILE).catch(() => false))) return null
  const content = await Plugins.ReadFile(STATE_FILE).catch(() => '')
  if (!content) return null
  try {
    return JSON.parse(content)
  } catch {
    return null
  }
}

const writeMigrationState = async (state) => {
  await ensureDataFile()
  await Plugins.WriteFile(STATE_FILE, JSON.stringify(state, null, 2))
}

const clearMigrationState = async () => {
  if (await Plugins.FileExists(STATE_FILE).catch(() => false)) {
    await Plugins.RemoveFile(STATE_FILE).catch(() => {})
  }
}

const loadSettings = async () => {
  if (!getState().loaded) {
    getState().settings.value = await readSettings()
    getState().loaded = true
  }
  getState().settings.value = normalizeSettings(getState().settings.value)
  return getState().settings.value
}

const normalizeSettings = (settings) => ({
  enabled: settings?.enabled !== false,
  runMode: normalizeRunMode(settings?.runMode),
  manualKernelVersion: String(settings?.manualKernelVersion || '').trim(),
  notifyOnApply: settings?.notifyOnApply !== false,
  recommendationToggles: {
    ...DEFAULT_SETTINGS.recommendationToggles,
    ...(settings?.recommendationToggles || {})
  },
  featureToggles: {
    ...DEFAULT_SETTINGS.featureToggles,
    ...(settings?.featureToggles || {})
  },
  featureOptions: {
    ...DEFAULT_SETTINGS.featureOptions,
    ...(settings?.featureOptions || {}),
    tunDnsAddress: String(settings?.featureOptions?.tunDnsAddress || '').trim(),
    icmpBridgeTag: String(settings?.featureOptions?.icmpBridgeTag || DEFAULT_SETTINGS.featureOptions.icmpBridgeTag).trim() || DEFAULT_SETTINGS.featureOptions.icmpBridgeTag,
    icmpBridgeInterface: String(settings?.featureOptions?.icmpBridgeInterface || '').trim()
  }
})

const normalizeRunMode = (runMode) => {
  const value = String(runMode || '')
  if (['beta_only', 'always', 'preview_only'].includes(value)) return value
  return DEFAULT_SETTINGS.runMode
}

const onReady = async () => {
  await loadSettings()
}

const onRun = async () => {
  await openManager()
}

const onBeforeCoreStart = async (config) => {
  const settings = await loadSettings()
  const kernelInfo = await getKernelInfo(settings)
  const shouldApply = settings.enabled &&
    settings.runMode !== 'preview_only' &&
    (settings.runMode === 'always' || kernelInfo.isPrerelease)
  if (!shouldApply) {
    return await restoreConfigIfNeeded(config, settings, kernelInfo)
  }

  const originalConfig = clone(config || {})
  const migratedConfig = clone(config || {})
  const report = applyMigrations(migratedConfig, settings, { mutate: true, kernelInfo })
  getState().preview.value = report
  if (report.totalApplied > 0) {
    await writeMigrationState({
      version: Plugin.version || '',
      appliedAt: Date.now(),
      kernel: kernelInfo,
      runMode: settings.runMode,
      originalConfig,
      migratedConfig
    })
  } else {
    await clearMigrationState()
  }
  if (settings.notifyOnApply && report.totalApplied > 0) {
    Plugins.message.info(`测试版核心兼容转换已应用 ${report.totalApplied} 项`)
  }
  return migratedConfig
}

const restoreConfigIfNeeded = async (config, settings, kernelInfo) => {
  const migrationState = await readMigrationState()
  if (migrationState?.migratedConfig && isSameConfig(config, migrationState.migratedConfig)) {
    await clearMigrationState()
    if (settings.notifyOnApply) {
      Plugins.message.info(`测试版核心配置迁移已跳过，已恢复上次迁移前配置：${formatSkipReason(settings, kernelInfo)}`)
    }
    return clone(migrationState.originalConfig || {})
  }
  return config
}

const formatSkipReason = (settings, kernelInfo) => {
  if (!settings.enabled) return '插件已关闭'
  if (settings.runMode === 'preview_only') return '仅预览模式'
  if (settings.runMode === 'beta_only' && !kernelInfo.isPrerelease) {
    return `当前核心不是测试版${kernelInfo.version ? `（${kernelInfo.version}）` : ''}`
  }
  return '当前条件不需要迁移'
}

const isSameConfig = (left, right) => {
  try {
    return JSON.stringify(left || {}) === JSON.stringify(right || {})
  } catch {
    return false
  }
}

const applyMigrations = (config, settings, options = {}) => {
  settings = normalizeSettings(settings)
  const workingConfig = options.mutate ? config : clone(config || {})
  const report = createEmptyReport()
  report.kernel = options.kernelInfo || {
    version: '',
    isPrerelease: false,
    source: ''
  }
  report.enabled = settings.enabled
  report.runMode = settings.runMode

  migrateLegacyDnsServers(workingConfig, report)
  migrateOutboundDnsRules(workingConfig, report)
  migrateTunRouteFields(workingConfig, report)

  if (settings.recommendationToggles.dnsCache) {
    migrateIndependentDnsCache(workingConfig, report)
  } else {
    recordSkipped(report, 'dns-cache')
  }
  if (settings.recommendationToggles.cacheFileStoreDns) {
    migrateStoreRdrc(workingConfig, report)
  } else {
    recordSkipped(report, 'cache-file-store-dns')
  }
  if (settings.recommendationToggles.directOverride) {
    migrateDirectOverrideFields(workingConfig, report)
  } else {
    recordSkipped(report, 'direct-override')
  }
  if (settings.recommendationToggles.outboundDomainStrategy) {
    migrateOutboundDomainStrategy(workingConfig, report)
  } else {
    recordSkipped(report, 'outbound-domain-strategy')
  }
  if (settings.recommendationToggles.legacyDnsOutbound) {
    migrateLegacyDnsOutbound(workingConfig, report)
  } else {
    recordSkipped(report, 'legacy-dns-outbound')
  }
  if (settings.recommendationToggles.dnsResponseMatch) {
    migrateDnsResponseMatching(workingConfig, report)
  } else {
    recordSkipped(report, 'dns-response-match')
  }
  if (settings.recommendationToggles.dnsRuleCompatibility) {
    fixDnsRuleCompatibility(workingConfig, report)
  } else {
    recordSkipped(report, 'dns-rule-compatibility')
  }
  if (settings.recommendationToggles.remoteRuleSetHttpClient) {
    migrateRemoteRuleSetHttpClient(workingConfig, report)
  } else {
    recordSkipped(report, 'remote-ruleset-http-client')
  }
  if (settings.recommendationToggles.remoteRuleSetDefaultHttpClient) {
    migrateRemoteRuleSetDefaultHttpClient(workingConfig, report)
  } else {
    recordSkipped(report, 'remote-ruleset-default-http-client')
  }
  if (settings.recommendationToggles.bridgePreferredBy) {
    migrateBridgePreferredBy(workingConfig, report)
  } else {
    recordSkipped(report, 'bridge-preferred-by')
  }
  if (settings.recommendationToggles.inlineAcme) {
    migrateInlineAcme(workingConfig, report)
  } else {
    recordSkipped(report, 'inline-acme')
  }
  if (settings.recommendationToggles.removedTailscaleHttpClient) {
    removeTailscaleControlHttpClient(workingConfig, report)
  } else {
    recordSkipped(report, 'removed-tailscale-http-client')
  }
  detectHysteriaDeprecatedFields(workingConfig, report, settings)
  detectInboundLegacyFields(workingConfig, report, settings)
  applyFeatureInjections(workingConfig, report, settings)

  report.totalApplied = getAppliedReportItems(report).reduce((total, item) => total + item.count, 0)
  return report
}

const migrateLegacyDnsServers = (config, report) => {
  if (!Array.isArray(config?.dns?.servers)) return
  let count = 0
  for (const server of config.dns.servers) {
    if (!server || typeof server !== 'object') continue
    count += migrateLegacyDnsServerDialFields(server)
    count += migrateLegacyDnsServerOptions(config, server)
    if (server.type || !server.address) continue
    const address = String(server.address)
    const serverType = inferDnsServerType(address)
    if (!serverType) {
      if (/^rcode:\/\//i.test(address)) {
        recordSkipped(report, 'legacy-rcode-dns-server', 1, `${address} 需要迁移为 predefined action`)
      } else {
        recordSkipped(report, 'legacy-dns-server', 1, `无法自动迁移 ${address}`)
      }
      continue
    }
    server.type = serverType
    if (['h3', 'https', 'tcp', 'udp', 'tls', 'quic'].includes(serverType)) {
      Object.assign(server, parseDnsServerAddress(address, serverType))
    } else if (serverType === 'dhcp') {
      const dhcpInterface = parseDhcpInterface(address)
      if (dhcpInterface) server.interface = dhcpInterface
    } else if (serverType === 'fakeip') {
      applyLegacyFakeIpOptions(config, server)
    }
    delete server.address
    count += 1
  }
  recordForce(report, 'legacy-dns-server', count)
}

const migrateLegacyDnsServerDialFields = (server) => {
  let count = 0
  if (server.address_resolver !== undefined && server.domain_resolver === undefined) {
    server.domain_resolver = server.address_resolver
    count += 1
  }
  if (server.address_strategy !== undefined && server.domain_strategy === undefined) {
    server.domain_strategy = server.address_strategy
    count += 1
  }
  delete server.address_resolver
  delete server.address_strategy
  return count
}

const migrateLegacyDnsServerOptions = (config, server) => {
  let count = 0
  if (server.strategy !== undefined) {
    count += moveDnsServerOptionToRules(config, server, 'strategy')
  }
  if (server.client_subnet !== undefined) {
    count += moveDnsServerOptionToRules(config, server, 'client_subnet')
  }
  return count
}

const moveDnsServerOptionToRules = (config, server, key) => {
  const value = server[key]
  delete server[key]
  if (value === undefined) return 0
  if (!server.tag) {
    if (config.dns[key] === undefined) {
      config.dns[key] = value
      return 1
    }
    return 0
  }
  const rules = config.dns.rules || []
  let count = 0
  for (const rule of rules) {
    if (rule?.server !== server.tag || rule[key] !== undefined) continue
    rule[key] = value
    count += 1
  }
  if (count === 0) {
    config.dns.rules = [
      {
        server: server.tag,
        [key]: value
      }
    ].concat(rules)
    count = 1
  }
  return count
}

const inferDnsServerType = (address) => {
  const value = address.trim().toLowerCase()
  if (!value) return ''
  if (value === 'local') return 'local'
  if (value === 'fakeip' || value === 'fake-ip') return 'fakeip'
  if (value.startsWith('https://')) return 'https'
  if (value.startsWith('h3://')) return 'h3'
  if (value.startsWith('dhcp://')) return 'dhcp'
  if (value.startsWith('rcode://')) return ''
  if (value.startsWith('tls://')) return 'tls'
  if (value.startsWith('quic://')) return 'quic'
  if (value.startsWith('tcp://')) return 'tcp'
  if (value.startsWith('udp://')) return 'udp'
  if (isIpLikeHost(value)) return 'udp'
  return ''
}

const parseDnsServerAddress = (address, serverType) => {
  const value = String(address || '').trim()
  if (!value) return {}
  if (!value.includes('://')) return {
    server: value
  }
  try {
    const url = new URL(value)
    const parsed = {
      server: url.hostname
    }
    if (url.port) parsed.server_port = Number(url.port)
    if (['https', 'h3'].includes(serverType) && url.pathname && url.pathname !== '/') {
      parsed.path = url.pathname
    }
    return parsed
  } catch {
    return {
      server: value.replace(/^[a-z0-9+.-]+:\/\//i, '')
    }
  }
}

const parseDhcpInterface = (address) => {
  const value = String(address || '').replace(/^dhcp:\/\//i, '').trim()
  return value && value !== 'auto' ? value : ''
}

const applyLegacyFakeIpOptions = (config, server) => {
  const fakeip = config?.dns?.fakeip
  if (!fakeip || typeof fakeip !== 'object') return
  if (server.inet4_range === undefined && fakeip.inet4_range !== undefined) {
    server.inet4_range = fakeip.inet4_range
  }
  if (server.inet6_range === undefined && fakeip.inet6_range !== undefined) {
    server.inet6_range = fakeip.inet6_range
  }
  delete config.dns.fakeip
}

const migrateOutboundDnsRules = (config, report) => {
  if (!Array.isArray(config?.dns?.rules)) return
  const rules = config.dns.rules
  const remainingRules = []
  let count = 0
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object' || !rule.outbound || !rule.server) {
      remainingRules.push(rule)
      continue
    }
    if (!isPureOutboundDnsRule(rule)) {
      remainingRules.push(rule)
      recordSkipped(report, 'outbound-dns-rule', 1, '复杂 outbound DNS 规则需要手动迁移。')
      continue
    }
    const resolver = buildDomainResolverFromDnsRule(rule)
    const outboundTags = expandOutboundRuleTargets(rule.outbound, config)
    if (outboundTags.length === 0) {
      if (!config.route) config.route = {}
      if (!config.route.default_domain_resolver) {
        config.route.default_domain_resolver = resolver
        count += 1
      }
      continue
    }
    let applied = 0
    for (const outbound of config.outbounds || []) {
      if (!outboundTags.includes(outbound.tag)) continue
      if (outbound.domain_resolver) continue
      outbound.domain_resolver = clone(resolver)
      applied += 1
    }
    count += applied
  }
  config.dns.rules = remainingRules
  recordForce(report, 'outbound-dns-rule', count)
}

const isPureOutboundDnsRule = (rule) => {
  const allowedKeys = new Set([
    'outbound',
    'server',
    'rewrite_ttl',
    'client_subnet',
    'disable_cache',
    'strategy',
    'timeout'
  ])
  return Object.keys(rule).every((key) => allowedKeys.has(key))
}

const buildDomainResolverFromDnsRule = (rule) => {
  const resolver = {
    server: rule.server
  }
  for (const key of ['rewrite_ttl', 'client_subnet', 'disable_cache', 'strategy', 'timeout']) {
    if (rule[key] !== undefined) resolver[key] = rule[key]
  }
  return Object.keys(resolver).length === 1 ? resolver.server : resolver
}

const expandOutboundRuleTargets = (outboundRule, config) => {
  const values = Array.isArray(outboundRule) ? outboundRule : [outboundRule]
  if (values.includes('any')) {
    return (config.outbounds || []).map((outbound) => outbound.tag).filter(Boolean)
  }
  return values.map((value) => String(value || '')).filter(Boolean)
}

const migrateTunRouteFields = (config, report) => {
  if (!Array.isArray(config?.inbounds)) return
  let count = 0
  for (const inbound of config.inbounds) {
    if (!inbound || inbound.type !== 'tun') continue
    count += mergeArrayField(inbound, 'route_address', ['inet4_route_address', 'inet6_route_address'])
    count += mergeArrayField(inbound, 'route_exclude_address', ['inet4_route_exclude_address', 'inet6_route_exclude_address'])
  }
  recordForce(report, 'tun-route-address', count)
}

const mergeArrayField = (target, nextKey, oldKeys) => {
  const values = []
  for (const key of oldKeys) {
    values.push(...toArray(target[key]))
  }
  if (values.length === 0) return 0
  target[nextKey] = unique(toArray(target[nextKey]).concat(values))
  oldKeys.forEach((key) => delete target[key])
  return 1
}

const migrateIndependentDnsCache = (config, report) => {
  if (!config?.dns || config.dns.independent_cache === undefined) return
  delete config.dns.independent_cache
  recordRecommend(report, 'dns-cache', 1)
}

const migrateStoreRdrc = (config, report) => {
  const cacheFile = config?.experimental?.cache_file
  if (!cacheFile || typeof cacheFile !== 'object' || cacheFile.store_rdrc === undefined) return
  if (cacheFile.store_dns === undefined) {
    cacheFile.store_dns = cacheFile.store_rdrc
  }
  delete cacheFile.store_rdrc
  recordRecommend(report, 'cache-file-store-dns', 1)
}

const migrateDirectOverrideFields = (config, report) => {
  if (!Array.isArray(config?.outbounds)) return
  let count = 0
  const routeRules = []
  for (const outbound of config.outbounds) {
    if (!outbound || outbound.type !== 'direct') continue
    if (outbound.override_address === undefined && outbound.override_port === undefined) continue
    const routeRule = {
      action: 'route-options'
    }
    if (outbound.tag) routeRule.outbound = outbound.tag
    if (outbound.override_address !== undefined) routeRule.override_address = outbound.override_address
    if (outbound.override_port !== undefined) routeRule.override_port = outbound.override_port
    routeRules.push(routeRule)
    delete outbound.override_address
    delete outbound.override_port
    count += 1
  }
  if (routeRules.length > 0) {
    if (!config.route) config.route = {}
    config.route.rules = routeRules.concat(config.route.rules || [])
  }
  recordRecommend(report, 'direct-override', count)
}

const migrateOutboundDomainStrategy = (config, report) => {
  if (!Array.isArray(config?.outbounds)) return
  let count = 0
  const defaultResolver = findDefaultDomainResolver(config)
  for (const outbound of config.outbounds) {
    if (!outbound || outbound.domain_strategy === undefined) continue
    const strategy = outbound.domain_strategy
    if (outbound.domain_resolver === undefined) {
      outbound.domain_resolver = defaultResolver !== undefined
        ? {
            server: defaultResolver,
            strategy
          }
        : {
            strategy
          }
    } else if (typeof outbound.domain_resolver === 'string') {
      outbound.domain_resolver = {
        server: outbound.domain_resolver,
        strategy
      }
    } else if (outbound.domain_resolver && typeof outbound.domain_resolver === 'object' && outbound.domain_resolver.strategy === undefined) {
      outbound.domain_resolver.strategy = strategy
    }
    delete outbound.domain_strategy
    count += 1
  }
  recordRecommend(report, 'outbound-domain-strategy', count)
}

const migrateLegacyDnsOutbound = (config, report) => {
  if (!Array.isArray(config?.outbounds)) return
  const dnsOutboundTags = config.outbounds
    .filter((outbound) => outbound?.type === 'dns' && outbound.tag)
    .map((outbound) => outbound.tag)
  if (dnsOutboundTags.length === 0) return

  config.outbounds = config.outbounds.filter((outbound) => outbound?.type !== 'dns')
  if (!config.route) config.route = {}
  const routeRules = config.route.rules || []
  let convertedRules = 0
  for (const rule of routeRules) {
    if (!rule || typeof rule !== 'object') continue
    if (dnsOutboundTags.includes(rule.outbound) && isDnsHijackRule(rule)) {
      delete rule.outbound
      rule.action = 'hijack-dns'
      convertedRules += 1
    }
  }
  if (convertedRules === 0) {
    config.route.rules = [
      {
        protocol: 'dns',
        action: 'hijack-dns'
      }
    ].concat(routeRules)
    convertedRules = 1
  }
  recordRecommend(report, 'legacy-dns-outbound', dnsOutboundTags.length + convertedRules)
}

const isDnsHijackRule = (rule) => {
  if (rule.protocol === 'dns') return true
  if (rule.port === 53 || rule.port === '53') return true
  if (Array.isArray(rule.port) && rule.port.map(String).includes('53')) return true
  return false
}

const migrateDnsResponseMatching = (config, report) => {
  const rules = config?.dns?.rules || []
  if (!Array.isArray(rules) || rules.length === 0) return
  let count = 0
  let evaluateInserted = false
  let insertedServer = ''
  const nextRules = []
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index]
    if (!needsDnsResponseMatching(rule)) {
      nextRules.push(rule)
      continue
    }
    const evaluateServer = findDnsEvaluateServer(rules, index, config)
    if (!evaluateServer) {
      nextRules.push(rule)
      recordSkipped(report, 'dns-response-match', 1, '未找到可用于 evaluate 的 DNS 服务器')
      continue
    }
    if (!evaluateInserted && evaluateServer) {
      nextRules.push({
        action: 'evaluate',
        server: evaluateServer
      })
      evaluateInserted = true
      insertedServer = evaluateServer
    }
    rule.match_response = true
    delete rule.rule_set_ip_cidr_accept_empty
    nextRules.push(rule)
    count += 1
  }
  config.dns.rules = nextRules
  recordRecommend(report, 'dns-response-match', count, evaluateInserted ? `已插入 evaluate 到 ${insertedServer}` : '已补充 match_response')
}

const needsDnsResponseMatching = (rule) => {
  if (!rule || typeof rule !== 'object' || rule.match_response) return false
  return rule.ip_cidr !== undefined ||
    rule.ip_is_private !== undefined ||
    rule.rule_set_ip_cidr_accept_empty !== undefined
}

const findDnsEvaluateServer = (rules, currentIndex, config) => {
  for (let index = currentIndex + 1; index < rules.length; index += 1) {
    const rule = rules[index]
    if (rule?.server) return rule.server
  }
  if (config?.dns?.final) return config.dns.final
  const firstTaggedServer = (config?.dns?.servers || []).find((server) => server?.tag)
  return firstTaggedServer?.tag || ''
}

const fixDnsRuleCompatibility = (config, report) => {
  if (!Array.isArray(config?.dns?.rules)) return
  migrateDnsResponseMatching(config, report)
  const rules = config.dns.rules || []
  let count = 0
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') continue
    if ((rule.ip_version !== undefined || rule.query_type !== undefined) && rule.strategy !== undefined && rule.action === undefined) {
      rule.action = 'route'
      count += 1
    }
  }
  recordRecommend(report, 'dns-rule-compatibility', count)
}

const migrateRemoteRuleSetHttpClient = (config, report) => {
  const ruleSets = config?.route?.rule_set || []
  if (!Array.isArray(ruleSets)) return
  let count = 0
  for (const ruleSet of ruleSets) {
    if (!ruleSet || typeof ruleSet !== 'object') continue
    if (ruleSet.download_detour === undefined) continue
    if (ruleSet.http_client === undefined) {
      ruleSet.http_client = {
        detour: ruleSet.download_detour
      }
      count += 1
    } else {
      recordSkipped(report, 'remote-ruleset-http-client', 1, `${ruleSet.tag || '未命名规则集'} 已存在 http_client`)
    }
    delete ruleSet.download_detour
  }
  recordRecommend(report, 'remote-ruleset-http-client', count)
}

const migrateRemoteRuleSetDefaultHttpClient = (config, report) => {
  const remoteRuleSets = (config?.route?.rule_set || []).filter((ruleSet) => {
    return ruleSet && typeof ruleSet === 'object' && ruleSet.type === 'remote' && ruleSet.url
  })
  if (remoteRuleSets.length === 0) return
  if (!config.route) config.route = {}
  if (config.route.default_http_client) return

  const existingTag = findFirstHttpClientTag(config)
  const tag = existingTag || nextAvailableTag(config, 'rule-set-http-client')
  let count = 0
  if (!existingTag) {
    config.http_clients = Array.isArray(config.http_clients) ? config.http_clients : []
    const client = {
      ...buildDefaultRuleSetHttpClient(config, remoteRuleSets),
      tag
    }
    config.http_clients.push(client)
    count += 1
  }
  config.route.default_http_client = tag
  count += 1
  const client = findHttpClientByTag(config, tag)
  const note = client?.detour ? `使用 ${client.detour}` : `使用 ${tag}`
  recordRecommend(report, 'remote-ruleset-default-http-client', count, note)
}

const buildDefaultRuleSetHttpClient = (config, remoteRuleSets) => {
  for (const ruleSet of remoteRuleSets) {
    if (ruleSet?.http_client && typeof ruleSet.http_client === 'object') {
      return clone(ruleSet.http_client)
    }
  }
  const finalOutbound = typeof config?.route?.final === 'string' ? config.route.final : ''
  if (finalOutbound) return { detour: finalOutbound }
  const directOutbound = (config?.outbounds || []).find((outbound) => outbound?.type === 'direct' && outbound.tag)
  if (directOutbound?.tag) return { detour: directOutbound.tag }
  return {}
}

const migrateBridgePreferredBy = (config, report) => {
  const rules = config?.route?.rules || []
  if (!Array.isArray(rules) || rules.length === 0) return
  const bridgeTags = getBridgeOutboundTags(config)
  if (bridgeTags.length === 0) return
  let count = 0
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') continue
    const outbound = typeof rule.outbound === 'string' ? rule.outbound : ''
    const preferredBy = rule.preferred_by === undefined ? [] : toArray(rule.preferred_by).map(String)
    let nextPreferredBy = preferredBy.slice()
    let changed = false

    if (nextPreferredBy.includes('bridge') && !hasOutboundTag(config, 'bridge')) {
      const replacement = outbound && bridgeTags.includes(outbound)
        ? outbound
        : bridgeTags.length === 1 ? bridgeTags[0] : ''
      if (replacement) {
        nextPreferredBy = nextPreferredBy.map((value) => value === 'bridge' ? replacement : value)
        changed = true
      } else {
        recordSkipped(report, 'bridge-preferred-by', 1, '存在多个 bridge 出站，无法判断 preferred_by 应指向哪个 tag。')
      }
    }

    if (outbound && bridgeTags.includes(outbound) && !nextPreferredBy.includes(outbound)) {
      nextPreferredBy.push(outbound)
      changed = true
    }

    if (!changed) continue
    rule.preferred_by = unique(nextPreferredBy)
    count += 1
  }
  recordRecommend(report, 'bridge-preferred-by', count)
}

const migrateInlineAcme = (config, report) => {
  let count = 0
  for (const holder of collectObjects(config)) {
    const tls = holder?.tls
    if (!tls || typeof tls !== 'object' || tls.acme === undefined) continue
    if (tls.certificate_provider === undefined) {
      tls.certificate_provider = {
        type: 'acme',
        ...clone(tls.acme)
      }
      count += 1
    } else {
      recordSkipped(report, 'inline-acme', 1, '已存在 certificate_provider')
    }
    delete tls.acme
  }
  recordRecommend(report, 'inline-acme', count)
}

const removeTailscaleControlHttpClient = (config, report) => {
  let count = 0
  for (const holder of collectObjects(config)) {
    if (!holder || typeof holder !== 'object') continue
    if (holder.control_http_client === undefined) continue
    if (!isTailscaleRelatedObject(holder)) continue
    delete holder.control_http_client
    count += 1
  }
  recordRecommend(report, 'removed-tailscale-http-client', count)
}

const isTailscaleRelatedObject = (value) => {
  return value.type === 'tailscale' ||
    value.endpoint === 'tailscale' ||
    value.tailnet !== undefined ||
    value.control_url !== undefined ||
    value.accept_routes !== undefined ||
    value.exit_node !== undefined
}

const detectHysteriaDeprecatedFields = (config, report, settings) => {
  const outbounds = config?.outbounds || []
  const inbounds = config?.inbounds || []
  const deprecatedKeys = ['recv_window_conn', 'recv_window', 'recv_window_client', 'max_conn_client', 'disable_mtu_discovery']
  const count = outbounds.concat(inbounds).filter((item) => {
    if (!item || item.type !== 'hysteria') return false
    return deprecatedKeys.some((key) => item[key] !== undefined)
  }).length
  if (count === 0) return
  if (settings.recommendationToggles.hysteriaDeprecatedFields) {
    recordRecommend(report, 'hysteria-deprecated-fields', count, '需要按带宽和 QUIC 参数语义手动迁移。')
  } else {
    recordSkipped(report, 'hysteria-deprecated-fields', count)
  }
}

const detectInboundLegacyFields = (config, report, settings) => {
  const inbounds = config?.inbounds || []
  const legacyKeys = ['sniff', 'sniff_override_destination', 'domain_strategy']
  const count = inbounds.filter((inbound) => legacyKeys.some((key) => inbound?.[key] !== undefined)).length
  if (count === 0) return
  if (settings.recommendationToggles.inboundLegacyFields) {
    recordRecommend(report, 'inbound-legacy-fields', count, '需要按入站语义手动迁移到 route/dns 规则动作。')
  } else {
    recordSkipped(report, 'inbound-legacy-fields', count)
  }
}

const applyFeatureInjections = (config, report, settings) => {
  settings = normalizeSettings(settings)
  if (settings.featureToggles.routeDefaultDomainResolver) {
    injectRouteDefaultDomainResolver(config, report)
  } else {
    recordSkipped(report, 'route-default-domain-resolver')
  }
  if (settings.featureToggles.dnsOptimistic) {
    injectDnsOptimistic(config, report)
  } else {
    recordSkipped(report, 'dns-optimistic')
  }
  if (settings.featureToggles.dnsTimeout) {
    injectDnsTimeout(config, report)
  } else {
    recordSkipped(report, 'dns-timeout')
  }
  if (settings.featureToggles.tunDnsMode) {
    injectTunDnsMode(config, report, settings)
  } else {
    recordSkipped(report, 'tun-dns-mode')
  }
  if (settings.featureToggles.icmpBridge) {
    injectIcmpBridge(config, report, settings)
  } else {
    recordSkipped(report, 'icmp-bridge')
  }
}

const injectRouteDefaultDomainResolver = (config, report) => {
  if (!hasDomainOutboundWithoutResolver(config)) return
  if (!config.route) config.route = {}
  if (config.route.default_domain_resolver !== undefined) return

  const resolver = findDefaultDomainResolver(config)
  if (resolver === undefined) return
  config.route.default_domain_resolver = resolver
  recordInjected(report, 'route-default-domain-resolver', 1, `使用 ${formatResolverLabel(resolver)}`)
}

const hasDomainOutboundWithoutResolver = (config) => {
  return (config?.outbounds || []).some((outbound) => {
    if (!outbound || typeof outbound !== 'object') return false
    if (outbound.domain_resolver !== undefined) return false
    return isDomainHost(outbound.server) || isDomainHost(outbound.address)
  })
}

const findDefaultDomainResolver = (config) => {
  if (config?.dns?.final) return config.dns.final
  const servers = config?.dns?.servers || []
  const taggedServers = servers
    .map((server) => server?.tag)
    .filter((tag) => typeof tag === 'string' && tag.trim())
  if (taggedServers.length === 1) return taggedServers[0]
  return undefined
}

const formatResolverLabel = (resolver) => {
  if (typeof resolver === 'string') return resolver
  if (resolver && typeof resolver === 'object' && resolver.server) return resolver.server
  return '默认解析器'
}

const injectDnsOptimistic = (config, report) => {
  if (!config?.dns) return
  if (config.dns.optimistic !== undefined) return
  if (config.dns.disable_cache || config.dns.disable_expire) {
    recordSkipped(report, 'dns-optimistic', 1, 'disable_cache / disable_expire 冲突')
    return
  }
  config.dns.optimistic = {
    enabled: true,
    timeout: '3d'
  }
  recordInjected(report, 'dns-optimistic', 1)
}

const injectDnsTimeout = (config, report) => {
  if (!config?.dns) return
  if (config.dns.timeout !== undefined) return
  config.dns.timeout = '10s'
  recordInjected(report, 'dns-timeout', 1)
}

const injectTunDnsMode = (config, report, settings) => {
  const tunInbounds = (config?.inbounds || []).filter((inbound) => inbound?.type === 'tun')
  if (tunInbounds.length === 0) return
  let count = 0
  const dnsAddress = settings.featureOptions?.tunDnsAddress
  for (const inbound of tunInbounds) {
    if (inbound.dns_mode === undefined) {
      inbound.dns_mode = 'hijack'
      count += 1
    }
    if (dnsAddress && inbound.dns_address === undefined) {
      inbound.dns_address = splitCsv(dnsAddress)
      count += 1
    }
  }
  count += ensureDnsHijackRouteRule(config)
  recordInjected(report, 'tun-dns-mode', count)
}

const ensureDnsHijackRouteRule = (config) => {
  if (!config.route) config.route = {}
  const rules = config.route.rules || []
  if (rules.some((rule) => rule?.action === 'hijack-dns')) return 0
  config.route.rules = [
    {
      protocol: 'dns',
      action: 'hijack-dns'
    }
  ].concat(rules)
  return 1
}

const injectIcmpBridge = (config, report, settings) => {
  const tunInbounds = (config?.inbounds || []).filter((inbound) => inbound?.type === 'tun')
  if (tunInbounds.length === 0) return
  if (!isIcmpBridgeSupported(report?.kernel?.version)) {
    recordSkipped(report, 'icmp-bridge', 1, `当前核心 ${report?.kernel?.version || '未知'} 可能不支持 bridge preferred_by。`)
    return
  }

  config.outbounds = Array.isArray(config.outbounds) ? config.outbounds : []
  const bridgeTag = settings.featureOptions?.icmpBridgeTag || DEFAULT_SETTINGS.featureOptions.icmpBridgeTag
  const bridgeInterface = settings.featureOptions?.icmpBridgeInterface || ''
  const existingOutbound = config.outbounds.find((outbound) => outbound?.tag === bridgeTag)
  let count = 0
  if (existingOutbound && existingOutbound.type !== 'bridge') {
    recordSkipped(report, 'icmp-bridge', 1, `${bridgeTag} 已被 ${existingOutbound.type || '未知'} 出站占用。`)
    return
  }
  if (existingOutbound) {
    if (bridgeInterface && existingOutbound.interface !== bridgeInterface) {
      existingOutbound.interface = bridgeInterface
      count += 1
    }
  } else {
    const bridgeOutbound = {
      type: 'bridge',
      tag: bridgeTag
    }
    if (bridgeInterface) bridgeOutbound.interface = bridgeInterface
    config.outbounds.unshift(bridgeOutbound)
    count += 1
  }

  if (!config.route) config.route = {}
  const rules = Array.isArray(config.route.rules) ? config.route.rules : []
  const nextRules = rules.filter((rule) => !isIcmpBridgeRule(rule, bridgeTag))
  const firstRule = rules[0]
  if (!isIcmpBridgeRule(firstRule, bridgeTag) || nextRules.length !== rules.length - 1) {
    config.route.rules = [buildIcmpBridgeRule(bridgeTag)].concat(nextRules)
    count += 1
  } else if (!isPreferredByTag(firstRule.preferred_by, bridgeTag)) {
    firstRule.preferred_by = [bridgeTag]
    count += 1
  }
  recordInjected(report, 'icmp-bridge', count, bridgeInterface ? `网卡 ${bridgeInterface}` : `出站 ${bridgeTag}`)
}

const buildIcmpBridgeRule = (bridgeTag) => ({
  network: 'icmp',
  preferred_by: [bridgeTag],
  action: 'route',
  outbound: bridgeTag
})

const isIcmpBridgeRule = (rule, bridgeTag) => {
  if (!rule || typeof rule !== 'object') return false
  if (rule.outbound !== bridgeTag) return false
  return toArray(rule.network).includes('icmp')
}

const openManager = async () => {
  const { ref, h } = Vue
  const settings = ref(normalizeSettings(await loadSettings()))
  const preview = ref(await buildPreview(settings.value))
  const runtimeConfig = ref(await loadRuntimeConfigText())

  const component = {
    template: `
    <div class="flex flex-col gap-10 pr-8">
      <div class="flex items-center justify-between gap-8">
        <div class="min-w-0">
          <div class="font-bold text-16">测试版核心配置迁移 <span class="text-12 opacity-70">{{ pluginVersion }}</span></div>
          <div class="text-12 opacity-70 truncate" :title="summaryText">{{ summaryText }}</div>
        </div>
        <div class="flex gap-8">
          <Button @click="refreshPreview">刷新预览</Button>
          <Button @click="refreshRuntimeConfig">刷新运行配置</Button>
          <Button type="primary" @click="save">保存</Button>
        </div>
      </div>

      <Card>
        <div class="grid items-center gap-8" style="grid-template-columns: 140px minmax(180px, 1fr) 140px minmax(160px, 1fr);">
          <div class="font-bold text-13">启用插件</div>
          <Switch v-model="settings.enabled">启用</Switch>
          <div class="font-bold text-13">运行模式</div>
          <select v-model="settings.runMode" class="gfs-native-input">
            <option v-for="option in runModes" :key="getOptionValue(option)" :value="getOptionValue(option)">
              {{ getOptionLabel(option) }}
            </option>
          </select>
          <div class="font-bold text-13">应用时通知</div>
          <Switch v-model="settings.notifyOnApply">启用</Switch>
          <div class="font-bold text-13">检测到的核心</div>
          <div class="text-12 opacity-75" style="word-break: break-word;">{{ kernelText }}</div>
          <div class="font-bold text-13">手动核心版本</div>
          <Input v-model="settings.manualKernelVersion" placeholder="例如 1.14.0-alpha.33，可空" allow-paste />
          <div class="font-bold text-13">检测来源</div>
          <div class="text-12 opacity-75" style="word-break: break-word;">{{ kernelSourceText }}</div>
        </div>
      </Card>

      <Card>
        <div class="font-bold text-14 mb-8">强制类转换</div>
        <div class="grid gap-8" style="grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));">
          <div v-for="item in forceItems" :key="item.id" class="rounded-4 p-8" style="border: 1px solid #cbd5e1; background: #f8fafc;">
            <div class="font-bold text-13">{{ item.title }}</div>
            <div class="text-12 opacity-75 mt-4">{{ item.description }}</div>
            <div class="text-12 mt-6" style="color: #166534;">预览命中 {{ getReportCount(item.id) }} 项</div>
          </div>
        </div>
      </Card>

      <Card>
        <div class="font-bold text-14 mb-8">推荐类转换</div>
        <div class="grid gap-8" style="grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));">
          <div v-for="item in recommendItems" :key="item.id" class="rounded-4 p-8" style="border: 1px solid #cbd5e1; background: #f8fafc;">
            <div class="flex items-start justify-between gap-8">
              <div class="min-w-0">
                <div class="font-bold text-13">{{ item.title }}</div>
                <div class="text-12 opacity-75 mt-4">{{ item.description }}</div>
              </div>
              <Switch v-model="settings.recommendationToggles[item.toggleKey]">启用</Switch>
            </div>
            <div class="text-12 mt-6" style="color: #166534;">预览命中 {{ getReportCount(item.id) }} 项</div>
          </div>
        </div>
      </Card>

      <Card>
        <div class="font-bold text-14 mb-8">功能注入</div>
        <div class="grid items-center gap-8 mb-8" style="grid-template-columns: 150px minmax(220px, 1fr);">
          <div class="font-bold text-13">TUN DNS 地址</div>
          <Input v-model="settings.featureOptions.tunDnsAddress" placeholder="例如 172.18.0.2,fdfe:dcba:9876::2，可空" allow-paste />
          <div class="font-bold text-13">ICMP Bridge Tag</div>
          <Input v-model="settings.featureOptions.icmpBridgeTag" placeholder="默认 icmp-bridge" allow-paste />
          <div class="font-bold text-13">ICMP Bridge 网卡</div>
          <Input v-model="settings.featureOptions.icmpBridgeInterface" placeholder="可空；例如 en0，留空则由核心选择默认接口" allow-paste />
        </div>
        <div class="grid gap-8" style="grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));">
          <div v-for="item in featureItems" :key="item.id" class="rounded-4 p-8" style="border: 1px solid #cbd5e1; background: #f8fafc;">
            <div class="flex items-start justify-between gap-8">
              <div class="min-w-0">
                <div class="font-bold text-13">{{ item.title }}</div>
                <div class="text-12 opacity-75 mt-4">{{ item.description }}</div>
              </div>
              <Switch v-model="settings.featureToggles[item.toggleKey]">启用</Switch>
            </div>
            <div class="text-12 mt-6" style="color: #166534;">预览命中 {{ getReportCount(item.id) }} 项</div>
          </div>
        </div>
      </Card>

      <Card>
        <div class="font-bold text-14 mb-8">最近预览结果</div>
        <div class="grid gap-8" style="grid-template-columns: 1fr 1fr;">
          <div>
            <div class="font-bold text-13 mb-4">已转换</div>
            <div v-for="item in appliedReportItems" :key="item.id" class="text-12 leading-6">
              {{ item.title }}：{{ item.count }} 项<span v-if="item.note">，{{ item.note }}</span>
            </div>
            <div v-if="appliedReportItems.length === 0" class="text-12 opacity-70">无</div>
          </div>
          <div>
            <div class="font-bold text-13 mb-4">跳过 / 需要手动处理</div>
            <div v-for="item in skippedReportItems" :key="item.id" class="text-12 leading-6">
              {{ item.title }}：{{ item.count }} 项
            </div>
            <div v-if="skippedReportItems.length === 0" class="text-12 opacity-70">无</div>
          </div>
        </div>
      </Card>

      <Card>
        <div class="flex items-center justify-between gap-8 mb-8">
          <div>
            <div class="font-bold text-14">运行中完整配置</div>
            <div class="text-12 opacity-70">{{ runtimeConfig.statusText }}</div>
          </div>
          <Button @click="refreshRuntimeConfig">刷新</Button>
        </div>
        <textarea
          v-model="runtimeConfig.content"
          readonly
          class="w-full p-8 rounded border outline-none resize-none font-mono text-12 box-border"
          style="height: 360px; background: transparent; color: inherit; border-color: var(--el-border-color); box-sizing: border-box; line-height: 1.45;"
        ></textarea>
      </Card>
    </div>
    `,
    setup() {
      const getOptionLabel = (option) => String(option).split(',')[0]
      const getOptionValue = (option) => String(option).split(',')[1]
      const refreshPreview = async () => {
        preview.value = await buildPreview(settings.value)
        getState().preview.value = preview.value
      }
      const refreshRuntimeConfig = async () => {
        runtimeConfig.value = await loadRuntimeConfigText()
      }
      const save = async () => {
        const normalized = normalizeSettings(settings.value)
        getState().settings.value = normalized
        await saveSettings(normalized)
        preview.value = await buildPreview(normalized)
        getState().preview.value = preview.value
        Plugins.message.success('测试版核心配置迁移设置已保存')
        modal.close()
      }

      return {
        pluginVersion: Plugin.version || '',
        settings,
        preview,
        runtimeConfig,
        runModes: RUN_MODES,
        forceItems: CONVERSION_DEFINITIONS.filter((item) => item.level === 'force'),
        recommendItems: CONVERSION_DEFINITIONS.filter((item) => item.level === 'recommend').map((item) => ({
          ...item,
          toggleKey: getToggleKey(item.id)
        })),
        featureItems: FEATURE_DEFINITIONS.map((item) => ({
          ...item,
          toggleKey: getToggleKey(item.id)
        })),
        summaryText: Vue.computed(() => `预览配置：${preview.value.profileName || '未找到'}，命中 ${preview.value.totalDetected || 0} 项`),
        kernelText: Vue.computed(() => preview.value.kernel.version || '未检测到核心版本'),
        kernelSourceText: Vue.computed(() => preview.value.kernel.source || '无'),
        appliedReportItems: Vue.computed(() => getAppliedReportItems(preview.value)),
        skippedReportItems: Vue.computed(() => preview.value.skipped),
        getReportCount: (id) => getReportCount(preview.value, id),
        getOptionLabel,
        getOptionValue,
        refreshPreview,
        refreshRuntimeConfig,
        save
      }
    }
  }

  const modal = Plugins.modal(
    {
      title: '测试版核心配置迁移',
      submit: false,
      width: '82',
      height: '78',
      cancelText: '关闭',
      afterClose() {
        modal.destroy()
      }
    },
    {
      default: () => h(component)
    }
  )
  modal.open()
}

const buildPreview = async (settings) => {
  const profile = getCurrentProfile()
  if (!profile) {
    return createEmptyReport()
  }
  const generatedConfig = await Plugins.generateConfig(profile, { enablePluginProcessing: false }).catch(() => null)
  const normalizedSettings = normalizeSettings(settings)
  const kernelInfo = await getKernelInfo(normalizedSettings)
  const report = applyMigrations(generatedConfig || {}, normalizedSettings, { mutate: false, kernelInfo })
  report.profileName = profile.name || ''
  report.totalDetected = getAppliedReportItems(report).concat(report.skipped).reduce((total, item) => total + item.count, 0)
  return report
}

const loadRuntimeConfigText = async () => {
  const kernelApiStore = Plugins.useKernelApiStore()
  if (!kernelApiStore.running) {
    return {
      statusText: '核心未运行，启动核心后可查看插件处理后的完整配置。',
      content: ''
    }
  }
  const content = await Plugins.ReadFile('data/sing-box/config.json').catch((error) => {
    return {
      error: error?.message || String(error)
    }
  })
  if (content?.error) {
    return {
      statusText: '读取运行配置失败。',
      content: content.error
    }
  }
  return {
    statusText: '读取自 data/sing-box/config.json，这是核心当前使用的运行时配置。',
    content: formatRuntimeConfigText(content)
  }
}

const formatRuntimeConfigText = (content) => {
  try {
    return JSON.stringify(JSON.parse(content), null, 2)
  } catch {
    return String(content || '')
  }
}

const getCurrentProfile = () => {
  const profilesStore = Plugins.useProfilesStore()
  const appSettingsStore = Plugins.useAppSettingsStore()
  const profiles = profilesStore.profiles || []
  const currentProfileId = appSettingsStore.app?.kernel?.profile
  return profiles.find((profile) => profile.id === currentProfileId) || profilesStore.currentProfile || profiles[0]
}

const getKernelInfo = async (settings = {}) => {
  const manualVersion = String(settings.manualKernelVersion || '').trim()
  if (manualVersion) {
    return {
      version: manualVersion,
      isPrerelease: isPrereleaseVersion(manualVersion),
      source: '手动填写'
    }
  }

  const realVersion = await getKernelVersionByExec()
  if (realVersion) {
    return {
      version: realVersion,
      isPrerelease: isPrereleaseVersion(realVersion),
      source: '核心执行结果'
    }
  }

  const sources = []
  for (const getter of [Plugins.useKernelApiStore, Plugins.useAppSettingsStore, Plugins.useEnvStore]) {
    try {
      sources.push(getter())
    } catch {}
  }
  const matched = findKernelVersionCandidate(sources)
  return {
    version: matched.version,
    isPrerelease: isPrereleaseVersion(matched.version),
    source: matched.source
  }
}

const getKernelVersionByExec = async () => {
  try {
    const appSettingsStore = Plugins.useAppSettingsStore()
    const branch = appSettingsStore.app?.kernel?.branch
    const kernelFileName = await Plugins.getKernelFileName(branch !== 'main')
    const kernelFilePath = await Plugins.AbsolutePath('data/sing-box/' + kernelFileName)
    const output = await Plugins.Exec(kernelFilePath, ['version'])
    return parseSingBoxVersion(output)
  } catch {
    return ''
  }
}

const parseSingBoxVersion = (output) => {
  const firstLine = String(output || '').split('\n')[0] || ''
  const matched = firstLine.match(/(?:sing-box\s+version\s+)?(\d+\.\d+\.\d+(?:[-+][^\s]+)?)/i)
  return matched?.[1] || ''
}

const findKernelVersionCandidate = (values) => {
  const seen = new Set()
  const stack = [].concat(values || []).map((value, index) => ({
    value,
    path: `store${index}`
  }))
  const candidates = []
  while (stack.length > 0 && seen.size < 800) {
    const item = stack.shift()
    const value = item.value
    if (value === null || value === undefined) continue
    if (typeof value === 'string') {
      if (isKernelPath(item.path) && isVersionCandidate(value)) {
        candidates.push({
          version: value,
          source: item.path
        })
      }
      continue
    }
    if (typeof value !== 'object' || seen.has(value)) continue
    seen.add(value)
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${item.path}.${key}`
      if (typeof child === 'string') {
        if (isKernelPath(childPath) && isVersionCandidate(child)) {
          candidates.push({
            version: child,
            source: childPath
          })
        }
        continue
      }
      if (child && typeof child === 'object' && isPotentialKernelPath(childPath)) {
        stack.push({
          value: child,
          path: childPath
        })
      }
    }
  }
  return selectVersionCandidate(candidates)
}

const isKernelPath = (path) => {
  return /(?:kernel|core|sing.?box|singbox)/i.test(path) && /(?:version|name|path|core|kernel|sing.?box|singbox)/i.test(path)
}

const isPotentialKernelPath = (path) => {
  return /(?:^store\d+$|\.app$|\.env$|kernel|core|sing.?box|singbox)/i.test(path)
}

const isPrereleaseVersion = (version) => /(?:alpha|beta|rc|testing|nightly|dev)/i.test(String(version || ''))

const isVersionCandidate = (value) => {
  return /alpha|beta|rc|testing|nightly|dev|\d+\.\d+\.\d+/i.test(String(value || ''))
}

const selectVersionCandidate = (candidates) => {
  const uniqueCandidates = []
  const seen = new Set()
  for (const candidate of candidates) {
    const version = String(candidate.version || '').trim()
    if (!version || seen.has(version)) continue
    seen.add(version)
    uniqueCandidates.push({
      version,
      source: candidate.source || '自动检测'
    })
  }
  return uniqueCandidates.find((candidate) => isPrereleaseVersion(candidate.version)) ||
    uniqueCandidates.find((candidate) => /\d+\.\d+\.\d+/.test(candidate.version)) ||
    uniqueCandidates[0] ||
    {
      version: '',
      source: ''
    }
}

const findFirstHttpClientTag = (config) => {
  return (config?.http_clients || [])
    .map((client) => client?.tag)
    .find((tag) => typeof tag === 'string' && tag.trim()) || ''
}

const findHttpClientByTag = (config, tag) => {
  return (config?.http_clients || []).find((client) => client?.tag === tag)
}

const nextAvailableTag = (config, baseTag) => {
  const used = new Set(
    (config?.http_clients || []).map((client) => client?.tag)
      .concat((config?.outbounds || []).map((outbound) => outbound?.tag))
      .filter(Boolean)
  )
  if (!used.has(baseTag)) return baseTag
  let index = 2
  while (used.has(`${baseTag}-${index}`)) {
    index += 1
  }
  return `${baseTag}-${index}`
}

const hasOutboundTag = (config, tag) => {
  return (config?.outbounds || []).some((outbound) => outbound?.tag === tag)
}

const getBridgeOutboundTags = (config) => {
  return (config?.outbounds || [])
    .filter((outbound) => outbound?.type === 'bridge' && outbound.tag)
    .map((outbound) => outbound.tag)
}

const isPreferredByTag = (preferredBy, tag) => {
  return toArray(preferredBy).map(String).includes(tag)
}

const isIcmpBridgeSupported = (version) => {
  const parsed = parseSingBoxVersionInfo(version)
  if (!parsed) return true
  if (parsed.major > 1) return true
  if (parsed.major < 1) return false
  if (parsed.minor > 14) return true
  if (parsed.minor < 14) return false
  if (parsed.patch > 0) return true
  if (!parsed.preRelease) return true
  if (parsed.preRelease !== 'alpha') return true
  return parsed.preReleaseNumber >= 41
}

const parseSingBoxVersionInfo = (version) => {
  const matched = String(version || '').match(/(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.?(\d+)?)?/i)
  if (!matched) return null
  return {
    major: Number(matched[1]),
    minor: Number(matched[2]),
    patch: Number(matched[3]),
    preRelease: String(matched[4] || '').toLowerCase(),
    preReleaseNumber: Number(matched[5] || 0)
  }
}

const getToggleKey = (id) => ({
  'dns-cache': 'dnsCache',
  'cache-file-store-dns': 'cacheFileStoreDns',
  'direct-override': 'directOverride',
  'dns-response-match': 'dnsResponseMatch',
  'outbound-domain-strategy': 'outboundDomainStrategy',
  'legacy-dns-outbound': 'legacyDnsOutbound',
  'dns-rule-compatibility': 'dnsRuleCompatibility',
  'remote-ruleset-http-client': 'remoteRuleSetHttpClient',
  'remote-ruleset-default-http-client': 'remoteRuleSetDefaultHttpClient',
  'bridge-preferred-by': 'bridgePreferredBy',
  'inline-acme': 'inlineAcme',
  'removed-tailscale-http-client': 'removedTailscaleHttpClient',
  'hysteria-deprecated-fields': 'hysteriaDeprecatedFields',
  'inbound-legacy-fields': 'inboundLegacyFields',
  'route-default-domain-resolver': 'routeDefaultDomainResolver',
  'dns-optimistic': 'dnsOptimistic',
  'dns-timeout': 'dnsTimeout',
  'tun-dns-mode': 'tunDnsMode',
  'icmp-bridge': 'icmpBridge'
})[id]

const getAppliedReportItems = (report) => {
  return toArray(report?.force).concat(toArray(report?.recommend), toArray(report?.inject))
}

const getReportCount = (report, id) => {
  const item = getAppliedReportItems(report)
    .concat(toArray(report?.skipped))
    .find((entry) => entry?.id === id)
  return item?.count || 0
}

const recordForce = (report, id, count, note = '') => recordReportItem(report.force, id, count, note)

const recordRecommend = (report, id, count, note = '') => recordReportItem(report.recommend, id, count, note)

const recordInjected = (report, id, count, note = '') => recordReportItem(report.inject, id, count, note)

const recordSkipped = (report, id, count = 0, note = '') => {
  if (count > 0) recordReportItem(report.skipped, id, count, note)
}

const recordReportItem = (items, id, count, note = '') => {
  if (!count) return
  const definition = CONVERSION_DEFINITIONS.concat(FEATURE_DEFINITIONS).find((item) => item.id === id)
  items.push({
    id,
    title: definition?.title || id,
    count,
    note
  })
}

function createEmptyReport() {
  return {
    profileName: '',
    enabled: true,
    runMode: DEFAULT_SETTINGS.runMode,
    kernel: {
      version: '',
      isPrerelease: false
    },
    force: [],
    recommend: [],
    inject: [],
    skipped: [],
    totalApplied: 0,
    totalDetected: 0
  }
}

function toArray(value) {
  return Array.isArray(value) ? value : value === undefined ? [] : [value]
}

function unique(items) {
  return Array.from(new Set(items.filter((item) => item !== undefined && item !== null && item !== '')))
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function collectObjects(root) {
  const result = []
  const stack = [root]
  const seen = new Set()
  while (stack.length > 0) {
    const value = stack.pop()
    if (!value || typeof value !== 'object' || seen.has(value)) continue
    seen.add(value)
    result.push(value)
    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') stack.push(child)
    }
  }
  return result
}

function isIpLikeHost(value) {
  return /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(value) || /^\[[0-9a-f:]+](:\d+)?$/i.test(value)
}

function isDomainHost(value) {
  const host = String(value || '').trim()
  if (!host) return false
  if (isIpLikeHost(host)) return false
  return /[a-z]/i.test(host)
}

export default {
  onReady,
  onRun,
  onBeforeCoreStart
}
