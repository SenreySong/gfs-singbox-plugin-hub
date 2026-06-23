const DATA_DIR = 'data/third/tcp-speed-tester'
const SETTINGS_FILE = DATA_DIR + '/settings.json'
const HISTORY_FILE = DATA_DIR + '/history.json'
const DEFAULT_DELAY_URL = 'https://cp.cloudflare.com/generate_204'
const DEFAULT_SPEED_URL = 'https://speed.cloudflare.com/__down?bytes=25000000'
const TEST_OUTBOUND_TYPES = new Set([
  'shadowsocks',
  'vmess',
  'vless',
  'trojan',
  'hysteria',
  'hysteria2',
  'tuic',
  'anytls',
  'wireguard',
  'ssh',
  'http',
  'socks',
  'shadowtls',
  'naive'
])
const GROUP_OUTBOUND_TYPES = new Set(['selector', 'urltest'])
const EXCLUDED_OUTBOUND_TAGS = new Set(['direct', 'Direct', 'block', 'Block', 'dns', 'DNS'])
const DEFAULT_SETTINGS = {
  delayUrl: DEFAULT_DELAY_URL,
  speedUrl: DEFAULT_SPEED_URL,
  delayTimeout: 5000,
  speedTimeout: 20000,
  speedBytes: 25000000,
  historyLimit: 200,
  bypassTun: true,
  bindInterface: '',
  selectedNodeTags: [],
  selectedGroupTags: []
}
const BASE_CONFIG = {
  log: {
    level: 'warn',
    timestamp: true
  },
  dns: {
    servers: [
      {
        tag: 'tcp-speed-dns',
        type: 'https',
        server: 'dns.alidns.com',
        domain_resolver: 'tcp-speed-hosts'
      },
      {
        tag: 'tcp-speed-hosts',
        type: 'hosts',
        predefined: {
          'dns.alidns.com': ['223.5.5.5', '223.6.6.6']
        }
      }
    ],
    final: 'tcp-speed-dns'
  },
  inbounds: [],
  outbounds: [],
  route: {
    auto_detect_interface: true,
    default_domain_resolver: 'tcp-speed-dns',
    final: 'direct'
  },
  experimental: {
    clash_api: {
      external_controller: '',
      secret: ''
    }
  }
}

const clone = (value) => JSON.parse(JSON.stringify(value))

window[Plugin.id] = window[Plugin.id] || {
  settings: Vue.ref(clone(DEFAULT_SETTINGS)),
  history: Vue.ref([]),
  loaded: false,
  runtime: null
}

const getState = () => window[Plugin.id]

const ensureDataDir = async () => {
  if (!(await Plugins.FileExists('data/third').catch(() => false))) {
    await Plugins.MakeDir('data/third')
  }
  if (!(await Plugins.FileExists(DATA_DIR).catch(() => false))) {
    await Plugins.MakeDir(DATA_DIR)
  }
  if (!(await Plugins.FileExists(SETTINGS_FILE).catch(() => false))) {
    await Plugins.WriteFile(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2))
  }
  if (!(await Plugins.FileExists(HISTORY_FILE).catch(() => false))) {
    await Plugins.WriteFile(HISTORY_FILE, '[]')
  }
}

const readSettings = async () => {
  await ensureDataDir()
  const content = await Plugins.ReadFile(SETTINGS_FILE).catch(() => '{}')
  try {
    return normalizeSettings(JSON.parse(content))
  } catch {
    return normalizeSettings(DEFAULT_SETTINGS)
  }
}

const saveSettings = async (settings) => {
  await ensureDataDir()
  await Plugins.WriteFile(SETTINGS_FILE, JSON.stringify(normalizeSettings(settings), null, 2))
}

const readHistory = async () => {
  await ensureDataDir()
  const content = await Plugins.ReadFile(HISTORY_FILE).catch(() => '[]')
  try {
    const parsed = JSON.parse(content)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const trimHistory = (history, settings) => {
  const limit = normalizePositiveInteger(settings?.historyLimit, DEFAULT_SETTINGS.historyLimit, 20, 1000)
  return toArray(history).slice(0, limit)
}

const saveHistory = async (history, settings) => {
  await ensureDataDir()
  await Plugins.WriteFile(HISTORY_FILE, JSON.stringify(trimHistory(history, settings), null, 2))
}

const loadState = async () => {
  if (!getState().loaded) {
    getState().settings.value = await readSettings()
    getState().history.value = await readHistory()
    getState().loaded = true
  }
  getState().settings.value = normalizeSettings(getState().settings.value)
  return getState()
}

const normalizeSettings = (settings) => ({
  delayUrl: String(settings?.delayUrl || DEFAULT_DELAY_URL).trim(),
  speedUrl: String(settings?.speedUrl || DEFAULT_SPEED_URL).trim(),
  delayTimeout: normalizePositiveInteger(settings?.delayTimeout, DEFAULT_SETTINGS.delayTimeout, 1000, 60000),
  speedTimeout: normalizePositiveInteger(settings?.speedTimeout, DEFAULT_SETTINGS.speedTimeout, 3000, 120000),
  speedBytes: normalizePositiveInteger(settings?.speedBytes, DEFAULT_SETTINGS.speedBytes, 1024, 500000000),
  historyLimit: normalizePositiveInteger(settings?.historyLimit, DEFAULT_SETTINGS.historyLimit, 20, 1000),
  bypassTun: settings?.bypassTun !== false,
  bindInterface: String(settings?.bindInterface || '').trim(),
  selectedNodeTags: uniqueStrings(settings?.selectedNodeTags),
  selectedGroupTags: uniqueStrings(settings?.selectedGroupTags)
})

const onReady = async () => {
  await loadState()
}

const onRun = async () => {
  await openManager()
}

const openManager = async () => {
  const { ref, h } = Vue
  const state = await loadState()
  const settings = ref(normalizeSettings(state.settings.value))
  const history = ref(await readHistory())
  const preview = ref(await buildPreviewContext(settings.value))
  const running = ref(false)

  const component = {
    template: `
    <div class="flex flex-col gap-10 pr-8">
      <div class="flex items-center justify-between gap-8">
        <div class="min-w-0">
          <div class="font-bold text-16">TCP 延迟与测速 <span class="text-12 opacity-70">{{ pluginVersion }}</span></div>
          <div class="text-12 opacity-70 truncate" :title="summaryText">{{ summaryText }}</div>
        </div>
        <div class="flex gap-8">
          <Button @click="refreshPreview" :disabled="running">刷新节点</Button>
          <Button type="primary" @click="runTests" :loading="running">开始测试</Button>
          <Button @click="saveOnly" :disabled="running">保存</Button>
        </div>
      </div>

      <Card>
        <div class="grid items-center gap-8" style="grid-template-columns: 140px minmax(220px, 1fr) 140px minmax(160px, 1fr);">
          <div class="font-bold text-13">延迟地址</div>
          <Input v-model="settings.delayUrl" allow-paste />
          <div class="font-bold text-13">延迟超时(ms)</div>
          <Input v-model="settings.delayTimeout" type="number" editable />
          <div class="font-bold text-13">测速地址</div>
          <Input v-model="settings.speedUrl" allow-paste />
          <div class="font-bold text-13">测速超时(ms)</div>
          <Input v-model="settings.speedTimeout" type="number" editable />
          <div class="font-bold text-13">测速字节数</div>
          <Input v-model="settings.speedBytes" type="number" editable />
          <div class="font-bold text-13">历史保留</div>
          <Input v-model="settings.historyLimit" type="number" editable />
          <div class="font-bold text-13">旁路当前 TUN</div>
          <Switch v-model="settings.bypassTun">启用</Switch>
          <div class="font-bold text-13">物理接口</div>
          <Input v-model="settings.bindInterface" placeholder="自动检测，或手动填 en0/en12" allow-paste />
          <div class="text-12 opacity-70" style="grid-column: 2 / -1;">
            默认延迟地址使用 Cloudflare CP；默认测速地址使用 Cloudflare speedtest 下载文件。启用旁路时会自动检测默认物理接口，也可手动填写。
          </div>
        </div>
      </Card>

      <Card>
        <div class="grid gap-12" style="grid-template-columns: 1fr 1fr;">
          <div>
            <div class="flex items-center justify-between mb-8">
              <div class="font-bold text-14">节点</div>
              <div class="text-12 opacity-70">已选 {{ selectedNodeCount }} / {{ preview.nodes.length }}</div>
            </div>
            <div class="grid gap-8" style="grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); max-height: 300px; overflow-y: auto;">
              <label v-for="node in preview.nodes" :key="node.tag" class="rounded-4 p-8 cursor-pointer" style="border: 1px solid #cbd5e1; background: #f8fafc;">
                <div class="flex items-start gap-8">
                  <input type="checkbox" :value="node.tag" v-model="settings.selectedNodeTags" />
                  <div class="min-w-0">
                    <div class="font-bold text-12 truncate" :title="node.tag">{{ node.tag }}</div>
                    <div class="text-11 opacity-70">{{ node.type }}</div>
                  </div>
                </div>
              </label>
            </div>
          </div>
          <div>
            <div class="flex items-center justify-between mb-8">
              <div class="font-bold text-14">策略组</div>
              <div class="text-12 opacity-70">已选 {{ selectedGroupCount }} / {{ preview.groups.length }}</div>
            </div>
            <div class="grid gap-8" style="grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); max-height: 300px; overflow-y: auto;">
              <label v-for="group in preview.groups" :key="group.tag" class="rounded-4 p-8 cursor-pointer" style="border: 1px solid #cbd5e1; background: #f8fafc;">
                <div class="flex items-start gap-8">
                  <input type="checkbox" :value="group.tag" v-model="settings.selectedGroupTags" />
                  <div class="min-w-0">
                    <div class="font-bold text-12 truncate" :title="group.tag">{{ group.tag }}</div>
                    <div class="text-11 opacity-70">{{ group.outbounds.length }} 个节点</div>
                  </div>
                </div>
              </label>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div class="flex items-center justify-between mb-8">
          <div class="font-bold text-14">本次待测</div>
          <div class="text-12 opacity-70">{{ preview.selectedNodes.length }} 个节点</div>
        </div>
        <div class="grid gap-8" style="grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); max-height: 220px; overflow-y: auto;">
          <div v-for="node in preview.selectedNodes" :key="node.tag" class="rounded-4 p-8" style="border: 1px solid #cbd5e1; background: #f8fafc;">
            <div class="font-bold text-12 truncate" :title="node.tag">{{ node.tag }}</div>
            <div class="text-11 opacity-70">{{ node.type }}</div>
          </div>
          <div v-if="preview.selectedNodes.length === 0" class="text-12 opacity-70">未选择节点或策略组。</div>
        </div>
      </Card>

      <Card>
        <div class="flex items-center justify-between mb-8">
          <div class="font-bold text-14">历史结果</div>
          <Button @click="clearHistory" :disabled="running">清空历史</Button>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-12" style="border-collapse: collapse;">
            <thead>
              <tr style="border-bottom: 1px solid #cbd5e1;">
                <th class="text-left p-6">时间</th>
                <th class="text-left p-6">节点</th>
                <th class="text-left p-6">类型</th>
                <th class="text-left p-6">TCP 延迟</th>
                <th class="text-left p-6">测速</th>
                <th class="text-left p-6">下载量</th>
                <th class="text-left p-6">结果</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in history" :key="item.id" style="border-bottom: 1px solid #e2e8f0;">
                <td class="p-6 whitespace-nowrap">{{ formatTime(item.time) }}</td>
                <td class="p-6" style="min-width: 220px;">{{ item.tag }}</td>
                <td class="p-6">{{ item.type }}</td>
                <td class="p-6">{{ item.tcpDelayMs > 0 ? item.tcpDelayMs + ' ms' : '失败' }}</td>
                <td class="p-6">{{ item.speedMbps > 0 ? item.speedMbps + ' Mbps' : '失败' }}</td>
                <td class="p-6">{{ formatBytes(item.bytesRead) }}</td>
                <td class="p-6">{{ item.error || '成功' }}</td>
              </tr>
              <tr v-if="history.length === 0">
                <td class="p-8 text-center opacity-70" colspan="7">暂无历史结果</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
    `,
    setup() {
      const refreshPreview = async () => {
        settings.value = normalizeSettings(settings.value)
        preview.value = await buildPreviewContext(settings.value)
      }
      const saveOnly = async () => {
        settings.value = normalizeSettings(settings.value)
        await saveSettings(settings.value)
        Plugins.message.success('TCP 延迟与测速设置已保存')
      }
      const runTests = async () => {
        if (running.value) return
        settings.value = normalizeSettings(settings.value)
        preview.value = await buildPreviewContext(settings.value)
        if (preview.value.selectedNodes.length === 0) {
          Plugins.message.warn('请至少选择一个节点或策略组')
          return
        }
        running.value = true
        await saveSettings(settings.value)
        try {
          const results = await executeTests(preview.value.sourceConfig, preview.value.selectedNodes, settings.value)
          history.value = trimHistory(results.concat(history.value), settings.value)
          await saveHistory(history.value, settings.value)
          getState().history.value = history.value
          Plugins.message.success(`测试完成：${results.length} 个节点`)
        } catch (error) {
          Plugins.message.error(String(error))
        } finally {
          await stopRuntime()
          running.value = false
        }
      }
      const clearHistory = async () => {
        if (!(await Plugins.confirm('清空历史', '确定要清空 TCP 延迟与测速历史吗？').catch(() => false))) return
        history.value = []
        await saveHistory(history.value, settings.value)
        getState().history.value = history.value
        Plugins.message.success('历史结果已清空')
      }

      return {
        pluginVersion: Plugin.version || '',
        settings,
        preview,
        history,
        running,
        summaryText: Vue.computed(() => `当前配置：${preview.value.profileName || '未找到'}，可测节点 ${preview.value.nodes.length} 个，策略组 ${preview.value.groups.length} 个`),
        selectedNodeCount: Vue.computed(() => settings.value.selectedNodeTags.length),
        selectedGroupCount: Vue.computed(() => settings.value.selectedGroupTags.length),
        refreshPreview,
        saveOnly,
        runTests,
        clearHistory,
        formatTime,
        formatBytes
      }
    }
  }

  const modal = Plugins.modal(
    {
      title: 'TCP 延迟与测速',
      submit: false,
      width: '90',
      height: '88',
      cancelText: '关闭',
      afterClose() {
        void stopRuntime()
        modal.destroy()
      }
    },
    {
      default: () => h(component)
    }
  )
  modal.open()
}

const buildPreviewContext = async (settings) => {
  const profile = getCurrentProfile()
  if (!profile) {
    return createPreviewContext()
  }
  const generatedConfig = await Plugins.generateConfig(profile).catch(() => null)
  if (!generatedConfig) {
    return createPreviewContext({ profileName: profile.name || '' })
  }
  const nodes = collectTestNodes(generatedConfig)
  const groups = collectGroups(generatedConfig, nodes)
  const selectedNodes = resolveSelectedNodes(nodes, groups, settings)
  return createPreviewContext({
    profileName: profile.name || '',
    sourceConfig: generatedConfig,
    nodes,
    groups,
    selectedNodes
  })
}

const createPreviewContext = (overrides = {}) => ({
  profileName: '',
  sourceConfig: null,
  nodes: [],
  groups: [],
  selectedNodes: [],
  ...overrides
})

const getCurrentProfile = () => {
  const profilesStore = Plugins.useProfilesStore()
  const appSettingsStore = Plugins.useAppSettingsStore()
  const profiles = profilesStore.profiles || []
  const currentProfileId = appSettingsStore.app?.kernel?.profile
  return profiles.find((profile) => profile.id === currentProfileId) || profilesStore.currentProfile || profiles[0]
}

const collectTestNodes = (config) => {
  return (config?.outbounds || [])
    .filter((outbound) => outbound?.tag && TEST_OUTBOUND_TYPES.has(outbound.type) && !EXCLUDED_OUTBOUND_TAGS.has(outbound.tag))
    .map((outbound) => ({
      tag: outbound.tag,
      type: outbound.type,
      outbound
    }))
}

const collectGroups = (config, nodes) => {
  const nodeTags = new Set(nodes.map((node) => node.tag))
  return (config?.outbounds || [])
    .filter((outbound) => outbound?.tag && GROUP_OUTBOUND_TYPES.has(outbound.type))
    .map((group) => ({
      tag: group.tag,
      type: group.type,
      outbounds: toArray(group.outbounds).filter((tag) => nodeTags.has(tag))
    }))
    .filter((group) => group.outbounds.length > 0)
}

const resolveSelectedNodes = (nodes, groups, settings) => {
  const nodeMap = new Map(nodes.map((node) => [node.tag, node]))
  const selected = new Set(settings.selectedNodeTags.filter((tag) => nodeMap.has(tag)))
  const groupMap = new Map(groups.map((group) => [group.tag, group]))
  for (const groupTag of settings.selectedGroupTags) {
    const group = groupMap.get(groupTag)
    if (!group) continue
    for (const tag of group.outbounds) selected.add(tag)
  }
  return Array.from(selected).map((tag) => nodeMap.get(tag)).filter(Boolean)
}

const executeTests = async (sourceConfig, selectedNodes, settings) => {
  const runtime = await startRuntime(sourceConfig, selectedNodes, settings)
  let completed = 0
  const total = selectedNodes.length
  const msg = Plugins.message.info(`TCP 测试中 0 / ${total}`, 999999)
  const results = []
  try {
    for (const node of selectedNodes) {
      const result = await testSingleNode(runtime, node, settings)
      results.push(result)
      completed += 1
      msg.update?.(`TCP 测试中 ${completed} / ${total}`)
    }
    msg.success?.(`TCP 测试完成 ${completed} / ${total}`)
    await Plugins.sleep(1200)
    return results.sort((a, b) => {
      const valueA = a.tcpDelayMs <= 0 ? Infinity : a.tcpDelayMs
      const valueB = b.tcpDelayMs <= 0 ? Infinity : b.tcpDelayMs
      return valueA - valueB
    })
  } finally {
    msg.destroy?.()
  }
}

const startRuntime = async (sourceConfig, selectedNodes, settings) => {
  await stopRuntime()
  const secret = Plugins.generateSecureKey()
  const ports = await getAvailablePorts(selectedNodes.length + 1)
  const apiPort = ports[0]
  const httpPorts = ports.slice(1)
  const controller = `127.0.0.1:${apiPort}`
  const runtimeDir = `${DATA_DIR}/runtime`
  const configPath = `${runtimeDir}/config.json`
  await Plugins.MakeDir(runtimeDir).catch(() => {})
  const portMap = new Map(selectedNodes.map((node, index) => [node.tag, httpPorts[index]]))
  const bindInterface = await resolveBindInterface(settings)
  const runtimeConfig = createRuntimeConfig(sourceConfig, selectedNodes, controller, secret, portMap, bindInterface)
  await Plugins.WriteFile(configPath, JSON.stringify(runtimeConfig, null, 2))
  const isAlpha = Plugins.useAppSettingsStore().app?.kernel?.branch === 'alpha'
  const core = await Plugins.getKernelFileName(isAlpha)
  const [corePath, absoluteConfigPath, workingDir] = await Promise.all([
    Plugins.AbsolutePath(`data/sing-box/${core}`),
    Plugins.AbsolutePath(configPath),
    Plugins.AbsolutePath(runtimeDir)
  ])
  const pid = await runCore(corePath, absoluteConfigPath, workingDir)
  const runtime = {
    pid,
    configPath,
    baseUrl: `http://${controller}`,
    secret,
    portMap
  }
  getState().runtime = runtime
  return runtime
}

const createRuntimeConfig = (sourceConfig, selectedNodes, controller, secret, portMap, bindInterface) => {
  const nodeBindings = selectedNodes.map((node, index) => ({
    node,
    inboundTag: createInboundTag(node, index),
    port: portMap.get(node.tag)
  }))
  const rules = nodeBindings.map((binding) => ({
    inbound: binding.inboundTag,
    action: 'route',
    outbound: binding.node.tag
  }))
  const outbounds = collectRuntimeOutbounds(sourceConfig, selectedNodes, bindInterface).concat([
    {
      type: 'direct',
      tag: 'direct'
    },
    {
      type: 'block',
      tag: 'block'
    }
  ])
  return {
    ...clone(BASE_CONFIG),
    dns: createRuntimeDns(bindInterface),
    inbounds: nodeBindings.map((binding) => ({
      type: 'http',
      tag: binding.inboundTag,
      listen: '127.0.0.1',
      listen_port: binding.port
    })),
    outbounds,
    route: {
      ...clone(BASE_CONFIG.route),
      default_interface: bindInterface || '',
      rules,
      final: 'direct'
    },
    experimental: {
      clash_api: {
        external_controller: controller,
        secret
      }
    }
  }
}

const createInboundTag = (node, index) => {
  return `test-http-${index + 1}-${safeTag(node.tag)}`
}

const createRuntimeDns = (bindInterface) => {
  const dns = clone(BASE_CONFIG.dns)
  if (!bindInterface) return dns
  for (const server of dns.servers) {
    if (server.type === 'hosts' || server.type === 'fakeip') continue
    server.bind_interface = bindInterface
  }
  return dns
}

const sanitizeOutbound = (outbound, bindInterface) => {
  const cloned = clone(outbound)
  cloned.domain_resolver = 'tcp-speed-dns'
  if (bindInterface) cloned.bind_interface = bindInterface
  return cloned
}

const collectRuntimeOutbounds = (sourceConfig, selectedNodes, bindInterface) => {
  const sourceMap = new Map((sourceConfig?.outbounds || []).filter((outbound) => outbound?.tag).map((outbound) => [outbound.tag, outbound]))
  const collected = []
  const seen = new Set()
  const visit = (tag) => {
    if (!tag || seen.has(tag)) return
    const outbound = sourceMap.get(tag)
    if (!outbound) return
    seen.add(tag)
    collected.push(sanitizeOutbound(outbound, bindInterface))
    if (outbound.detour) visit(outbound.detour)
  }
  for (const node of selectedNodes) visit(node.tag)
  return collected
}

const runCore = async (corePath, configPath, workingDir) => {
  return new Promise((resolve, reject) => {
    let output = ''
    const pidPromise = Plugins.ExecBackground(
      corePath,
      ['run', '--disable-color', '-c', configPath, '-D', workingDir],
      (out) => {
        output = out
        if (out.includes('sing-box started')) {
          pidPromise.then(resolve).catch(reject)
        }
      },
      () => reject(output || '临时核心异常退出'),
      {
        StopOutputKeyword: 'sing-box started'
      }
    ).catch(reject)
  })
}

const stopRuntime = async () => {
  const runtime = getState().runtime
  if (!runtime) return
  if (runtime.pid) await Plugins.KillProcess(runtime.pid).catch(() => {})
  if (runtime.configPath) await Plugins.RemoveFile(runtime.configPath).catch(() => {})
  getState().runtime = null
}

const testSingleNode = async (runtime, node, settings) => {
  const now = Date.now()
  const base = {
    id: Plugins.sampleID(),
    time: now,
    tag: node.tag,
    type: node.type,
    delayUrl: settings.delayUrl,
    speedUrl: settings.speedUrl,
    tcpDelayMs: -1,
    speedMbps: -1,
    bytesRead: 0,
    durationMs: 0,
    error: ''
  }
  try {
    const tcpDelayMs = await testTcpDelay(runtime, node.tag, settings)
    const speed = await testDownloadSpeed(getNodeProxyUrl(runtime, node.tag), settings)
    return {
      ...base,
      tcpDelayMs,
      speedMbps: speed.speedMbps,
      bytesRead: speed.bytesRead,
      durationMs: speed.durationMs
    }
  } catch (error) {
    return {
      ...base,
      error: String(error?.message || error)
    }
  }
}

const testTcpDelay = async (runtime, tag, settings) => {
  const url = new URL(`${runtime.baseUrl}/proxies/${encodeURIComponent(tag)}/delay`)
  url.searchParams.append('url', settings.delayUrl)
  url.searchParams.append('timeout', String(settings.delayTimeout))
  const { status, body } = await Plugins.Requests({
    method: 'GET',
    url: url.toString(),
    autoTransformBody: false,
    headers: {
      Authorization: `Bearer ${runtime.secret}`
    },
    options: {
      Proxy: '',
      Timeout: Number(settings.delayTimeout) + 1000
    }
  })
  if (status < 200 || status >= 300) {
    throw `TCP 延迟接口失败：${status}`
  }
  const delay = JSON.parse(body).delay
  if (!Number.isFinite(delay) || delay <= 0) {
    throw 'TCP 延迟测试失败'
  }
  return Math.round(delay)
}

const testDownloadSpeed = async (proxyUrl, settings) => {
  const startedAt = Date.now()
  const { status, body } = await Plugins.Requests({
    method: 'GET',
    url: settings.speedUrl,
    autoTransformBody: false,
    options: {
      Proxy: proxyUrl,
      Timeout: Number(settings.speedTimeout)
    }
  })
  if (status < 200 || status >= 300) {
    throw `测速下载失败：${status}`
  }
  const durationMs = Math.max(Date.now() - startedAt, 1)
  const bytesRead = estimateBodyBytes(body, settings.speedBytes)
  const speedMbps = Number(((bytesRead * 8) / durationMs / 1000).toFixed(2))
  return {
    bytesRead,
    durationMs,
    speedMbps
  }
}

const getNodeProxyUrl = (runtime, tag) => {
  const port = runtime.portMap.get(tag)
  if (!port) throw `未找到节点 ${tag} 的测试端口`
  return `http://127.0.0.1:${port}`
}

const getAvailablePorts = async (count) => {
  let out = ''
  try {
    out = await Plugins.Exec('ss', ['-tuln'])
  } catch {
    out = await Plugins.Exec('netstat', ['-anv']).catch(() => '')
  }
  const portRegex = /(?:\[[a-fA-F0-9:]+\]|[\d.]+)(?::|\.)(\d+)/g
  const occupiedPorts = new Set()
  let match
  while ((match = portRegex.exec(out)) !== null) {
    occupiedPorts.add(parseInt(match[1], 10))
  }
  const ports = []
  while (ports.length < count) {
    const port = Math.floor(Math.random() * (65535 - 1024 + 1)) + 1024
    if (!occupiedPorts.has(port) && !ports.includes(port)) ports.push(port)
  }
  return ports
}

const resolveBindInterface = async (settings) => {
  if (!settings?.bypassTun) return ''
  if (settings.bindInterface) return settings.bindInterface
  return getDefaultInterface()
}

const getDefaultInterface = async () => {
  const routeOutput = await Plugins.Exec('route', ['-n', 'get', 'default']).catch(() => '')
  const matched = String(routeOutput).match(/interface:\s*([^\s]+)/)
  return matched?.[1] || ''
}

const safeTag = (tag) => {
  return String(tag || '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || Plugins.sampleID()
}

const estimateBodyBytes = (body, fallback) => {
  if (typeof body === 'string') return new TextEncoder().encode(body).length || fallback
  if (body instanceof ArrayBuffer) return body.byteLength || fallback
  if (ArrayBuffer.isView(body)) return body.byteLength || fallback
  return fallback
}

const formatTime = (timestamp) => {
  if (!timestamp) return ''
  return new Date(timestamp).toLocaleString()
}

const formatBytes = (bytes) => {
  const value = Number(bytes || 0)
  if (value <= 0) return '0 B'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

const normalizePositiveInteger = (value, fallback, min, max) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(Math.max(Math.trunc(numeric), min), max)
}

const uniqueStrings = (items) => Array.from(new Set(toArray(items).map((item) => String(item || '').trim()).filter(Boolean)))

const toArray = (value) => Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]

export default {
  onReady,
  onRun
}
