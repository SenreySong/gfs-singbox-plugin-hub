const DATA_DIR = 'data/third/outbound-dns-resolver'
const CONFIG_FILE = DATA_DIR + '/rules.json'
const DEFAULT_RULES = [
  {
    id: 'default-cloud-nodes',
    name: 'cloud-nodes.com 使用 Oix',
    enabled: true,
    matchMode: 'server_suffix',
    pattern: 'cloud-nodes.com',
    resolver: 'Oix'
  }
]
const DEFAULT_FALLBACK = {
  enabled: true,
  resolver: 'AliYun'
}
const EXCLUDED_FALLBACK_OUTBOUND_TYPES = new Set(['block', 'direct', 'dns', 'selector', 'urltest'])
const MATCH_MODE_OPTIONS = [
  '出站标签包含,tag_contains',
  '出站标签正则,tag_regex',
  '服务器后缀,server_suffix',
  '服务器正则,server_regex',
  '出站类型,type'
]

const initState = () => {
  window[Plugin.id] = window[Plugin.id] || {}
  if (!window[Plugin.id].rules) {
    window[Plugin.id].rules = Vue.ref([])
  }
  if (!window[Plugin.id].fallback) {
    window[Plugin.id].fallback = Vue.ref({ ...DEFAULT_FALLBACK })
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
  if (!(await Plugins.FileExists(CONFIG_FILE).catch(() => false))) {
    await Plugins.WriteFile(CONFIG_FILE, JSON.stringify(createDefaultPluginConfig(), null, 2))
  }
}

const createDefaultPluginConfig = () => ({
  rules: DEFAULT_RULES,
  fallback: DEFAULT_FALLBACK
})

const normalizeRules = (rules) => {
  const seen = new Set()
  return (Array.isArray(rules) ? rules : [])
    .map((rule) => ({
      id: String(rule?.id || Plugins.sampleID()),
      name: String(rule?.name || '').trim(),
      enabled: rule?.enabled !== false,
      matchMode: normalizeMatchMode(rule?.matchMode),
      pattern: String(rule?.pattern || '').trim(),
      resolver: String(rule?.resolver || '').trim()
    }))
    .filter((rule) => {
      if (!rule.pattern || !rule.resolver) return false
      if (seen.has(rule.id)) return false
      seen.add(rule.id)
      return true
    })
}

const normalizeMatchMode = (matchMode) => {
  const value = String(matchMode || '')
  if (['tag_contains', 'tag_regex', 'server_suffix', 'server_regex', 'type'].includes(value)) {
    return value
  }
  return 'server_suffix'
}

const normalizeFallback = (fallback) => ({
  enabled: fallback?.enabled !== false,
  resolver: String(fallback?.resolver || DEFAULT_FALLBACK.resolver).trim()
})

const normalizePluginConfig = (config) => {
  if (Array.isArray(config)) {
    return {
      rules: normalizeRules(config.length ? config : DEFAULT_RULES),
      fallback: normalizeFallback(DEFAULT_FALLBACK)
    }
  }

  return {
    rules: normalizeRules(Array.isArray(config?.rules) ? config.rules : DEFAULT_RULES),
    fallback: normalizeFallback(config?.fallback)
  }
}

const readPluginConfig = async () => {
  await ensureDataFile()
  const content = await Plugins.ReadFile(CONFIG_FILE).catch(() => '[]')
  try {
    const parsed = JSON.parse(content)
    return normalizePluginConfig(parsed)
  } catch {
    return normalizePluginConfig(createDefaultPluginConfig())
  }
}

const savePluginConfig = async (rules, fallback) => {
  await ensureDataFile()
  await Plugins.WriteFile(CONFIG_FILE, JSON.stringify({
    rules: normalizeRules(rules),
    fallback: normalizeFallback(fallback)
  }, null, 2))
}

const loadPluginConfig = async () => {
  if (!getState().loaded) {
    const config = await readPluginConfig()
    getState().rules.value = config.rules
    getState().fallback.value = config.fallback
    getState().loaded = true
  }
  return {
    rules: getState().rules.value,
    fallback: getState().fallback.value
  }
}

const onReady = async () => {
  await loadPluginConfig()
}

const onRun = async () => {
  await openManager()
}

const onBeforeCoreStart = async (config) => {
  if (!Array.isArray(config?.outbounds)) return config
  const pluginConfig = await loadPluginConfig()
  const rules = pluginConfig.rules.filter((rule) => rule.enabled)
  const fallback = normalizeFallback(pluginConfig.fallback)
  const dnsServerTags = getDnsServerTags(config)
  const missingResolvers = new Set()

  for (const outbound of config.outbounds) {
    if (!outbound?.tag) continue
    const matchedRule = rules.find((rule) => matchRule(outbound, rule))
    if (!matchedRule) continue
    if (!dnsServerTags.has(matchedRule.resolver)) {
      missingResolvers.add(matchedRule.resolver)
      continue
    }
    outbound.domain_resolver = matchedRule.resolver
  }

  applyFallbackDomainResolver(config, fallback, dnsServerTags, missingResolvers)

  if (missingResolvers.size > 0) {
    Plugins.message.warn(`出站 DNS 解析器跳过了不存在的 DNS 服务：${Array.from(missingResolvers).join('、')}`)
  }

  return config
}

const applyFallbackDomainResolver = (config, fallback, dnsServerTags, missingResolvers) => {
  if (!fallback.enabled || !fallback.resolver) return
  if (!dnsServerTags.has(fallback.resolver)) {
    missingResolvers.add(fallback.resolver)
    return
  }

  for (const outbound of config.outbounds) {
    if (!isFallbackCandidateOutbound(outbound)) continue
    if (outbound.domain_resolver) continue
    if (!isDomainServer(outbound.server)) continue
    outbound.domain_resolver = fallback.resolver
  }
}

const getDnsServerTags = (config) => {
  return new Set((config?.dns?.servers || []).map((server) => server?.tag).filter(Boolean))
}

const normalizeHost = (server) => {
  if (typeof server !== 'string') return ''
  let host = server.trim().toLowerCase()
  if (!host) return ''
  if (host.includes('://')) {
    try {
      host = new URL(host).hostname.toLowerCase()
    } catch {}
  }
  if (host.startsWith('[') && host.includes(']')) {
    host = host.slice(1, host.indexOf(']'))
  }
  if (host.endsWith('.')) {
    host = host.slice(0, -1)
  }
  const colonIndex = host.lastIndexOf(':')
  if (colonIndex > -1 && host.indexOf(':') === colonIndex) {
    host = host.slice(0, colonIndex)
  }
  return host
}

const isFallbackCandidateOutbound = (outbound) => {
  if (!outbound?.tag) return false
  const type = String(outbound.type || '').toLowerCase()
  return !EXCLUDED_FALLBACK_OUTBOUND_TYPES.has(type)
}

const isDomainServer = (server) => {
  const host = normalizeHost(server)
  if (!host) return false
  if (isIpAddress(host)) return false
  return /[a-z]/i.test(host)
}

const isIpAddress = (host) => {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return host.split('.').every((part) => {
      const value = Number(part)
      return Number.isInteger(value) && value >= 0 && value <= 255
    })
  }

  if (!host.includes(':')) return false
  return /^[0-9a-f:]+$/i.test(host)
}

const matchRule = (outbound, rule) => {
  const pattern = String(rule.pattern || '').trim()
  if (!pattern) return false

  if (rule.matchMode === 'tag_contains') {
    return String(outbound.tag || '').toLowerCase().includes(pattern.toLowerCase())
  }

  if (rule.matchMode === 'tag_regex') {
    return safeRegexTest(pattern, String(outbound.tag || ''))
  }

  if (rule.matchMode === 'server_suffix') {
    const host = normalizeHost(outbound.server)
    const suffix = normalizeHost(pattern)
    return Boolean(host && suffix && (host === suffix || host.endsWith(`.${suffix}`)))
  }

  if (rule.matchMode === 'server_regex') {
    return safeRegexTest(pattern, String(outbound.server || ''))
  }

  if (rule.matchMode === 'type') {
    return String(outbound.type || '').toLowerCase() === pattern.toLowerCase()
  }

  return false
}

const safeRegexTest = (pattern, value) => {
  try {
    return new RegExp(pattern, 'i').test(value)
  } catch {
    return false
  }
}

const getCurrentProfile = () => {
  const profilesStore = Plugins.useProfilesStore()
  const appSettingsStore = Plugins.useAppSettingsStore()
  const profiles = profilesStore.profiles || []
  const currentProfileId = appSettingsStore.app?.kernel?.profile
  return profiles.find((profile) => profile.id === currentProfileId) || profilesStore.currentProfile || profiles[0]
}

const loadPreviewContext = async () => {
  const profile = getCurrentProfile()
  if (!profile) {
    return {
      profileName: '',
      dnsServerTags: [],
      outboundTags: [],
      outboundTypes: []
    }
  }

  const generatedConfig = await Plugins.generateConfig(profile, { enablePluginProcessing: false }).catch(() => null)
  return {
    profileName: profile.name || '',
    dnsServerTags: Array.from(getDnsServerTags(generatedConfig || {})).sort((a, b) => a.localeCompare(b)),
    outboundTags: (generatedConfig?.outbounds || []).map((outbound) => outbound.tag).filter(Boolean),
    outboundTypes: Array.from(new Set((generatedConfig?.outbounds || []).map((outbound) => outbound.type).filter(Boolean))).sort()
  }
}

const openManager = async () => {
  const { ref, h } = Vue
  const pluginConfig = await loadPluginConfig()
  const rules = ref(normalizeRules(pluginConfig.rules))
  const fallback = ref(normalizeFallback(pluginConfig.fallback))
  const preview = ref(await loadPreviewContext())

  const component = {
    template: `
    <div class="flex flex-col gap-10 pr-8">
      <div class="flex items-center justify-between gap-8">
        <div class="min-w-0">
          <div class="font-bold text-16">出站 DNS 解析器 <span class="text-12 opacity-70">{{ pluginVersion }}</span></div>
          <div class="text-12 opacity-70 truncate" :title="previewText">{{ previewText }}</div>
        </div>
        <div class="flex gap-8">
          <Button @click="addRule">新增规则</Button>
          <Button type="primary" @click="save">保存</Button>
        </div>
      </div>

      <Card>
        <div class="grid items-center gap-8" style="grid-template-columns: 120px 120px 120px minmax(160px, 1fr);">
          <div class="font-bold text-13">域名出站默认 DNS</div>
          <Switch v-model="fallback.enabled">启用</Switch>
          <div class="font-bold text-13">DNS 服务</div>
          <select v-model="fallback.resolver" class="gfs-native-input">
            <option value="" disabled>请选择 DNS 服务</option>
            <option v-for="tag in dnsServerTags" :key="tag" :value="tag">{{ tag }}</option>
          </select>
        </div>
      </Card>

      <Card>
        <div class="flex flex-col gap-8" style="max-height: 540px; overflow: auto;">
          <div
            v-for="(rule, index) in rules"
            :key="rule.id"
            class="grid items-center gap-8 rounded-4 p-8"
            style="grid-template-columns: 70px minmax(120px, 1fr) 150px minmax(140px, 1fr) minmax(120px, 160px) 136px; border: 1px solid #cbd5e1; background: #f8fafc;"
          >
            <Switch v-model="rule.enabled">启用</Switch>
            <Input v-model="rule.name" placeholder="规则名称" allow-paste />
            <select v-model="rule.matchMode" class="gfs-native-input">
              <option v-for="option in matchModeOptions" :key="getOptionValue(option)" :value="getOptionValue(option)">
                {{ getOptionLabel(option) }}
              </option>
            </select>
            <Input v-model="rule.pattern" placeholder="匹配内容" allow-paste />
            <select v-model="rule.resolver" class="gfs-native-input">
              <option value="" disabled>请选择 DNS 服务</option>
              <option v-for="tag in dnsServerTags" :key="tag" :value="tag">{{ tag }}</option>
            </select>
            <div class="flex gap-4 justify-end">
              <Button @click="moveUp(index)" :disabled="index === 0">上移</Button>
              <Button @click="moveDown(index)" :disabled="index === rules.length - 1">下移</Button>
              <Button type="text" @click="removeRule(index)">删除</Button>
            </div>
          </div>
          <div v-if="rules.length === 0" class="flex items-center justify-center min-h-[120px] border border-dashed rounded-4">
            <div class="text-12 opacity-70">暂无规则</div>
          </div>
        </div>
      </Card>

      <Card>
        <div class="grid gap-8" style="grid-template-columns: 1fr 1fr;">
          <div>
            <div class="font-bold text-13 mb-4">当前配置 DNS 服务</div>
            <div class="text-12 opacity-75" style="word-break: break-word;">{{ dnsServerText }}</div>
          </div>
          <div>
            <div class="font-bold text-13 mb-4">当前配置出站类型</div>
            <div class="text-12 opacity-75" style="word-break: break-word;">{{ outboundTypeText }}</div>
          </div>
        </div>
      </Card>
    </div>
    `,
    setup() {
      const getOptionLabel = (option) => String(option).split(',')[0]
      const getOptionValue = (option) => String(option).split(',')[1]
      const addRule = () => {
        rules.value.push({
          id: Plugins.sampleID(),
          name: '',
          enabled: true,
          matchMode: 'server_suffix',
          pattern: '',
          resolver: preview.value.dnsServerTags[0] || ''
        })
      }
      const removeRule = (index) => {
        rules.value.splice(index, 1)
      }
      const moveUp = (index) => {
        if (index <= 0) return
        const item = rules.value.splice(index, 1)[0]
        rules.value.splice(index - 1, 0, item)
      }
      const moveDown = (index) => {
        if (index >= rules.value.length - 1) return
        const item = rules.value.splice(index, 1)[0]
        rules.value.splice(index + 1, 0, item)
      }
      const save = async () => {
        const normalized = normalizeRules(rules.value)
        const normalizedFallback = normalizeFallback(fallback.value)
        validateRules(normalized)
        validateFallback(normalizedFallback)
        getState().rules.value = normalized
        getState().fallback.value = normalizedFallback
        await savePluginConfig(normalized, normalizedFallback)
        await restartCoreIfRunning()
        modal.close()
      }

      return {
        pluginVersion: Plugin.version || '',
        rules,
        fallback,
        matchModeOptions: MATCH_MODE_OPTIONS,
        previewText: Vue.computed(() => preview.value.profileName ? `预览配置：${preview.value.profileName}` : '未找到可预览配置'),
        dnsServerTags: Vue.computed(() => preview.value.dnsServerTags),
        dnsServerText: Vue.computed(() => preview.value.dnsServerTags.join('、') || '未读取到 DNS 服务'),
        outboundTypeText: Vue.computed(() => preview.value.outboundTypes.join('、') || '未读取到出站类型'),
        getOptionLabel,
        getOptionValue,
        addRule,
        removeRule,
        moveUp,
        moveDown,
        save
      }
    }
  }

  const modal = Plugins.modal(
    {
      title: '出站 DNS 解析器',
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

const validateRules = (rules) => {
  for (const rule of rules) {
    if (!rule.pattern) throw '匹配内容不能为空'
    if (!rule.resolver) throw 'DNS 服务 tag 不能为空'
    if (['tag_regex', 'server_regex'].includes(rule.matchMode)) {
      try {
        new RegExp(rule.pattern)
      } catch (error) {
        throw `规则「${rule.name || rule.pattern}」的正则无效：${error.message || error}`
      }
    }
  }
}

const validateFallback = (fallback) => {
  if (fallback.enabled && !fallback.resolver) {
    throw '域名出站默认 DNS 服务不能为空'
  }
}

const restartCoreIfRunning = async () => {
  const kernelApiStore = Plugins.useKernelApiStore()
  if (!kernelApiStore.running) {
    Plugins.message.success('出站 DNS 规则已保存，启动核心后生效')
    return
  }
  Plugins.message.info('出站 DNS 规则已保存，正在重启核心...')
  await kernelApiStore.restartCore()
  Plugins.message.success('核心已重启，出站 DNS 规则已生效')
}

export default {
  onReady,
  onRun,
  onBeforeCoreStart
}
