const DATA_DIR = 'data/third/tcp-speed-tester'
const SETTINGS_FILE = DATA_DIR + '/settings.json'
const HISTORY_FILE = DATA_DIR + '/history.json'
const CHECK_CONFIG_FILE = DATA_DIR + '/check-config.json'
const DEFAULT_DELAY_URL = 'https://cp.cloudflare.com/generate_204'
const DEFAULT_SPEED_URL = 'https://speed.cloudflare.com/__down?bytes=25000000'
const TEST_INBOUND_TAG = '__tcp_speed_test_http__'
const LEGACY_TEST_SELECTOR_TAG = '__tcp_speed_test__'
const TEST_AUTH_USERNAME_PREFIX = '__tcp_speed_test_'
const SPEED_TEST_FILE_NAME = 'speed-test.tmp'
const SPEED_TEST_FILE = DATA_DIR + '/' + SPEED_TEST_FILE_NAME
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
  injectOnCoreStart: false,
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
  injectOnCoreStart: settings?.injectOnCoreStart === true,
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
  try {
    const settings = await loadSettingsForHook()
    if (!settings.injectOnCoreStart) return config
    const nextConfig = clone(config)
    injectCurrentCoreSpeedTest(nextConfig, settings)
    const checkResult = await checkSingBoxConfig(nextConfig)
    if (!checkResult.ok) {
      Plugins.message.warn(`TCP 延迟与测速注入已跳过：${checkResult.message}`)
      return config
    }
    return nextConfig
  } catch (error) {
    Plugins.message.warn(`TCP 延迟与测速注入已跳过：${String(error?.message || error)}`)
  }
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
    <div class="flex flex-col gap-10 pr-8" style="color: var(--color);">
      <div class="flex items-start justify-between gap-12">
        <div class="min-w-0 flex flex-col gap-4">
          <div class="font-bold text-16" style="color: var(--color);">TCP 延迟与测速 <span class="text-12 opacity-70">{{ pluginVersion }}</span></div>
          <div class="text-12 opacity-70 truncate" :title="summaryText">{{ summaryText }}</div>
          <div class="flex gap-6 text-11" style="flex-wrap: wrap;">
            <span class="rounded-4 px-8 py-3" style="border: 1px solid var(--primary-color); background: color-mix(in srgb, var(--card-bg) 84%, var(--primary-color) 16%); color: var(--primary-color);">节点 {{ preview.nodes.length }}</span>
            <span class="rounded-4 px-8 py-3" style="border: 1px solid var(--level-1-color); background: color-mix(in srgb, var(--card-bg) 88%, var(--level-1-color) 12%); color: var(--level-1-color);">已选 {{ selectedNodeCount }}</span>
            <span class="rounded-4 px-8 py-3" style="border: 1px solid var(--divider-color); background: var(--card-hover-bg); color: var(--card-color);">入口 127.0.0.1:{{ settings.testPort }}</span>
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
              <div class="font-bold text-13" style="color: var(--color);">测试地址</div>
              <div class="grid items-center gap-8" style="grid-template-columns: 76px minmax(0, 1fr);">
                <div class="text-12 opacity-70">延迟</div>
                <Input v-model="settings.delayUrl" allow-paste :disabled="running" />
                <div class="text-12 opacity-70">测速</div>
                <Input v-model="settings.speedUrl" allow-paste :disabled="running" />
              </div>
            </div>
            <div class="flex flex-col gap-8">
              <div class="font-bold text-13" style="color: var(--color);">运行参数</div>
              <div class="grid items-center gap-8" style="grid-template-columns: 96px minmax(0, 1fr);">
                <div class="text-12 opacity-70">延迟超时</div>
                <Input v-model="settings.delayTimeout" type="number" editable :disabled="running" />
                <div class="text-12 opacity-70">测速超时</div>
                <Input v-model="settings.speedTimeout" type="number" editable :disabled="running" />
                <div class="text-12 opacity-70">启动注入</div>
                <Switch v-model="settings.injectOnCoreStart" :disabled="running">启用</Switch>
                <div class="text-12 opacity-70">入口端口</div>
                <Input v-model="settings.testPort" type="number" editable :disabled="running" />
                <div class="text-12 opacity-70">历史保留</div>
                <Input v-model="settings.historyLimit" type="number" editable :disabled="running" />
              </div>
            </div>
          </div>
          <div class="rounded-4 p-8 text-12" style="border: 1px solid var(--primary-color); background: color-mix(in srgb, var(--card-bg) 88%, var(--primary-color) 12%); color: var(--color);">
            开启启动注入后，插件会在核心启动前注入 HTTP 测速入站 <b>{{ speedInboundText }}</b>，并按内部认证用户把测速请求直接路由到对应节点，不会新增可见策略组。默认不注入，避免启用插件本身影响核心启动；修改开关、端口或节点订阅后需要重启核心生效。
          </div>
        </div>
      </Card>

      <Card>
        <div class="flex items-center justify-between gap-10 mb-8">
          <div>
            <div class="font-bold text-14" style="color: var(--color);">节点</div>
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
                <div v-if="node.chainInfo.isChained" class="text-11 mt-4" style="color: var(--level-1-color);">
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
              <tr style="border-bottom: 1px solid var(--divider-color);">
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
              <tr v-for="item in runningResults" :key="item.id" style="border-bottom: 1px solid var(--divider-color);">
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
              <tr style="border-bottom: 1px solid var(--divider-color);">
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
              <tr v-for="item in history" :key="item.id" style="border-bottom: 1px solid var(--divider-color);">
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
        if (selected) return 'border: 1px solid var(--primary-color); background: color-mix(in srgb, var(--card-bg) 82%, var(--primary-color) 18%); color: var(--color);'
        if (node.chainInfo?.isChained) return 'border: 1px solid var(--level-1-color); background: color-mix(in srgb, var(--card-bg) 88%, var(--level-1-color) 12%); color: var(--color);'
        return 'border: 1px solid var(--divider-color); background: var(--card-bg); color: var(--color);'
      }
      const runTests = async () => {
        if (running.value) return
        await persistSettings()
        preview.value = await buildPreviewContext(settings.value)
        if (preview.value.selectedNodes.length === 0) {
          Plugins.message.warn('请至少选择一个节点')
          return
        }
        if (!settings.value.injectOnCoreStart) {
          Plugins.message.warn('请先开启启动注入并重启核心后再测速')
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
  const inbounds = toArray(config.inbounds).filter((inbound) => inbound?.tag !== TEST_INBOUND_TAG)
  const rules = toArray(config?.route?.rules)
    .filter((rule) => !toArray(rule?.inbound).includes(TEST_INBOUND_TAG))
  config.inbounds = inbounds
  config.outbounds = toArray(config.outbounds).filter((outbound) => outbound?.tag !== LEGACY_TEST_SELECTOR_TAG)
  if (config.route?.rules) config.route.rules = rules

  const nodes = collectTestNodes(config)
  if (nodes.length === 0) return
  if (inbounds.some((inbound) => isInboundPortConflict(inbound, settings.testPort))) {
    Plugins.message.warn(`TCP 测速入口端口 ${settings.testPort} 已被其他入站占用，已跳过测速入口注入`)
    return
  }
  const credentials = buildSpeedTestCredentials(nodes)
  config.inbounds.push({
    type: 'http',
    tag: TEST_INBOUND_TAG,
    listen: '127.0.0.1',
    listen_port: settings.testPort,
    users: credentials.map(({ username, password }) => ({ username, password }))
  })
  if (!config.route) config.route = {}
  const speedTestRules = credentials.map(({ tag, username }) => ({
    inbound: TEST_INBOUND_TAG,
    auth_user: username,
    action: 'route',
    outbound: tag
  }))
  config.route.rules = speedTestRules.concat(rules)
}

const buildSpeedTestCredentials = (nodes) => {
  const password = `${Plugin.id}-${Plugins.sampleID()}`
  return nodes.map((node, index) => ({
    tag: node.tag,
    username: `${TEST_AUTH_USERNAME_PREFIX}${String(index + 1).padStart(4, '0')}`,
    password
  }))
}

const checkSingBoxConfig = async (config) => {
  await ensureDataDir()
  await Plugins.WriteFile(CHECK_CONFIG_FILE, JSON.stringify(config, null, 2))
  try {
    const appSettingsStore = Plugins.useAppSettingsStore()
    const branch = appSettingsStore.app?.kernel?.branch
    const kernelFileName = await Plugins.getKernelFileName(branch !== 'main')
    const kernelFilePath = await Plugins.AbsolutePath('data/sing-box/' + kernelFileName)
    const workingDirectory = await Plugins.AbsolutePath('data/sing-box')
    await Plugins.Exec(kernelFilePath, ['check', '-D', workingDirectory, '-c', await Plugins.AbsolutePath(CHECK_CONFIG_FILE)])
    return { ok: true, message: '' }
  } catch (error) {
    return {
      ok: false,
      message: normalizeCheckError(error)
    }
  }
}

const normalizeCheckError = (error) => {
  const text = String(error?.message || error || '').trim()
  if (!text) return 'sing-box 配置检查失败'
  return text.replace(/\u001b\[[0-9;]*m/g, '').split('\n').slice(0, 3).join(' ')
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
    await ensureCurrentCoreReady(runtime, selectedNodes)
    msg.update?.(`TCP 测试中 0 / ${total}`)
    for (const node of selectedNodes) {
      reporter.onStatus?.(`正在测试 ${node.tag}`, `${completed + 1} / ${total}`)
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
  if (!runningConfig) throw '无法读取当前核心运行配置，请重启核心后再测速'
  const clashApi = runningConfig?.experimental?.clash_api || sourceConfig?.experimental?.clash_api || {}
  const controller = normalizeController(clashApi.external_controller)
  if (!controller) throw '当前核心未启用 Clash API，无法测试节点延迟'
  const speedTestRoute = resolveSpeedTestRoute(runningConfig)
  if (speedTestRoute.port !== Number(settings.testPort)) {
    throw `当前核心测速入口端口为 ${speedTestRoute.port}，与插件设置 ${settings.testPort} 不一致，请重启核心后再测速`
  }
  return {
    baseUrl: controller,
    secret: String(clashApi.secret || ''),
    proxyOrigin: `http://127.0.0.1:${speedTestRoute.port}`,
    credentialByTag: speedTestRoute.credentialByTag
  }
}

const resolveSpeedTestRoute = (config) => {
  const inbound = toArray(config?.inbounds).find((item) => item?.tag === TEST_INBOUND_TAG && item?.type === 'http')
  if (!inbound) {
    throw `当前核心未加载测速入口 ${TEST_INBOUND_TAG}，请保存插件设置并重启核心后再测速`
  }
  const port = Number(inbound.listen_port)
  if (!Number.isInteger(port) || port <= 0) {
    throw `当前核心测速入口 ${TEST_INBOUND_TAG} 端口无效`
  }
  const usersByName = new Map(
    toArray(inbound.users)
      .filter((user) => String(user?.username || '').trim())
      .map((user) => [String(user.username), {
        username: String(user.username),
        password: String(user.password || '')
      }])
  )
  const credentialByTag = new Map()
  for (const rule of toArray(config?.route?.rules)) {
    if (!toArray(rule?.inbound).includes(TEST_INBOUND_TAG) || !rule?.outbound) continue
    for (const username of toArray(rule.auth_user).map((item) => String(item || ''))) {
      const credential = usersByName.get(username)
      if (credential) credentialByTag.set(String(rule.outbound), credential)
    }
  }
  return { port, credentialByTag }
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

const ensureCurrentCoreReady = async (runtime, selectedNodes) => {
  const { status, body } = await requestClashApi(runtime, '/proxies', 3000)
  if (status < 200 || status >= 300) throw `当前核心 Clash API 不可用：${status}`
  const proxies = parseClashProxies(body)
  const missingProxyTags = selectedNodes
    .map((node) => node.tag)
    .filter((tag) => !Object.prototype.hasOwnProperty.call(proxies, tag))
  if (missingProxyTags.length > 0) {
    throw `当前核心缺少待测节点：${formatLimitedTags(missingProxyTags)}`
  }
  const missingRouteTags = selectedNodes
    .map((node) => node.tag)
    .filter((tag) => !runtime.credentialByTag.has(tag))
  if (missingRouteTags.length > 0) {
    throw `当前核心缺少待测节点认证路由：${formatLimitedTags(missingRouteTags)}，请重启核心后再测速`
  }
}

const formatLimitedTags = (tags) => {
  const visibleTags = tags.slice(0, 5)
  const suffix = tags.length > visibleTags.length ? ` 等 ${tags.length} 个` : ''
  return `${visibleTags.join('、')}${suffix}`
}

const requestClashApi = async (runtime, path, timeout = 3000) => {
  const headers = {}
  if (runtime.secret) headers.Authorization = `Bearer ${runtime.secret}`
  const url = `${runtime.baseUrl}${path}`
  return await Plugins.Requests({
    method: 'GET',
    url,
    autoTransformBody: false,
    headers,
    options: {
      Proxy: '',
      Timeout: toRequestTimeoutSeconds(timeout)
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
    const tcpDelayMs = await testTcpDelay(runtime, node.tag, settings)
    reporter.onResultPatch?.(node.tag, { tcpDelayMs })
    reporter.onStatus?.(`正在测试 ${node.tag}`, `下载测速，延迟 ${tcpDelayMs} ms`)
    reporter.onNodeStatus?.(node.tag, '下载测速')
    const speed = await testDownloadSpeed(buildNodeProxyUrl(runtime, node.tag), settings)
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

const buildNodeProxyUrl = (runtime, tag) => {
  const credential = runtime.credentialByTag.get(tag)
  if (!credential) throw `节点 ${tag} 缺少测速认证路由`
  const proxyUrl = new URL(runtime.proxyOrigin)
  proxyUrl.username = credential.username
  proxyUrl.password = credential.password
  return proxyUrl.toString()
}

const testTcpDelay = async (runtime, tag, settings) => {
  const url = new URL(`${runtime.baseUrl}/proxies/${encodeURIComponent(tag)}/delay`)
  url.searchParams.append('url', settings.delayUrl)
  url.searchParams.append('timeout', String(settings.delayTimeout))
  const { status, body } = await requestClashApi(runtime, `${url.pathname}${url.search}`, Number(settings.delayTimeout) + 1000)
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
  await ensureDataDir()
  await Plugins.RemoveFile(SPEED_TEST_FILE).catch(() => {})
  const startedAt = Date.now()
  try {
    const { status } = await Plugins.Download(
      settings.speedUrl,
      SPEED_TEST_FILE,
      {},
      undefined,
      {
        Proxy: proxyUrl,
        Timeout: toRequestTimeoutSeconds(settings.speedTimeout)
      }
    )
    if (status < 200 || status >= 300) {
      throw `测速下载失败：${status}`
    }
    const bytesRead = await readSpeedTestFileSize()
    if (bytesRead <= 0) throw '测速下载未返回有效数据'
    const durationMs = Math.max(Date.now() - startedAt, 1)
    const speedMbps = Number(((bytesRead * 8) / durationMs / 1000).toFixed(2))
    return {
      bytesRead,
      durationMs,
      speedMbps
    }
  } finally {
    await Plugins.RemoveFile(SPEED_TEST_FILE).catch(() => {})
  }
}

const readSpeedTestFileSize = async () => {
  const files = await Plugins.ReadDir(DATA_DIR)
  const file = files.find((item) => item?.name === SPEED_TEST_FILE_NAME && !item.isDir)
  const size = Number(file?.size)
  return Number.isFinite(size) && size > 0 ? size : 0
}

const toRequestTimeoutSeconds = (milliseconds) => {
  const value = Number(milliseconds)
  if (!Number.isFinite(value) || value <= 0) return 1
  return Math.max(1, Math.ceil(value / 1000))
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
