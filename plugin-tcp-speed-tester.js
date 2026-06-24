const DATA_DIR = 'data/third/tcp-speed-tester'
const SETTINGS_FILE = DATA_DIR + '/settings.json'
const HISTORY_FILE = DATA_DIR + '/history.json'
const DEFAULT_DELAY_URL = 'https://cp.cloudflare.com/generate_204'
const DEFAULT_SPEED_URL = 'https://speed.cloudflare.com/__down?bytes=25000000'
const TEST_INBOUND_TAG = '__tcp_speed_test_http__'
const TEST_SELECTOR_TAG = '__tcp_speed_test__'
const DEFAULT_TEST_PORT = 7899
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
const EXCLUDED_OUTBOUND_TAGS = new Set(['direct', 'Direct', 'block', 'Block', 'dns', 'DNS'])
const DEFAULT_SETTINGS = {
  delayUrl: DEFAULT_DELAY_URL,
  speedUrl: DEFAULT_SPEED_URL,
  delayTimeout: 5000,
  speedTimeout: 20000,
  testPort: DEFAULT_TEST_PORT,
  historyLimit: 200,
  selectedNodeTags: []
}

const clone = (value) => JSON.parse(JSON.stringify(value))

window[Plugin.id] = window[Plugin.id] || {
  settings: Vue.ref(clone(DEFAULT_SETTINGS)),
  history: Vue.ref([]),
  loaded: false
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
  testPort: normalizePositiveInteger(settings?.testPort, DEFAULT_SETTINGS.testPort, 1024, 65535),
  historyLimit: normalizePositiveInteger(settings?.historyLimit, DEFAULT_SETTINGS.historyLimit, 20, 1000),
  selectedNodeTags: uniqueStrings(settings?.selectedNodeTags)
})

const onReady = async () => {
  await loadState()
}

const onRun = async () => {
  await openManager()
}

const onBeforeCoreStart = async (config) => {
  const settings = await loadSettingsForHook()
  injectCurrentCoreSpeedTest(config, settings)
  return config
}

const loadSettingsForHook = async () => {
  if (getState().loaded) return normalizeSettings(getState().settings.value)
  return await readSettings()
}

const openManager = async () => {
  const { ref, h } = Vue
  const state = await loadState()
  const settings = ref(normalizeSettings(state.settings.value))
  const history = ref(await readHistory())
  const preview = ref(await buildPreviewContext(settings.value))
  const progress = ref({ text: '就绪', detail: '' })
  const runningResults = ref([])
  const running = ref(false)
  const nodeKeyword = ref('')

  const component = {
    template: `
    <div class="flex flex-col gap-10 pr-8" style="color: #334155;">
      <div class="flex items-start justify-between gap-12">
        <div class="min-w-0 flex flex-col gap-4">
          <div class="font-bold text-16" style="color: #0f172a;">TCP 延迟与测速 <span class="text-12 opacity-70">{{ pluginVersion }}</span></div>
          <div class="text-12 opacity-70 truncate" :title="summaryText">{{ summaryText }}</div>
          <div class="flex gap-6 text-11" style="flex-wrap: wrap;">
            <span class="rounded-4 px-8 py-3" style="background: #eff6ff; color: #1d4ed8;">节点 {{ preview.nodes.length }}</span>
            <span class="rounded-4 px-8 py-3" style="background: #ecfdf5; color: #047857;">已选 {{ selectedNodeCount }}</span>
            <span class="rounded-4 px-8 py-3" style="background: #f1f5f9; color: #475569;">入口 127.0.0.1:{{ settings.testPort }}</span>
          </div>
        </div>
        <div class="flex gap-8" style="flex-shrink: 0;">
          <Button @click="refreshPreview" :disabled="running">刷新节点</Button>
          <Button type="primary" @click="runTests" :loading="running" :disabled="running">开始测试</Button>
          <Button @click="saveOnly" :disabled="running">保存</Button>
        </div>
      </div>

      <Card>
        <div class="flex flex-col gap-10">
          <div class="grid gap-10" style="grid-template-columns: minmax(320px, 1.4fr) minmax(260px, 1fr);">
            <div class="flex flex-col gap-8">
              <div class="font-bold text-13" style="color: #0f172a;">测试地址</div>
              <div class="grid items-center gap-8" style="grid-template-columns: 76px minmax(0, 1fr);">
                <div class="text-12 opacity-70">延迟</div>
                <Input v-model="settings.delayUrl" allow-paste :disabled="running" />
                <div class="text-12 opacity-70">测速</div>
                <Input v-model="settings.speedUrl" allow-paste :disabled="running" />
              </div>
            </div>
            <div class="flex flex-col gap-8">
              <div class="font-bold text-13" style="color: #0f172a;">运行参数</div>
              <div class="grid items-center gap-8" style="grid-template-columns: 96px minmax(0, 1fr);">
                <div class="text-12 opacity-70">延迟超时</div>
                <Input v-model="settings.delayTimeout" type="number" editable :disabled="running" />
                <div class="text-12 opacity-70">测速超时</div>
                <Input v-model="settings.speedTimeout" type="number" editable :disabled="running" />
                <div class="text-12 opacity-70">入口端口</div>
                <Input v-model="settings.testPort" type="number" editable :disabled="running" />
                <div class="text-12 opacity-70">历史保留</div>
                <Input v-model="settings.historyLimit" type="number" editable :disabled="running" />
              </div>
            </div>
          </div>
          <div class="rounded-4 p-8 text-12" style="border: 1px solid #bfdbfe; background: #eff6ff; color: #1e40af;">
            插件会在核心启动前注入 HTTP 测速入站 <b>{{ speedInboundText }}</b> 和 selector 策略组 <b>{{ speedSelectorTag }}</b>。修改端口或节点订阅后需要重启核心生效；测速时会切换该策略组，不再启动临时核心。
          </div>
        </div>
      </Card>

      <Card>
        <div class="flex items-center justify-between gap-10 mb-8">
          <div>
            <div class="font-bold text-14" style="color: #0f172a;">节点</div>
            <div class="text-12 opacity-70">已选 {{ selectedNodeCount }} / {{ preview.nodes.length }}，当前显示 {{ filteredNodes.length }} 个</div>
          </div>
          <div class="flex items-center gap-8" style="min-width: min(420px, 100%); flex-wrap: wrap;">
            <Input v-model="nodeKeyword" placeholder="搜索节点、类型或链式代理" allow-paste :disabled="running" />
            <Button @click="selectVisibleNodes" :disabled="running || filteredNodes.length === 0">全选显示</Button>
            <Button @click="clearSelectedNodes" :disabled="running || selectedNodeCount === 0">清空</Button>
          </div>
        </div>
        <div class="grid gap-8" style="grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); max-height: 360px; overflow-y: auto;">
          <label v-for="node in filteredNodes" :key="node.tag" class="rounded-4 p-8" :class="{ 'cursor-pointer': !running }" :style="nodeCardStyle(node)">
            <div class="flex items-start gap-8">
              <input type="checkbox" :value="node.tag" v-model="settings.selectedNodeTags" :disabled="running" />
              <div class="min-w-0">
                <div class="font-bold text-12 truncate" :title="node.tag">{{ node.tag }}</div>
                <div class="text-11 opacity-70">{{ node.type }}</div>
                <div v-if="node.chainInfo.isChained" class="text-11 mt-4" style="color: #0f766e;">
                  链式代理：{{ node.chainInfo.chainText }}
                </div>
              </div>
            </div>
          </label>
          <div v-if="preview.nodes.length === 0" class="text-12 opacity-70">当前配置没有可测速节点。</div>
          <div v-else-if="filteredNodes.length === 0" class="text-12 opacity-70">没有匹配的节点。</div>
        </div>
      </Card>

      <Card v-if="running || runningResults.length > 0">
        <div class="flex items-center justify-between mb-8">
          <div>
            <div class="font-bold text-14">当前进度</div>
            <div class="text-12 opacity-70">{{ progress.text }}</div>
          </div>
          <div class="text-12 opacity-70">{{ progress.detail }}</div>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-12" style="border-collapse: collapse;">
            <thead>
              <tr style="border-bottom: 1px solid #cbd5e1;">
                <th class="text-left p-6">节点</th>
                <th class="text-left p-6">类型</th>
                <th class="text-left p-6">链式代理</th>
                <th class="text-left p-6">TCP 延迟</th>
                <th class="text-left p-6">测速</th>
                <th class="text-left p-6">下载量</th>
                <th class="text-left p-6">状态</th>
                <th class="text-left p-6">结果</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in runningResults" :key="item.id" style="border-bottom: 1px solid #e2e8f0;">
                <td class="p-6" style="min-width: 220px;">{{ item.tag }}</td>
                <td class="p-6">{{ item.type }}</td>
                <td class="p-6" style="min-width: 220px;">{{ item.chainText || '-' }}</td>
                <td class="p-6">{{ formatRunningDelay(item) }}</td>
                <td class="p-6">{{ formatRunningSpeed(item) }}</td>
                <td class="p-6">{{ formatBytes(item.bytesRead) }}</td>
                <td class="p-6">{{ item.status || '等待中' }}</td>
                <td class="p-6">{{ formatRunningResult(item) }}</td>
              </tr>
              <tr v-if="runningResults.length === 0">
                <td class="p-8 text-center opacity-70" colspan="8">等待开始测速</td>
              </tr>
            </tbody>
          </table>
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
                <th class="text-left p-6">链式代理</th>
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
                <td class="p-6" style="min-width: 220px;">{{ item.chainText || '-' }}</td>
                <td class="p-6">{{ item.tcpDelayMs > 0 ? item.tcpDelayMs + ' ms' : '失败' }}</td>
                <td class="p-6">{{ item.speedMbps > 0 ? item.speedMbps + ' Mbps' : '失败' }}</td>
                <td class="p-6">{{ formatBytes(item.bytesRead) }}</td>
                <td class="p-6">{{ item.error || '成功' }}</td>
              </tr>
              <tr v-if="history.length === 0">
                <td class="p-8 text-center opacity-70" colspan="8">暂无历史结果</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
    `,
    setup() {
      let saveTimer = null
      const persistSettings = async () => {
        const normalized = normalizeSettings(settings.value)
        if (JSON.stringify(settings.value) !== JSON.stringify(normalized)) {
          settings.value = normalized
        }
        getState().settings.value = settings.value
        await saveSettings(settings.value)
      }
      const scheduleSettingsSave = () => {
        if (saveTimer) clearTimeout(saveTimer)
        saveTimer = setTimeout(() => {
          void persistSettings().catch((error) => Plugins.message.error(`保存测速设置失败：${String(error)}`))
        }, 500)
      }
      const refreshPreview = async () => {
        settings.value = normalizeSettings(settings.value)
        preview.value = await buildPreviewContext(settings.value)
      }
      const saveOnly = async () => {
        await persistSettings()
        Plugins.message.success('TCP 延迟与测速设置已保存')
      }
      const filteredNodes = Vue.computed(() => {
        const keyword = String(nodeKeyword.value || '').trim().toLowerCase()
        if (!keyword) return preview.value.nodes
        return preview.value.nodes.filter((node) => {
          return [
            node.tag,
            node.type,
            node.chainInfo?.chainText
          ].some((value) => String(value || '').toLowerCase().includes(keyword))
        })
      })
      const selectVisibleNodes = () => {
        if (running.value) return
        const tags = new Set(settings.value.selectedNodeTags)
        for (const node of filteredNodes.value) tags.add(node.tag)
        settings.value.selectedNodeTags = Array.from(tags)
      }
      const clearSelectedNodes = () => {
        if (running.value) return
        settings.value.selectedNodeTags = []
      }
      const nodeCardStyle = (node) => {
        const selected = settings.value.selectedNodeTags.includes(node.tag)
        if (selected) return 'border: 1px solid #2563eb; background: #eff6ff;'
        if (node.chainInfo?.isChained) return 'border: 1px solid #99f6e4; background: #f0fdfa;'
        return 'border: 1px solid #cbd5e1; background: #f8fafc;'
      }
      const runTests = async () => {
        if (running.value) return
        await persistSettings()
        preview.value = await buildPreviewContext(settings.value)
        if (preview.value.selectedNodes.length === 0) {
          Plugins.message.warn('请至少选择一个节点')
          return
        }
        running.value = true
        runningResults.value = createPendingResults(preview.value.selectedNodes)
        progress.value = {
          text: '准备测速',
          detail: `${preview.value.selectedNodes.length} 个节点`
        }
        try {
          const results = await executeTests(preview.value.sourceConfig, preview.value.selectedNodes, settings.value, {
            onStatus(text, detail = '') {
              progress.value = { text, detail }
            },
            onNodeStatus(tag, status) {
              runningResults.value = updateRunningResult(runningResults.value, tag, { status })
            },
            onResultPatch(tag, patch) {
              runningResults.value = updateRunningResult(runningResults.value, tag, patch)
            },
            async onResult(result) {
              runningResults.value = updateRunningResult(runningResults.value, result.tag, { ...result, status: result.error ? '失败' : '完成' })
              history.value = trimHistory([result].concat(history.value), settings.value)
              await saveHistory(history.value, settings.value)
              getState().history.value = history.value
            }
          })
          getState().history.value = history.value
          progress.value = {
            text: '测速完成',
            detail: `${results.length} 个节点`
          }
          Plugins.message.success(`测试完成：${results.length} 个节点`)
        } catch (error) {
          progress.value = {
            text: '测速失败',
            detail: String(error?.message || error)
          }
          Plugins.message.error(String(error))
        } finally {
          running.value = false
        }
      }
      const clearHistory = async () => {
        if (!(await Plugins.confirm('清空历史', '确定要清空 TCP 延迟与测速历史吗？').catch(() => false))) return
        history.value = []
        await saveHistory(history.value, settings.value)
        getState().history.value = history.value
        runningResults.value = []
        Plugins.message.success('历史结果已清空')
      }
      Vue.watch(settings, scheduleSettingsSave, { deep: true })

      return {
        pluginVersion: Plugin.version || '',
        settings,
        preview,
        nodeKeyword,
        filteredNodes,
        progress,
        runningResults,
        history,
        running,
        summaryText: Vue.computed(() => `当前配置：${preview.value.profileName || '未找到'}，可测节点 ${preview.value.nodes.length} 个`),
        selectedNodeCount: Vue.computed(() => {
          const nodeTags = new Set(preview.value.nodes.map((node) => node.tag))
          return settings.value.selectedNodeTags.filter((tag) => nodeTags.has(tag)).length
        }),
        speedInboundText: Vue.computed(() => `127.0.0.1:${settings.value.testPort}`),
        speedSelectorTag: TEST_SELECTOR_TAG,
        selectVisibleNodes,
        clearSelectedNodes,
        nodeCardStyle,
        refreshPreview,
        saveOnly,
        runTests,
        clearHistory,
        formatTime,
        formatBytes,
        formatRunningDelay,
        formatRunningSpeed,
        formatRunningResult
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
  const outboundMap = new Map((generatedConfig?.outbounds || []).filter((outbound) => outbound?.tag).map((outbound) => [outbound.tag, outbound]))
  const nodes = collectTestNodes(generatedConfig)
    .map((node) => ({
      ...node,
      chainInfo: buildChainInfo(node.outbound, outboundMap)
    }))
  const selectedNodes = resolveSelectedNodes(nodes, settings)
  return createPreviewContext({
    profileName: profile.name || '',
    sourceConfig: generatedConfig,
    nodes,
    selectedNodes
  })
}

const createPreviewContext = (overrides = {}) => ({
  profileName: '',
  sourceConfig: null,
  nodes: [],
  selectedNodes: [],
  ...overrides
})

const injectCurrentCoreSpeedTest = (config, settings) => {
  if (!config || typeof config !== 'object') return
  const nodes = collectTestNodes(config)
  const nodeTags = nodes.map((node) => node.tag)
  if (nodeTags.length === 0) return
  const inbounds = toArray(config.inbounds).filter((inbound) => inbound?.tag !== TEST_INBOUND_TAG)
  if (inbounds.some((inbound) => isInboundPortConflict(inbound, settings.testPort))) {
    Plugins.message.warn(`TCP 测速入口端口 ${settings.testPort} 已被其他入站占用，已跳过测速入口注入`)
    return
  }
  config.inbounds = inbounds
  config.outbounds = toArray(config.outbounds).filter((outbound) => outbound?.tag !== TEST_SELECTOR_TAG)
  config.inbounds.push({
    type: 'http',
    tag: TEST_INBOUND_TAG,
    listen: '127.0.0.1',
    listen_port: settings.testPort
  })
  config.outbounds.push({
    type: 'selector',
    tag: TEST_SELECTOR_TAG,
    outbounds: nodeTags,
    default: nodeTags[0],
    interrupt_exist_connections: true
  })
  if (!config.route) config.route = {}
  const rules = toArray(config.route.rules)
    .filter((rule) => !(toArray(rule?.inbound).includes(TEST_INBOUND_TAG) || rule?.inbound === TEST_INBOUND_TAG))
  config.route.rules = [
    {
      inbound: TEST_INBOUND_TAG,
      action: 'route',
      outbound: TEST_SELECTOR_TAG
    }
  ].concat(rules)
}

const isInboundPortConflict = (inbound, port) => {
  const listenPort = Number(inbound?.listen_port)
  if (!Number.isFinite(listenPort) || listenPort !== Number(port)) return false
  const listen = String(inbound?.listen || '0.0.0.0').trim().toLowerCase()
  return ['', '0.0.0.0', '::', '127.0.0.1', 'localhost'].includes(listen)
}

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

const buildChainInfo = (outbound, outboundMap) => {
  const chain = []
  const visited = new Set([outbound?.tag])
  let current = outbound
  let hasCycle = false
  let missingTag = ''
  while (current?.detour) {
    const nextTag = String(current.detour || '').trim()
    if (!nextTag) break
    chain.push(nextTag)
    if (visited.has(nextTag)) {
      hasCycle = true
      break
    }
    visited.add(nextTag)
    const nextOutbound = outboundMap.get(nextTag)
    if (!nextOutbound) {
      missingTag = nextTag
      break
    }
    current = nextOutbound
  }
  const suffix = hasCycle ? '（循环）' : missingTag ? '（缺失）' : ''
  return {
    isChained: chain.length > 0,
    chain,
    chainText: chain.length > 0 ? `${chain.join(' -> ')}${suffix}` : '',
    hasCycle,
    missingTag
  }
}

const resolveSelectedNodes = (nodes, settings) => {
  const nodeMap = new Map(nodes.map((node) => [node.tag, node]))
  const selected = new Set(settings.selectedNodeTags.filter((tag) => nodeMap.has(tag)))
  return Array.from(selected).map((tag) => nodeMap.get(tag)).filter(Boolean)
}

const createPendingResults = (nodes) => nodes.map((node) => ({
  id: Plugins.sampleID(),
  time: Date.now(),
  tag: node.tag,
  type: node.type,
  chainText: node.chainInfo?.chainText || '',
  delayUrl: '',
  speedUrl: '',
  tcpDelayMs: -1,
  speedMbps: -1,
  bytesRead: 0,
  durationMs: 0,
  status: '等待中',
  error: ''
}))

const updateRunningResult = (results, tag, patch) => {
  return results.map((item) => item.tag === tag ? { ...item, ...patch } : item)
}

const executeTests = async (sourceConfig, selectedNodes, settings, reporter = {}) => {
  let completed = 0
  const total = selectedNodes.length
  const msg = Plugins.message.info('正在连接当前核心测速入口...', 999999)
  const results = []
  try {
    reporter.onStatus?.('正在读取当前核心配置', `${total} 个节点`)
    const runtime = await resolveCurrentCoreRuntime(sourceConfig, settings)
    await ensureCurrentCoreReady(runtime)
    msg.update?.(`TCP 测试中 0 / ${total}`)
    for (const node of selectedNodes) {
      reporter.onStatus?.(`正在测试 ${node.tag}`, `${completed + 1} / ${total}`)
      reporter.onNodeStatus?.(node.tag, '切换策略组')
      await switchSpeedSelector(runtime, node.tag)
      await Plugins.sleep(200)
      const result = await testSingleNode(runtime, node, settings, reporter)
      results.push(result)
      await reporter.onResult?.(result)
      completed += 1
      msg.update?.(`TCP 测试中 ${completed} / ${total}`)
      reporter.onStatus?.(`已完成 ${completed} / ${total}`, result.error ? `${node.tag}：${result.error}` : `${node.tag}：成功`)
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

const resolveCurrentCoreRuntime = async (sourceConfig, settings) => {
  const kernelApiStore = Plugins.useKernelApiStore()
  if (!kernelApiStore.running) throw '当前核心未运行，请启动或重启核心后再测速'
  const runningConfig = await readRunningConfig()
  const clashApi = runningConfig?.experimental?.clash_api || sourceConfig?.experimental?.clash_api || {}
  const controller = normalizeController(clashApi.external_controller)
  if (!controller) throw '当前核心未启用 Clash API，无法切换测速策略组'
  return {
    baseUrl: controller,
    secret: String(clashApi.secret || ''),
    proxyUrl: `http://127.0.0.1:${settings.testPort}`
  }
}

const readRunningConfig = async () => {
  const content = await Plugins.ReadFile('data/sing-box/config.json').catch(() => '')
  if (!content) return null
  try {
    return JSON.parse(content)
  } catch {
    return null
  }
}

const normalizeController = (controller) => {
  const value = String(controller || '').trim()
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value.replace(/\/+$/, '')
  return `http://${value.replace(/\/+$/, '')}`
}

const ensureCurrentCoreReady = async (runtime) => {
  const { status, body } = await requestClashApi(runtime, 'GET', '/proxies', null, 3000)
  if (status < 200 || status >= 300) throw `当前核心 Clash API 不可用：${status}`
  const proxies = parseClashProxies(body)
  if (!Object.prototype.hasOwnProperty.call(proxies, TEST_SELECTOR_TAG)) {
    throw `当前核心未加载测速策略组 ${TEST_SELECTOR_TAG}，请保存插件设置并重启核心后再测速`
  }
}

const switchSpeedSelector = async (runtime, tag) => {
  const { status, body } = await requestClashApi(
    runtime,
    'PUT',
    `/proxies/${encodeURIComponent(TEST_SELECTOR_TAG)}`,
    { name: tag },
    3000
  )
  if (status < 200 || status >= 300) {
    throw `切换测速策略组失败：${status}${body ? ` ${String(body).slice(0, 120)}` : ''}`
  }
}

const requestClashApi = async (runtime, method, path, body = null, timeout = 3000) => {
  const headers = {}
  if (runtime.secret) headers.Authorization = `Bearer ${runtime.secret}`
  if (body !== null) headers['Content-Type'] = 'application/json'
  return await Plugins.Requests({
    method,
    url: `${runtime.baseUrl}${path}`,
    body: body === null ? undefined : JSON.stringify(body),
    autoTransformBody: false,
    headers,
    options: {
      Proxy: '',
      Timeout: timeout
    }
  })
}

const testSingleNode = async (runtime, node, settings, reporter = {}) => {
  const now = Date.now()
  const base = {
    id: Plugins.sampleID(),
    time: now,
    tag: node.tag,
    type: node.type,
    chainText: node.chainInfo?.chainText || '',
    delayUrl: settings.delayUrl,
    speedUrl: settings.speedUrl,
    tcpDelayMs: -1,
    speedMbps: -1,
    bytesRead: 0,
    durationMs: 0,
    error: ''
  }
  try {
    reporter.onStatus?.(`正在测试 ${node.tag}`, 'TCP 延迟')
    reporter.onNodeStatus?.(node.tag, 'TCP 延迟')
    const tcpDelayMs = await testTcpDelay(runtime, settings)
    reporter.onResultPatch?.(node.tag, { tcpDelayMs })
    reporter.onStatus?.(`正在测试 ${node.tag}`, `下载测速，延迟 ${tcpDelayMs} ms`)
    reporter.onNodeStatus?.(node.tag, '下载测速')
    const speed = await testDownloadSpeed(runtime.proxyUrl, settings)
    return {
      ...base,
      tcpDelayMs,
      speedMbps: speed.speedMbps,
      bytesRead: speed.bytesRead,
      durationMs: speed.durationMs
    }
  } catch (error) {
    reporter.onNodeStatus?.(node.tag, '失败')
    return {
      ...base,
      error: String(error?.message || error)
    }
  }
}

const testTcpDelay = async (runtime, settings) => {
  const url = new URL(`${runtime.baseUrl}/proxies/${encodeURIComponent(TEST_SELECTOR_TAG)}/delay`)
  url.searchParams.append('url', settings.delayUrl)
  url.searchParams.append('timeout', String(settings.delayTimeout))
  const { status, body } = await requestClashApi(runtime, 'GET', `${url.pathname}${url.search}`, null, Number(settings.delayTimeout) + 1000)
  if (status < 200 || status >= 300) {
    throw `TCP 延迟接口失败：${status}`
  }
  const delay = Number(parseJson(body)?.delay)
  if (!Number.isFinite(delay) || delay <= 0) {
    throw 'TCP 延迟测试失败'
  }
  return Math.round(delay)
}

const parseClashProxies = (body) => {
  const payload = parseJson(body)
  const proxies = payload?.proxies || payload
  return proxies && typeof proxies === 'object' ? proxies : {}
}

const parseJson = (value) => {
  if (value && typeof value === 'object') return value
  try {
    return JSON.parse(String(value || '{}'))
  } catch {
    return null
  }
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
  const bytesRead = estimateBodyBytes(body)
  const speedMbps = Number(((bytesRead * 8) / durationMs / 1000).toFixed(2))
  return {
    bytesRead,
    durationMs,
    speedMbps
  }
}

const estimateBodyBytes = (body) => {
  if (typeof body === 'string') return new TextEncoder().encode(body).length
  if (body instanceof ArrayBuffer) return body.byteLength
  if (ArrayBuffer.isView(body)) return body.byteLength
  return 0
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

const formatRunningDelay = (item) => {
  if (item.tcpDelayMs > 0) return `${item.tcpDelayMs} ms`
  if (item.status === '失败' || item.error) return '失败'
  return '-'
}

const formatRunningSpeed = (item) => {
  if (item.speedMbps > 0) return `${item.speedMbps} Mbps`
  if (item.status === '失败' || item.error) return '失败'
  return '-'
}

const formatRunningResult = (item) => {
  if (item.error) return item.error
  if (item.status === '完成') return '成功'
  return '-'
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
  onRun,
  onBeforeCoreStart
}
