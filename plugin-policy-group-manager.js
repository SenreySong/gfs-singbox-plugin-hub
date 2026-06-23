const DATA_DIR = 'data/third/policy-group-manager'
const CONFIG_FILE = DATA_DIR + '/settings.json'
const DEFAULT_OTHER_GROUP_TAG = '🌐 Other Group'
const DEFAULT_GROUPS = [
  {
    id: 'group-hk',
    enabled: true,
    tag: '🇭🇰 HK Group',
    name: '香港',
    pattern: '(?:🇭🇰|(?:^|[^A-Z])HK\\d*|Hong\\s*Kong|HongKong|香港)',
    extraPattern: ''
  },
  {
    id: 'group-tw',
    enabled: true,
    tag: '🇹🇼 TW Group',
    name: '台湾',
    pattern: '(?:🇹🇼|(?:^|[^A-Z])TW\\d*|Taiwan|台湾|台灣)',
    extraPattern: 'CN2|CFT'
  },
  {
    id: 'group-jp',
    enabled: true,
    tag: '🇯🇵 JP Group',
    name: '日本',
    pattern: '(?:🇯🇵|(?:^|[^A-Z])JP\\d*|Japan|日本)',
    extraPattern: ''
  },
  {
    id: 'group-us',
    enabled: true,
    tag: '🇺🇸 US Group',
    name: '美国',
    pattern: '(?:🇺🇸|(?:^|[^A-Z])US\\d*|United\\s*States|America|美国|美國)',
    extraPattern: ''
  },
  {
    id: 'group-au',
    enabled: true,
    tag: '🇦🇺 AU Group',
    name: '澳大利亚',
    pattern: '(?:🇦🇺|(?:^|[^A-Z])AU\\d*|Australia|澳大利亚|澳洲)',
    extraPattern: ''
  },
  {
    id: 'group-de',
    enabled: true,
    tag: '🇩🇪 DE Group',
    name: '德国',
    pattern: '(?:🇩🇪|(?:^|[^A-Z])DE\\d*|Germany|德国|德國)',
    extraPattern: ''
  }
]
const DEFAULT_SETTINGS = {
  enabled: true,
  insertPosition: 'before',
  skipHiddenSelectors: true,
  otherGroupEnabled: true,
  otherGroupTag: DEFAULT_OTHER_GROUP_TAG,
  groups: DEFAULT_GROUPS,
  managedGroupTags: DEFAULT_GROUPS.map((group) => group.tag).concat(DEFAULT_OTHER_GROUP_TAG)
}
const BASE_MANAGED_GROUP_TAGS = new Set(DEFAULT_GROUPS.map((group) => group.tag).concat(DEFAULT_OTHER_GROUP_TAG))
const EXCLUDED_TYPES = new Set(['selector', 'urltest', 'direct', 'block', 'dns'])

const initState = () => {
  window[Plugin.id] = window[Plugin.id] || {}
  if (!window[Plugin.id].settings) {
    window[Plugin.id].settings = Vue.ref({ ...DEFAULT_SETTINGS })
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
    await Plugins.WriteFile(CONFIG_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2))
  }
}

const normalizeSettings = (settings) => {
  const insertPosition = settings?.insertPosition === 'after' ? 'after' : 'before'
  const groups = Array.isArray(settings?.groups) && settings.groups.length > 0
    ? settings.groups
    : migrateLegacyGroups(settings)
  return {
    enabled: settings?.enabled !== false,
    insertPosition,
    skipHiddenSelectors: settings?.skipHiddenSelectors !== false,
    otherGroupEnabled: settings?.otherGroupEnabled !== false,
    otherGroupTag: String(settings?.otherGroupTag || DEFAULT_OTHER_GROUP_TAG).trim(),
    groups: normalizeGroupRules(groups),
    managedGroupTags: normalizeManagedGroupTags(settings, groups)
  }
}

const normalizeManagedGroupTags = (settings, groups) => {
  return unique(
    []
      .concat(Array.isArray(settings?.managedGroupTags) ? settings.managedGroupTags : [])
      .concat(Array.from(BASE_MANAGED_GROUP_TAGS))
      .concat((groups || []).map((group) => group?.tag))
      .concat(settings?.otherGroupTag || DEFAULT_OTHER_GROUP_TAG)
      .map((tag) => String(tag || '').trim())
  )
}

const migrateLegacyGroups = (settings) => {
  const taiwanPattern = String(settings?.taiwanPattern || '').trim()
  return clone(DEFAULT_GROUPS).map((group) => {
    if (group.id === 'group-tw' && taiwanPattern) {
      return {
        ...group,
        extraPattern: taiwanPattern
      }
    }
    return group
  })
}

const normalizeGroupRules = (groups) => {
  const seenIds = new Set()
  const seenTags = new Set()
  return (Array.isArray(groups) ? groups : [])
    .map((group) => ({
      id: String(group?.id || Plugins.sampleID()),
      enabled: group?.enabled !== false,
      tag: String(group?.tag || '').trim(),
      name: String(group?.name || '').trim(),
      pattern: String(group?.pattern || '').trim(),
      extraPattern: String(group?.extraPattern || '').trim()
    }))
    .filter((group) => {
      if (!group.tag || !group.pattern) return false
      if (seenIds.has(group.id)) return false
      if (seenTags.has(group.tag)) return false
      seenIds.add(group.id)
      seenTags.add(group.tag)
      return true
    })
}

const clone = (value) => JSON.parse(JSON.stringify(value))

const readSettings = async () => {
  await ensureDataFile()
  const content = await Plugins.ReadFile(CONFIG_FILE).catch(() => '{}')
  try {
    return normalizeSettings(JSON.parse(content))
  } catch {
    return normalizeSettings(DEFAULT_SETTINGS)
  }
}

const saveSettings = async (settings) => {
  await ensureDataFile()
  await Plugins.WriteFile(CONFIG_FILE, JSON.stringify(normalizeSettings(settings), null, 2))
}

const loadSettings = async () => {
  if (!getState().loaded) {
    getState().settings.value = await readSettings()
    getState().loaded = true
  }
  return getState().settings.value
}

const onReady = async () => {
  await loadSettings()
}

const onRun = async () => {
  await openManager()
}

const onBeforeCoreStart = async (config, profile) => {
  const settings = await loadSettings()
  if (!settings.enabled) return config
  if (!Array.isArray(config?.outbounds)) return config

  applyPolicyGroups(config, profile, settings)
  return config
}

const applyPolicyGroups = (config, profile, settings) => {
  const normalizedSettings = normalizeSettings(settings)
  const nodes = config.outbounds.filter(isRealNode)
  const realNodeTags = new Set(nodes.map((node) => node.tag))
  const groupRules = normalizedSettings.groups
    .filter((group) => group.enabled)
    .filter((group) => !realNodeTags.has(group.tag))
  const effectiveSettings = {
    ...normalizedSettings,
    otherGroupEnabled: normalizedSettings.otherGroupEnabled && !realNodeTags.has(normalizedSettings.otherGroupTag)
  }
  const generatedGroupTags = getManagedGroupTags(normalizedSettings)
  realNodeTags.forEach((tag) => generatedGroupTags.delete(tag))
  const { selectors, matchedNodeTags } = buildGroupSelectors(nodes, groupRules, effectiveSettings)
  const availableGroupTags = selectors.map((group) => group.tag)

  config.outbounds = config.outbounds.filter((outbound) => !generatedGroupTags.has(outbound.tag))
  config.outbounds.unshift(...selectors)

  const hiddenSelectorTags = getHiddenSelectorTags(profile)
  for (const selector of config.outbounds.filter((outbound) => shouldPatchSelector(outbound, generatedGroupTags, hiddenSelectorTags, effectiveSettings))) {
    const retainedOutbounds = (selector.outbounds || []).filter((tag) => !generatedGroupTags.has(tag))
    selector.outbounds = normalizedSettings.insertPosition === 'after'
      ? unique([...retainedOutbounds, ...availableGroupTags])
      : unique([...availableGroupTags, ...retainedOutbounds])
  }

  cleanupMissingSelectorReferences(config)
  return { selectors, matchedNodeTags }
}

const buildGroupSelectors = (nodes, groupRules, settings) => {
  const groupedNodeTags = new Map(groupRules.map((group) => [group.tag, []]))
  const matchedNodeTags = new Set()
  const groupTags = new Set(groupRules.map((group) => group.tag))

  for (const node of nodes) {
    const matchedGroup = groupRules.find((group) => matchGroupPattern(node.tag, group))
    if (!matchedGroup) continue
    matchedNodeTags.add(node.tag)
    if (!matchGroupExtraPattern(node.tag, matchedGroup)) continue
    groupedNodeTags.get(matchedGroup.tag).push(node.tag)
  }

  const selectors = groupRules.flatMap((group) => {
    const outbounds = unique(groupedNodeTags.get(group.tag) || [])
    if (outbounds.length === 0) return []
    return [buildSelector(group.tag, outbounds)]
  })

  if (settings.otherGroupEnabled && settings.otherGroupTag && !groupTags.has(settings.otherGroupTag)) {
    const otherNodes = nodes
      .filter((node) => !matchedNodeTags.has(node.tag))
      .map((node) => node.tag)
    if (otherNodes.length > 0) {
      selectors.push(buildSelector(settings.otherGroupTag, otherNodes))
    }
  }

  return { selectors, matchedNodeTags }
}

const buildSelector = (tag, outbounds) => ({
  type: 'selector',
  tag,
  outbounds: unique(outbounds),
  interrupt_exist_connections: false
})

const matchGroupRule = (tag, group) => {
  return matchGroupPattern(tag, group) && matchGroupExtraPattern(tag, group)
}

const matchGroupPattern = (tag, group) => safeRegexTest(group.pattern, tag)

const matchGroupExtraPattern = (tag, group) => {
  if (!group.extraPattern) return true
  return safeRegexTest(group.extraPattern, tag)
}

const getManagedGroupTags = (settings) => {
  return new Set(
    Array.from(BASE_MANAGED_GROUP_TAGS)
      .concat(settings.managedGroupTags || [])
      .concat((settings.groups || []).map((group) => group.tag))
      .concat(settings.otherGroupTag || [])
      .filter(Boolean)
  )
}

const isRealNode = (outbound) => {
  return outbound?.tag && !EXCLUDED_TYPES.has(outbound.type)
}

const unique = (items) => Array.from(new Set(items.filter(Boolean)))

const safeRegexTest = (pattern, value) => {
  try {
    return new RegExp(pattern, 'i').test(value)
  } catch {
    return false
  }
}

const getHiddenSelectorTags = (profile) => {
  const profileOutbounds = Array.isArray(profile?.outbounds)
    ? profile.outbounds
    : Array.isArray(profile?.config?.outbounds)
      ? profile.config.outbounds
      : []
  return new Set(
    profileOutbounds
      .filter((outbound) => outbound?.type === 'selector' && outbound.hidden === true)
      .map((outbound) => outbound.tag)
      .filter(Boolean)
  )
}

const shouldPatchSelector = (outbound, generatedGroupTags, hiddenSelectorTags, settings) => {
  if (!outbound || outbound.type !== 'selector') return false
  if (generatedGroupTags.has(outbound.tag)) return false
  if (settings.skipHiddenSelectors && hiddenSelectorTags.has(outbound.tag)) return false
  return true
}

const cleanupMissingSelectorReferences = (config) => {
  const tags = new Set((config.outbounds || []).map((outbound) => outbound.tag).filter(Boolean))
  for (const outbound of config.outbounds || []) {
    if (!Array.isArray(outbound?.outbounds)) continue
    outbound.outbounds = outbound.outbounds.filter((tag) => tags.has(tag))
  }
}

const getCurrentProfile = () => {
  const profilesStore = Plugins.useProfilesStore()
  const appSettingsStore = Plugins.useAppSettingsStore()
  const profiles = profilesStore.profiles || []
  const currentProfileId = appSettingsStore.app?.kernel?.profile
  return profiles.find((profile) => profile.id === currentProfileId) || profilesStore.currentProfile || profiles[0]
}

const buildPreview = async (settings) => {
  const profile = getCurrentProfile()
  if (!profile) {
    return {
      profileName: '',
      groups: [],
      targetSelectors: []
    }
  }

  const generatedConfig = await Plugins.generateConfig(profile, { enablePluginProcessing: false }).catch(() => null)
  if (!generatedConfig?.outbounds) {
    return {
      profileName: profile.name || '',
      groups: [],
      targetSelectors: []
    }
  }

  const previewConfig = JSON.parse(JSON.stringify(generatedConfig))
  applyPolicyGroups(previewConfig, profile, settings)
  const generatedGroupTags = getManagedGroupTags(settings)
  return {
    profileName: profile.name || '',
    groups: previewConfig.outbounds
      .filter((outbound) => generatedGroupTags.has(outbound.tag))
      .map((outbound) => ({ tag: outbound.tag, count: outbound.outbounds?.length || 0 })),
    targetSelectors: previewConfig.outbounds
      .filter((outbound) => outbound.type === 'selector' && !generatedGroupTags.has(outbound.tag))
      .map((outbound) => outbound.tag)
  }
}

const openManager = async () => {
  const { ref, h } = Vue
  const settings = ref(normalizeSettings(await loadSettings()))
  const preview = ref(await buildPreview(settings.value))

  const refreshPreview = async () => {
    preview.value = await buildPreview(settings.value)
  }

  const component = {
    template: `
    <div class="flex flex-col gap-10 pr-8">
      <div class="flex items-center justify-between gap-8">
        <div class="min-w-0">
          <div class="font-bold text-16">策略组自动整理 <span class="text-12 opacity-70">{{ pluginVersion }}</span></div>
          <div class="text-12 opacity-70 truncate" :title="previewText">{{ previewText }}</div>
        </div>
        <div class="flex gap-8">
          <Button @click="refreshPreview">刷新预览</Button>
          <Button type="primary" @click="save">保存</Button>
        </div>
      </div>

      <Card>
        <div class="grid gap-10" style="grid-template-columns: 160px minmax(0, 1fr); align-items: center;">
          <div class="font-bold text-13">启用插件</div>
          <Switch v-model="settings.enabled">启用</Switch>

          <div class="font-bold text-13">插入位置</div>
          <select v-model="settings.insertPosition" class="gfs-native-input">
            <option value="before">插入到策略组前面</option>
            <option value="after">追加到策略组后面</option>
          </select>

          <div class="font-bold text-13">跳过隐藏策略组</div>
          <Switch v-model="settings.skipHiddenSelectors">跳过</Switch>

          <div class="font-bold text-13">启用 Other 组</div>
          <Switch v-model="settings.otherGroupEnabled">启用</Switch>

          <div class="font-bold text-13">Other 组名称</div>
          <Input v-model="settings.otherGroupTag" placeholder="🌐 Other Group" allow-paste />
        </div>
      </Card>

      <Card>
        <div class="flex items-center justify-between gap-8 mb-8">
          <div class="min-w-0">
            <div class="font-bold text-13">分组规则</div>
            <div class="text-12 opacity-70">节点按规则顺序匹配，主规则识别后不会进入 Other 组；额外条件只决定是否进入对应策略组。</div>
          </div>
          <Button @click="addGroup">新增分组</Button>
        </div>
        <div class="flex flex-col gap-8" style="max-height: 360px; overflow: auto;">
          <div
            v-for="(group, index) in settings.groups"
            :key="group.id"
            class="grid items-center gap-8 rounded-4 p-8"
            style="grid-template-columns: 70px minmax(100px, 140px) minmax(160px, 1fr) minmax(220px, 1.4fr) minmax(150px, 1fr) 136px; border: 1px solid #cbd5e1; background: #f8fafc;"
          >
            <Switch v-model="group.enabled">启用</Switch>
            <Input v-model="group.name" placeholder="名称" allow-paste />
            <Input v-model="group.tag" placeholder="策略组 tag" allow-paste />
            <Input v-model="group.pattern" placeholder="主匹配正则" allow-paste />
            <Input v-model="group.extraPattern" placeholder="额外条件正则，可空" allow-paste />
            <div class="flex gap-4 justify-end">
              <Button @click="moveGroupUp(index)" :disabled="index === 0">上移</Button>
              <Button @click="moveGroupDown(index)" :disabled="index === settings.groups.length - 1">下移</Button>
              <Button type="text" @click="removeGroup(index)">删除</Button>
            </div>
          </div>
          <div v-if="settings.groups.length === 0" class="flex items-center justify-center min-h-[96px] border border-dashed rounded-4">
            <div class="text-12 opacity-70">暂无分组规则</div>
          </div>
        </div>
      </Card>

      <Card>
        <div class="grid gap-8" style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));">
          <div v-for="group in preview.groups" :key="group.tag" class="rounded-4 p-8" style="border: 1px solid #cbd5e1; background: #f8fafc;">
            <div class="font-bold text-13">{{ group.tag }}</div>
            <div class="text-12 opacity-75">{{ group.count }} 个节点</div>
          </div>
          <div v-if="preview.groups.length === 0" class="flex items-center justify-center min-h-[80px] border border-dashed rounded-4" style="grid-column: 1 / -1;">
            <div class="text-12 opacity-70">当前预览没有生成国家策略组</div>
          </div>
        </div>
      </Card>

      <Card>
        <div class="font-bold text-13 mb-4">会被处理的策略组</div>
        <div class="text-12 opacity-75" style="word-break: break-word;">{{ targetSelectorText }}</div>
      </Card>
    </div>
    `,
    setup() {
      const addGroup = () => {
        settings.value.groups.push({
          id: Plugins.sampleID(),
          enabled: true,
          tag: '',
          name: '',
          pattern: '',
          extraPattern: ''
        })
      }
      const removeGroup = (index) => {
        settings.value.groups.splice(index, 1)
      }
      const moveGroupUp = (index) => {
        if (index <= 0) return
        const item = settings.value.groups.splice(index, 1)[0]
        settings.value.groups.splice(index - 1, 0, item)
      }
      const moveGroupDown = (index) => {
        if (index >= settings.value.groups.length - 1) return
        const item = settings.value.groups.splice(index, 1)[0]
        settings.value.groups.splice(index + 1, 0, item)
      }
      const save = async () => {
        const normalized = normalizeSettings(settings.value)
        validateSettings(normalized)
        getState().settings.value = normalized
        await saveSettings(normalized)
        await restartCoreIfRunning()
        modal.close()
      }

      return {
        pluginVersion: Plugin.version || '',
        settings,
        preview,
        previewText: Vue.computed(() => preview.value.profileName ? `预览配置：${preview.value.profileName}` : '未找到可预览配置'),
        targetSelectorText: Vue.computed(() => preview.value.targetSelectors.join('、') || '无'),
        refreshPreview,
        addGroup,
        removeGroup,
        moveGroupUp,
        moveGroupDown,
        save
      }
    }
  }

  const modal = Plugins.modal(
    {
      title: '策略组自动整理',
      submit: false,
      width: '72',
      height: '72',
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

const validateSettings = (settings) => {
  if (settings.otherGroupEnabled && !settings.otherGroupTag) {
    throw 'Other 组名称不能为空'
  }

  const tags = new Set()
  for (const group of settings.groups) {
    if (tags.has(group.tag)) {
      throw `策略组 tag 重复：${group.tag}`
    }
    tags.add(group.tag)
    try {
      new RegExp(group.pattern)
    } catch (error) {
      throw `分组「${group.name || group.tag}」主匹配正则无效：${error.message || error}`
    }
    if (!group.extraPattern) continue
    try {
      new RegExp(group.extraPattern)
    } catch (error) {
      throw `分组「${group.name || group.tag}」额外条件正则无效：${error.message || error}`
    }
  }
}

const restartCoreIfRunning = async () => {
  const kernelApiStore = Plugins.useKernelApiStore()
  if (!kernelApiStore.running) {
    Plugins.message.success('策略组整理配置已保存，启动核心后生效')
    return
  }
  Plugins.message.info('策略组整理配置已保存，正在重启核心...')
  await kernelApiStore.restartCore()
  Plugins.message.success('核心已重启，策略组整理已生效')
}

export default {
  onReady,
  onRun,
  onBeforeCoreStart
}
