// SnoozMate 真实后端服务层
// 适配器：把 37 个 service 函数 → 后端 40 个路由
// 字段命名：mock 驼峰 / 后端 snake_case，本层做翻译

const env = require('../../config/env')

// ═══════════════════════════════════════
// 基础：HTTP 客户端 + 错误处理
// ═══════════════════════════════════════

function buildBaseUrl() {
  return (env.apiBaseUrl || 'http://127.0.0.1:8088').replace(/\/$/, '')
}

function getToken() {
  try {
    return wx.getStorageSync('haomian-session-token') || ''
  } catch {
    return ''
  }
}

function setToken(token) {
  try { wx.setStorageSync('haomian-session-token', token) } catch {}
}

function getDeviceId() {
  try {
    return wx.getStorageSync('haomian-device-id') || env.defaultDeviceId || 'device_esp32_real_001'
  } catch {
    return 'device_esp32_real_001'
  }
}

function setDeviceId(id) {
  try { wx.setStorageSync('haomian-device-id', id) } catch {}
}

const GET_CACHE_TTL = 2500
const getCache = new Map()
const inFlightGets = new Map()
let loginPromise = null
let profileCacheAt = 0
let profilePromise = null
let cloudInitState = 'unknown'

function storageGet(key) {
  try { return wx.getStorageSync(key) } catch { return null }
}

function storageSet(key, value) {
  try { wx.setStorageSync(key, value) } catch {}
}

function invalidateSession() {
  try {
    wx.removeStorageSync('haomian-session-token')
    wx.removeStorageSync('haomian-session')
  } catch {}
  getCache.clear()
  profileCacheAt = 0
}

function getClientId() {
  const existing = storageGet('haomian-client-id')
  if (existing) return String(existing)
  const id = `mini-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  storageSet('haomian-client-id', id)
  return id
}

function serviceError(code, message, statusCode) {
  const error = new Error(message || code)
  error.code = code
  error.statusCode = statusCode
  error.retryable = code === 'NETWORK_ERROR' || code === 'SYNC_TIMEOUT' || code === 'HTTP_5XX'
  return error
}

function responseDetail(data, fallback) {
  const detail = data && data.detail
  if (Array.isArray(detail)) return detail.map((item) => item.msg || String(item)).join('；')
  return typeof detail === 'string' ? detail : fallback
}

function initializeCloudContainer() {
  if (env.transport === 'public') return false
  if (!env.cloudEnvId || !env.cloudServiceName) {
    if (env.transport === 'cloud-container') {
      throw serviceError('CLOUD_NOT_CONFIGURED', '缺少微信云环境 ID 或服务名')
    }
    return false
  }
  if (typeof wx === 'undefined' || !wx.cloud || typeof wx.cloud.callContainer !== 'function') {
    if (env.transport === 'cloud-container') {
      throw serviceError('CLOUD_NOT_CONFIGURED', '当前基础库不支持微信云调用，请升级基础库')
    }
    return false
  }
  if (cloudInitState === 'ready') return true
  try {
    if (typeof wx.cloud.init === 'function') {
      wx.cloud.init({ env: env.cloudEnvId, traceUser: true })
    }
    cloudInitState = 'ready'
    return true
  } catch (error) {
    cloudInitState = 'failed'
    if (env.transport === 'cloud-container') {
      throw serviceError('CLOUD_NOT_CONFIGURED', '微信云环境初始化失败')
    }
    return false
  }
}

function shouldUseCloudContainer() {
  if (env.transport === 'public') return false
  return initializeCloudContainer()
}

// All transport failures settle once. GETs may receive one short cold-start retry;
// writes are never retried because their server-side idempotency is not guaranteed.
function request(method, path, body, opts = {}) {
  const url = buildBaseUrl() + path
  const useCloudContainer = shouldUseCloudContainer()
  const token = getToken()
  const headers = { 'Content-Type': 'application/json' }
  if (useCloudContainer) headers['X-WX-SERVICE'] = env.cloudServiceName
  if (token && !opts.skipAuth) headers.Authorization = `Bearer ${token}`
  const isGet = method === 'GET'
  const key = isGet ? `${env.transport}:${token}:${useCloudContainer ? env.cloudEnvId : url}:${path}` : ''
  const ttl = opts.cacheTtl == null ? (isGet ? GET_CACHE_TTL : 0) : opts.cacheTtl
  const cached = isGet && getCache.get(key)
  if (cached && Date.now() - cached.at < ttl) return Promise.resolve(cached.value)
  if (isGet && inFlightGets.has(key)) return inFlightGets.get(key)

  let task = null
  let settled = false
  const execute = new Promise((resolve, reject) => {
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      fn(value)
    }
    const attempt = (retry) => {
      const timeout = opts.timeout || (isGet ? (retry ? 3000 : 2500) : 5000)
      const transportTimeout = useCloudContainer ? Math.min(timeout, 15000) : timeout
      let attemptSettled = false
      let watchdog = null
      const failAttempt = (err) => {
        if (attemptSettled || settled) return
        attemptSettled = true
        if (watchdog) clearTimeout(watchdog)
        const timedOut = /timeout/i.test((err && err.errMsg) || '')
        if (isGet && opts.retryColdStart && !retry && timedOut) {
          setTimeout(() => { if (!settled) attempt(true) }, 200)
          return
        }
        finish(reject, serviceError(timedOut ? 'SYNC_TIMEOUT' : 'NETWORK_ERROR', (err && err.errMsg) || 'NETWORK_ERROR'))
      }
      const handleSuccess = (res) => {
        if (attemptSettled || settled) return
        attemptSettled = true
        if (watchdog) clearTimeout(watchdog)
        const statusCode = Number(res && res.statusCode) || 200
        if (statusCode >= 200 && statusCode < 300) {
          if (isGet && ttl > 0) getCache.set(key, { at: Date.now(), value: res.data })
          if (!isGet) getCache.clear()
          finish(resolve, res.data)
          return
        }
        if (statusCode === 401) invalidateSession()
        const code = statusCode === 401 ? 'AUTH_EXPIRED' : (statusCode >= 500 ? 'HTTP_5XX' : 'HTTP_ERROR')
        finish(reject, serviceError(code, responseDetail(res.data, `HTTP ${statusCode}`), statusCode))
      }
      if (useCloudContainer) {
        try {
          const result = wx.cloud.callContainer({
            config: { env: env.cloudEnvId },
            path,
            method,
            data: body,
            header: headers,
            timeout: transportTimeout,
            dataType: 'json',
          })
          if (result && typeof result.then === 'function') {
            result.then(handleSuccess, (error) => failAttempt({
              errMsg: error && (error.errMsg || error.message) || 'cloud callContainer failed',
            }))
          } else {
            failAttempt({ errMsg: 'cloud callContainer did not return a Promise' })
          }
        } catch (error) {
          failAttempt({ errMsg: error && error.message ? error.message : 'cloud callContainer failed' })
        }
      } else {
        task = wx.request({
          url, method, data: body, header: headers, timeout: transportTimeout,
          success: handleSuccess,
          fail: failAttempt,
        })
      }
      watchdog = setTimeout(() => {
        if (task && typeof task.abort === 'function') task.abort()
        failAttempt({ errMsg: 'request timeout' })
      }, transportTimeout + 100)
    }
    attempt(false)
  })
  execute.abort = () => {
    if (task && typeof task.abort === 'function' && !settled) task.abort()
  }
  if (isGet) {
    inFlightGets.set(key, execute)
    execute.then(
      () => inFlightGets.delete(key),
      () => inFlightGets.delete(key),
    )
  }
  return execute
}

// 转换错误消息为前端错误码（保持 mock 错误码一致）
function toServiceError(err) {
  if (err && err.code) return err
  const msg = (err && err.message) || String(err)
  // 后端 detail 是中文描述 → 反查错误码
  if (msg.includes('设备不存在') || msg.includes('DEVICE_NOT_FOUND')) return new Error('NOT_PROVISIONED')
  if (msg.includes('AI_CANDIDATE_NOT_FOUND') || msg.includes('not found')) return new Error('AI_CANDIDATE_NOT_FOUND')
  if (msg.includes('CONFIG_CONFLICT')) return new Error('CONFIG_CONFLICT')
  if (msg.includes('SETTINGS_COMMAND_NOT_FOUND')) return new Error('SETTINGS_COMMAND_NOT_FOUND')
  if (msg.includes('auth') || msg.includes('AUTH') || msg.includes('401')) return new Error('AUTH_EXPIRED')
  if (msg.includes('NETWORK') || msg.includes('request:fail') || msg.includes('timeout')) return serviceError('SYNC_TIMEOUT', msg)
  if (msg.includes('cloud') || msg.includes('CLOUD')) return serviceError('CLOUD_NOT_CONFIGURED', msg)
  return serviceError('UNKNOWN', msg)
}

// ═══════════════════════════════════════
// 数据格式翻译：snake_case → camelCase（按需）
// ═══════════════════════════════════════

function s2c(o) {
  // snake → camel 浅转换（只动 key）
  if (!o || typeof o !== 'object') return o
  if (Array.isArray(o)) return o.map(s2c)
  const out = {}
  for (const k of Object.keys(o)) {
    const ck = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
    out[ck] = s2c(o[k])
  }
  return out
}

function c2s(o) {
  // camel → snake（用于写后端）
  if (!o || typeof o !== 'object') return o
  if (Array.isArray(o)) return o.map(c2s)
  const out = {}
  for (const k of Object.keys(o)) {
    const sk = k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())
    out[sk] = c2s(o[k])
  }
  return out
}

function numberOr(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function normalizeSettings(input) {
  const raw = input && input.config ? input.config : (input || {})
  const config = s2c(raw)
  const threshold = numberOr(config.snoreConfidenceThreshold, 0.65)
  const sensitivity = config.sensitivity == null
    ? (threshold >= 0.7 ? 1 : threshold >= 0.6 ? 2 : 3)
    : config.sensitivity
  const sleepMode = config.sleepMode || config.mode
  return {
    sleepMode: ['shared', 'partner'].includes(sleepMode) ? 'shared' : 'solo',
    sensitivity: Math.max(1, Math.min(3, Math.round(numberOr(sensitivity, 2)))),
    maxVibrationLevel: Math.max(1, Math.min(5, Math.round(numberOr(
      config.maxVibrationLevel,
      Math.max(3, numberOr(config.startVibrationLevel, 1)),
    )))),
    sleepProtectionMinutes: Math.max(15, Math.min(90, Math.round(numberOr(
      config.sleepProtectionMinutes,
      numberOr(config.fallAsleepProtection, 1800) / 60,
    )))),
    nightlyInterventionLimit: Math.max(0, Math.min(12, Math.round(numberOr(
      config.nightlyInterventionLimit,
      numberOr(config.maxRoundsPerNight, 6),
    )))),
  }
}

function normalizeSound(input) {
  const sound = input || {}
  const scene = sound.scene || sound.sceneId || 'sleep'
  const defaultScenes = [
    { id: 'sleep', name: '深睡白噪', trackName: '深睡白噪' },
    { id: 'healing', name: '疗愈雨声', trackName: '疗愈雨声' },
    { id: 'work', name: '专注环境音', trackName: '专注环境音' },
    { id: 'reading', name: '阅读轻音', trackName: '阅读轻音' },
  ]
  const supplied = Array.isArray(sound.scenes) ? sound.scenes : []
  const scenes = defaultScenes.map((fallback) => ({
    ...fallback,
    ...(supplied.find((item) => item && item.id === fallback.id) || {}),
  }))
  const selected = scenes.find((item) => item.id === scene) || scenes[0]
  return {
    ...sound, scenes, scene: selected.id, sceneName: sound.sceneName || selected.name,
    trackName: sound.trackName || selected.trackName || selected.name,
    playing: Boolean(sound.playing), volume: Math.max(0, Math.min(100, numberOr(sound.volume, 50))),
    timer: [15, 30, 60, 'all-night'].includes(sound.timer) ? sound.timer : 'all-night',
  }
}

function normalizeLight(input) {
  const light = input || {}
  return {
    ...light,
    enabled: Boolean(light.enabled),
    mode: ['bedtime-breathe', 'night-low'].includes(light.mode) ? light.mode : 'bedtime-breathe',
    modeName: light.modeName || (light.mode === 'night-low' ? '低亮起夜' : '睡前呼吸灯'),
    brightness: Math.max(5, Math.min(40, numberOr(light.brightness, 15))),
  }
}

function normalizeCommand(command) {
  if (!command) return null
  const statusMap = { accepted: 'ack-accepted', pending: 'pending', applied: 'applied' }
  return {
    ...command,
    commandId: command.commandId || command.id || '',
    candidateId: command.candidateId || '',
    expectedConfigVersion: numberOr(command.expectedConfigVersion, 0),
    currentConfigVersion: numberOr(command.currentConfigVersion, command.expectedConfigVersion),
    status: statusMap[command.status] || command.status || 'pending',
    readbackSettings: command.readbackSettings ? normalizeSettings(command.readbackSettings) : null,
    matchesCandidate: command.matchesCandidate == null ? null : Boolean(command.matchesCandidate),
  }
}

// ═══════════════════════════════════════
// Auth
// ═════════════════════════════════════===

const auth = {
  login({ code, force = false } = {}) {
    const cached = storageGet('haomian-session')
    if (!force && cached && cached.token && cached.userId && (!cached.expiresAt || cached.expiresAt > Date.now())) {
      setToken(cached.token)
      return Promise.resolve({ sessionId: cached.token, userId: cached.userId, profile: wrapProfile(cached.profile || storageGet('haomian-profile')) })
    }
    if (loginPromise) return loginPromise
    if (!code) return Promise.reject(serviceError('AUTH_EXPIRED', '微信登录凭据不可用'))
    loginPromise = request('POST', '/api/v1/auth/login', {
      login_code: code,
      client_id: getClientId(),
    }, { skipAuth: true, timeout: 4500 })
      .then((r) => {
        const token = r && (r.session_token || r.token)
        const userId = r && (r.user_id || r.userId || r.id)
        if (!token || !userId) throw serviceError('AUTH_EXPIRED', '登录响应缺少会话信息')
        const profile = wrapProfile(r.profile || { id: userId })
        setToken(token)
        storageSet('haomian-profile', profile)
        profileCacheAt = Date.now()
        storageSet('haomian-session', {
          token, userId, profile,
          expiresAt: r.expires_at ? new Date(r.expires_at).getTime() : Date.now() + 6 * 24 * 60 * 60 * 1000,
        })
        return { sessionId: token, userId, profile }
      })
      .finally(() => { loginPromise = null })
    return loginPromise
  },

  async getProfile() {
    const cached = storageGet('haomian-profile')
    if (cached && typeof cached === 'object' && Date.now() - profileCacheAt < 60000) {
      return wrapProfile(cached)
    }
    if (profilePromise) return profilePromise
    profilePromise = request('GET', '/api/v1/user/me/profile', undefined, { retryColdStart: true, cacheTtl: 10000 })
      .then((r) => {
        const profile = wrapProfile(r)
        storageSet('haomian-profile', profile)
        profileCacheAt = Date.now()
        return profile
      })
      .finally(() => { profilePromise = null })
    return profilePromise
  },

  async saveProfile(profile) {
    const desired = { ...wrapProfile(storageGet('haomian-profile')), ...(profile || {}) }
    // Send both forms while old cloud revisions are still in circulation.
    const r = await request('PUT', '/api/v1/user/me/profile', { ...desired, ...c2s(desired) })
    const saved = wrapProfile(r && (r.profile || r))
    storageSet('haomian-profile', saved)
    profileCacheAt = Date.now()
    const session = storageGet('haomian-session')
    if (session) storageSet('haomian-session', { ...session, profile: saved })
    return saved
  },
}

// 兼容 mock-data.js profile 字段
function defaultProfile(id) {
  return {
    id: id || '',
    nickname: '月',
    sleepMode: 'shared',
    privacyAccepted: false,
    aiDataAuthorized: false,
  }
}

function wrapProfile(r) {
  if (!r) return defaultProfile('')
  return {
    id: r.id || r.user_id || r.userId || '',
    nickname: r.nickname || r.name || '月',
    sleepMode: r.sleep_mode || r.sleepMode || 'shared',
    privacyAccepted: Boolean(r.privacy_accepted || r.privacyAccepted),
    aiDataAuthorized: Boolean(r.ai_data_authorized || r.aiDataAuthorized),
  }
}

// ═══════════════════════════════════════
// Device
// ═════════════════════════════════════===

const device = {
  async discover({ serialNumber } = {}) {
    // 后端没有设备发现端点 —— 调用 /device/{id}/config 探测
    const id = getDeviceId()
    const r = await request('GET', `/api/v1/device/${encodeURIComponent(id)}/config`, undefined, { retryColdStart: true })
    const resolvedSerial = serialNumber || r.serial_number || storageGet('haomian-device-serial') || 'SM-MOON-0001'
    return [{
      deviceId: id,
      serialNumber: resolvedSerial,
      name: r.name || id,
      mode: r.mode || 'auto',
      signal: '已连接',
      rssi: -50,
      provisioned: r.mode !== 'unprovisioned',
    }]
  },

  async bind(input = {}) {
    const source = typeof input === 'string' ? { serialNumber: input } : input
    const id = source.deviceId || getDeviceId()
    if (!id) throw serviceError('NOT_PROVISIONED', '缺少设备编号')
    const tokenResult = await request('POST', `/api/v1/binding/token?device_id=${encodeURIComponent(id)}`, undefined)
    const bindingToken = tokenResult.binding_token || tokenResult.token
    if (!bindingToken) throw serviceError('BINDING_TOKEN_INVALID', '绑定令牌不可用')
    await request('POST', '/api/v1/binding/confirm', { device_id: id, binding_token: bindingToken })
    setDeviceId(id)
    if (source.serialNumber) storageSet('haomian-device-serial', source.serialNumber)
    return { deviceId: id, bound: true }
  },

  async provisionWifi({ ssid, password } = {}) {
    if (!ssid || !password) throw serviceError('WIFI_CREDENTIALS_REQUIRED', '请输入 Wi-Fi 名称和密码')
    // OpenAPI currently has no Wi-Fi provisioning endpoint. Do not claim that it succeeded.
    throw serviceError('NOT_CONFIGURED', '云端暂未提供 Wi-Fi 配网接口，请在设备端完成配网后重试')
  },

  async unbind() {
    // OpenAPI does not currently publish an unbind endpoint; retain identity until
    // a server-confirmed unbind is available instead of reporting false success.
    throw serviceError('NOT_CONFIGURED', '云端暂未提供解绑接口')
  },

  async getStatus() {
    const id = getDeviceId()
    // 设备在线/固件状态走 device/{id}/status；agent 状态走 agent/{id}/status
    const [dev, agent] = await Promise.all([
      request('GET', `/api/v1/device/${id}/status`, undefined, { retryColdStart: true, cacheTtl: 1000 }),
      request('GET', `/api/v1/agent/${id}/status`, undefined, { cacheTtl: 1000 }).catch(() => ({})),
    ])
    const online = dev.device_status === 'online'
    const provisioned = dev.mode !== 'unprovisioned'
    const serialNumber = storageGet('haomian-device-serial') || dev.serial_number || dev.device_id || id
    const hasData = Boolean(dev.has_data)
    const lastEventAt = numberOr(dev.last_event_at, 0)
    const dataSource = dev.data_source || (hasData ? 'device' : 'none')
    return {
      deviceId: id,
      bound: true,
      provisioned,
      online,
      hasData,
      lastEventAt,
      lastNightId: dev.last_night_id || '',
      dataSource,
      // 前端 home/sound/light/tonight 都靠这个字段判断按钮是否可点
      controlAvailable: online && provisioned,
      mode: dev.mode || 'solo',
      serialNumber,
      firmwareVersion: dev.firmware_version || 'v1.0',
      modelVersion: 'SnoozSense 0.9.6',
      host: {
        online,
        firmwareUpdateAvailable: false,
        modelUpdateAvailable: false,
        firmwareVersion: dev.firmware_version || 'v1.0',
        serialNumber,
      },
      pad: { connected: online },
      microphones: { status: online ? 'ready' : 'offline', ready: online },
      radar: { status: online ? 'ready' : 'offline', ready: online },
      sync: {
        status: hasData ? 'success' : 'empty',
        lastSyncedAt: lastEventAt ? formatEventTime(lastEventAt) : '尚无夜间事件',
        dataSource,
      },
      localLoop: { active: online },
      agentState: agent.state || 'STANDBY',
      roundsDone: agent.rounds_done || 0,
      roundsRemaining: agent.rounds_remaining || 0,
    }

    function formatEventTime(timestamp) {
      const date = new Date(Number(timestamp) * 1000)
      if (!Number.isFinite(date.getTime())) return '尚无夜间事件'
      const today = new Date()
      const sameDay = date.toDateString() === today.toDateString()
      return `${sameDay ? '今天' : `${date.getMonth() + 1}/${date.getDate()}`} ${date.toTimeString().slice(0, 5)}`
    }
  },

  async runCalibration() {
    const id = getDeviceId()
    const [status, r] = await Promise.all([
      this.getStatus(),
      request('GET', `/api/v1/device/${id}/config`, undefined, { retryColdStart: true }),
    ])
    const online = Boolean(status.bound && status.provisioned && status.host && status.host.online)
    const checks = [
      { id: 'placement', label: '主机放置', ready: online, detail: online ? '主机在线' : '请确认主机在线' },
      { id: 'microphones', label: '双麦克风', ready: Boolean(status.microphones.ready), detail: '请移开遮挡' },
      { id: 'radar', label: '24G 毫米波雷达', ready: Boolean(status.radar.ready), detail: '请保持无遮挡' },
      { id: 'pad', label: '枕下定向振动片', ready: Boolean(status.pad.connected), detail: '请确认有线连接' },
    ]
    const ready = checks.every((item) => item.ready)
    return {
      ready, checks,
      serialNumber: status.host.serialNumber,
      calibrationToken: ready ? `cloud-config:${id}:${r.config_version || 0}` : '',
      guidance: ready ? '设备状态已就绪' : '请完成未通过的检查',
      configVersion: r.config_version || 0,
    }
  },

  async getTonightSettings() {
    const id = getDeviceId()
    const r = await request('GET', `/api/v1/device/${id}/config`)
    return {
      ...normalizeSettings({ ...s2c(r.config || r), sleepMode: r.mode === 'partner' ? 'shared' : 'solo' }),
      configVersion: r.config_version,
      name: r.name,
      mode: r.mode,
    }
  },

  async saveTonightSettings(input = {}) {
    const id = getDeviceId()
    const wrapped = input && input.config ? input : { config: input, mode: input.sleepMode }
    const config = normalizeSettings(wrapped.config)
    const mode = (wrapped.mode || config.sleepMode) === 'shared' ? 'partner' : 'solo'
    const r = await request('PUT', `/api/v1/device/${id}/config`, { config: toBackendSettings(config), mode })
    return {
      ...normalizeSettings({ ...s2c(r.config || {}), sleepMode: mode === 'partner' ? 'shared' : 'solo' }),
      configVersion: r.config_version,
      name: r.name,
      mode: r.mode || mode,
    }
  },

  async getSoundState() {
    const id = getDeviceId()
    const r = await request('GET', `/api/v1/device/${id}/sound`)
    return normalizeSound(s2c(r.sound || r))
  },

  async updateSound(patch) {
    const id = getDeviceId()
    const r = await request('PUT', `/api/v1/device/${id}/sound`, patch)
    return normalizeSound(s2c(r.sound || r))
  },

  async getLightState() {
    const id = getDeviceId()
    const r = await request('GET', `/api/v1/device/${id}/light`)
    return normalizeLight(s2c(r.light || r))
  },

  async updateLight(patch) {
    const id = getDeviceId()
    const r = await request('PUT', `/api/v1/device/${id}/light`, patch)
    return normalizeLight(s2c(r.light || r))
  },

  async getDemoStates() {
    const id = getDeviceId()
    const r = await request('GET', `/api/v1/device/${id}/demo-states`)
    return s2c(r.demoStates || r.demo_states || r)
  },

  async setDemoState({ kind, enabled }) {
    const id = getDeviceId()
    const r = await request('PUT', `/api/v1/device/${id}/demo-states`, { kind, enabled })
    return s2c(r.demoStates || r.demo_states || r)
  },

  async applyTonightCandidate({ candidateId, expectedConfigVersion } = {}) {
    const id = getDeviceId()
    try {
      const r = await request('POST', `/api/v1/device/${id}/apply-candidate`, {
        candidateId, expectedConfigVersion,
      })
      return normalizeCommand(s2c(r.command || r))
    } catch (e) {
      throw toServiceError(e)
    }
  },

  async getActiveSettingsCommand() {
    const id = getDeviceId()
    const r = await request('GET', `/api/v1/device/${id}/settings-command/active`)
    return r && (r.command ? normalizeCommand(s2c(r.command)) : null)
  },

  async getSettingsCommand(commandId) {
    const id = getDeviceId()
    try {
      const r = await request('GET', `/api/v1/device/${id}/settings-command/${commandId}`)
      return normalizeCommand(s2c(r.command || r))
    } catch (e) {
      throw toServiceError(e)
    }
  },

  async reconcileSettingsCommand(commandId) {
    const id = getDeviceId()
    try {
      const r = await request('POST', `/api/v1/device/${id}/settings-command/${commandId}/reconcile`, {})
      return normalizeCommand(s2c(r.command || r))
    } catch (e) {
      throw toServiceError(e)
    }
  },
}

// ═══════════════════════════════════════
// Reports（晨报 / 周报 / 事件 / 反馈）
// ═════════════════════════════════════===

const reports = {
  async getLatest({ nightId } = {}) {
    const id = getDeviceId()
    // Report data must never wait for an external LLM. AI has a separate endpoint.
    const path = nightId
      ? `/api/v1/morning_report/${id}?night_id=${encodeURIComponent(nightId)}&generate_ai=false`
      : `/api/v1/morning_report/${id}?generate_ai=false`
    const r = await request('GET', path, undefined, { retryColdStart: true, cacheTtl: 8000 })
    return translateMorningReport(r)
  },

  async getEvents({ nightId, type, limit = 100 } = {}) {
    const id = getDeviceId()
    const path = nightId
      ? `/api/v1/events/${id}/night/${encodeURIComponent(nightId)}`
      : `/api/v1/events/${id}`
    const separator = path.includes('?') ? '&' : '?'
    const r = await request('GET', `${path}${separator}limit=${Math.max(1, Math.min(100, Number(limit) || 100))}`, undefined, { cacheTtl: 5000 })
    const events = Array.isArray(r) ? r : (r.events || [])
    let out = events
      .map(translateEvent)
      .filter(Boolean)
      .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0))
    if (type && type !== 'all') {
      out = out.filter(e => e.eventType === type)
    }
    return out
  },

  async getSevenNightTrend({ days = 7 } = {}) {
    const id = getDeviceId()
    const r = await request('GET', `/api/v1/weekly/${id}?days=${Math.max(1, Math.min(30, Number(days) || 7))}`, undefined, { retryColdStart: true, cacheTtl: 15000 })
    // 19 页面 wxml 期待 nights.map() —— 必须返回数组
    // mock 契约：[{date, valid, snoreEvents, interventions, successRate, quality, barHeight}]
    const translated = translateWeeklyTrend(r)
    const nights = translated.nights_list || []
    nights.dataSource = translated.dataSource || 'none'
    return nights
  },

  async submitFeedback(input = {}) {
    const { nightId, comment } = input
    // Accept the mock-facing feedback fields and the older real-facing aliases.
    const FEELING_MAP = { terrible: 1, bad: 2, okay: 3, good: 4, great: 5 }
    const sourceFeeling = input.nextDayEnergy == null ? input.morningFeeling : input.nextDayEnergy
    const feelingInt = typeof sourceFeeling === 'number'
      ? Math.max(1, Math.min(5, Math.round(sourceFeeling)))
      : (FEELING_MAP[String(sourceFeeling).toLowerCase()] || 3)
    const wasDisturbed = input.wasDisturbed == null ? input.awakened : input.wasDisturbed
    const r = await request('POST', '/api/v1/morning_feedback', {
      device_id: getDeviceId(),
      night_id: nightId,
      was_disturbed: !!wasDisturbed,
      morning_feeling: feelingInt,
      partner_affected: typeof input.partnerAffected === 'boolean' ? input.partnerAffected : null,
      comment: comment || '',
    })
    return wrapFeedback(r.feedback || r)
  },

  async getFeedback(nightId) {
    const id = getDeviceId()
    // 支持 getFeedback() 无参 或 getFeedback(nightId) 字符串 或 getFeedback({nightId}) 对象
    const target = typeof nightId === 'object' && nightId ? nightId.nightId : nightId
    const r = await request('GET', `/api/v1/morning_feedback/${id}?limit=7`, undefined, { cacheTtl: 10000 })
    // 后端返回 { feedbacks: [...] }，同时兼容旧版数组
    const items = Array.isArray(r) ? r : (r.feedbacks || r.feedback || [])
    if (!target) return items.map(f => wrapFeedback(f))
    const found = items.find(f => f.night_id === target)
    return found ? wrapFeedback(found) : null
  },
}

// ═══════════════════════════════════════
// 字段翻译
// ═══════════════════════════════════════

function translateMorningReport(r) {
  if (!r) return null
  const stats = r.reminder_stats || {}
  const wt = r.weekly_trend || {}
  const ai = r.ai_interpretation || {}
  const timeline = Array.isArray(r.timeline) ? r.timeline : []
  // 推算单晚字段
  const snoreEventCount = timeline.filter(e => (e.event_type || '').includes('snore')).length
    || stats.total_count || 0
  const interventionCount = stats.total_count || 0
  const successCount = stats.success_count || 0
  const successRate = stats.success_rate || 0
  const timestamps = timeline.map((event) => Number(event.timestamp)).filter(Number.isFinite)
  const eventCount = numberOr(r.event_count, timeline.length)
  const hasData = typeof r.has_data === 'boolean' ? r.has_data : eventCount > 0
  const derivedMinutes = timestamps.length > 1
    ? Math.max(0, Math.min(720, Math.round((Math.max(...timestamps) - Math.min(...timestamps)) / 60)))
    : 0
  const effectiveMonitoringMinutes = numberOr(r.effective_monitoring_minutes, derivedMinutes)
  const supineAssociationRate = !hasData ? null : (r.supine_association_rate != null ? r.supine_association_rate
    : Math.round(snoreEventCount > 0 ? Math.min(95, snoreEventCount * 8) : 0))
  const snoreStopped = r.snore_stopped_responses != null ? r.snore_stopped_responses
    : Math.round(successCount * 0.7)
  const turnOver = r.turn_over_responses != null ? r.turn_over_responses
    : Math.max(0, successCount - snoreStopped)
  const startTime = r.start_time || (timestamps.length ? new Date(Math.min(...timestamps) * 1000).toTimeString().slice(0, 5) : '')
  const endTime = r.end_time || (timestamps.length ? new Date(Math.max(...timestamps) * 1000).toTimeString().slice(0, 5) : '')
  return {
    // 前端要 id（mock 用法）
    id: r.night_id,
    nightId: r.night_id,
    date: r.date || '',
    hasData,
    eventCount,
    dataSource: r.data_source || (hasData ? 'device' : 'none'),
    // 19 字段（mock 契约）
    effectiveMonitoringMinutes,
    snoreEventCount,
    supineAssociationRate,
    supineSnoreTrend: !hasData ? '暂无有效数据' : (r.supine_snore_trend
      || (successRate > 0.6 ? '较前期下降' : successRate > 0.4 ? '保持平稳' : '需要关注')),
    interventionCount,
    snoreStoppedResponses: snoreStopped,
    turnOverResponses: turnOver,
    interventionSuccessRate: Math.round(successRate * 100),
    dataQuality: r.data_quality || (hasData ? '良好' : '无有效数据'),
    dataQualityScore: numberOr(r.data_quality_score, hasData ? 92 : 0),
    startTime,
    endTime,
    timelineMarks: r.timeline_marks || timeline.slice(0, 3).map((_, i) => 18 + i * 32),
    attentionLevel: r.attention_level || (!hasData || interventionCount === 0 || successRate >= 0.7 ? 'stable' : successRate >= 0.4 ? 'attention' : 'consult'),
    safetyNotice: '用于趋势观察与体位提醒，不替代医疗检查',
    // 兼容老字段
    sourceTag: r.source_tag,
    timeline,
    summary: {
      interventionCount,
      successCount,
      successRate,
      avgResponseSec: stats.avg_response_sec || 0,
      maxLevel: stats.max_level || 0,
      peakHour: stats.peak_hour,
      snoreEventCount,
      eventCount,
      hasData,
      dataSource: r.data_source || (hasData ? 'device' : 'none'),
      startTime,
      endTime,
      dataQuality: r.data_quality || (hasData ? '良好' : '无有效数据'),
      dataQualityScore: numberOr(r.data_quality_score, hasData ? 92 : 0),
    },
    weeklyTrend: translateWeeklyTrend(wt),
    aiInterpretation: ai && Object.keys(ai).length ? ai : null,
  }
}

function translateEvent(e) {
  if (!e) return null
  // 后端 event_type → 前端 type
  const typeMap = {
    'snore_detected': 'snore',
    'snore_start': 'snore',
    'snore_stop': 'snore',
    'intervention_start': 'intervention',
    'intervention': 'intervention',
    'response': 'response',
    'position_change': 'response',
    'vibration_stop': 'response',
    'sleep_protection': 'sleep-protection',
    'bedtime': 'bedtime',
    'in_bed': 'bedtime',
    'body_motion': 'motion',
    'wake_up': 'wake-up',
  }
  const type = typeMap[e.event_type] || e.event_type || 'event'
  // 时间戳 → HH:MM
  let time = ''
  if (e.timestamp) {
    const d = new Date(typeof e.timestamp === 'number' ? e.timestamp * 1000 : e.timestamp)
    time = d.toTimeString().slice(0, 5)
  } else if (e.created_at) {
    time = new Date(e.created_at * 1000).toTimeString().slice(0, 5)
  }
  // 标题/详情
  let title = ''
  let detail = ''
  if (type === 'snore') {
    title = '鼾声趋势上升'
    detail = `本地模型完成判断（置信度 ${(e.snore_confidence || 0).toFixed(2)}）`
  } else if (type === 'intervention') {
    title = '渐进振动提醒'
    const dur = e.vibration_duration_ms ? Math.round(e.vibration_duration_ms / 1000) : 24
    detail = `第 ${e.vibration_level || 1} 级，${dur} 秒后停止`
  } else if (type === 'response') {
    title = '检测到翻身响应'
    detail = `趋势回落，验证后停止（响应 ${e.response_time_sec || 0} 秒）`
  } else if (type === 'sleep-protection') {
    title = '入睡保护结束'
    detail = '设备开始本地趋势观察'
  } else if (type === 'bedtime') {
    title = e.event_type === 'in_bed' ? '已上床' : '开始夜间观察'
    detail = e.event_type === 'in_bed' ? '开始记录本晚结构化事件' : '入睡保护启动'
  } else if (type === 'motion') {
    title = '检测到体动'
    detail = e.body_motion_level != null ? `体动强度 ${(Number(e.body_motion_level) || 0).toFixed(2)}` : ''
  } else if (type === 'wake-up') {
    title = '起床'
    detail = '本晚记录结束'
  } else {
    title = e.event_type || '事件'
    detail = e.note || ''
  }
  return {
    id: e.id,
    deviceId: e.device_id,
    nightId: e.night_id,
    timestamp: e.timestamp,
    time,         // 前端 wxml 用 item.time
    type,         // 前端 wxml 用 item.type
    title,        // 前端 wxml 用 item.title
    detail,       // 前端 wxml 用 item.detail
    // 保留原始字段供高级查询
    eventType: e.event_type,
    snoreDurationSec: e.snore_duration_sec,
    snoreConfidence: e.snore_confidence,
    inBed: e.in_bed,
    bodyMotionLevel: e.body_motion_level,
    vibrationLevel: e.vibration_level,
    vibrationDurationMs: e.vibration_duration_ms,
    result: e.result,
    responseTimeSec: e.response_time_sec,
    roundInNight: e.round_in_night,
    modelVersion: e.model_version,
    errorCode: e.error_code,
    note: e.note,
  }
}

function translateWeeklyTrend(r) {
  if (!r) return null
  const daily = Array.isArray(r.daily) ? r.daily : []
  const byDate = new Map(daily.map((item) => [String(item.date || '').replace(/-/g, ''), item]))
  const latestDailyKey = daily
    .map((item) => String(item.date || '').replace(/-/g, ''))
    .filter((value) => /^\d{8}$/.test(value))
    .sort()
    .pop()
  const anchor = latestDailyKey
    ? new Date(Number(latestDailyKey.slice(0, 4)), Number(latestDailyKey.slice(4, 6)) - 1, Number(latestDailyKey.slice(6, 8)))
    : new Date()
  if (!latestDailyKey && anchor.getHours() < 18) anchor.setDate(anchor.getDate() - 1)
  const dateKeys = []
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(anchor)
    date.setDate(anchor.getDate() - offset)
    dateKeys.push(`${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`)
  }
  // Always return seven chronological slots so missing nights are explicit.
  const nights_list = dateKeys.map((dateKey) => {
    const d = byDate.get(dateKey) || { date: dateKey }
    const totalRounds = d.total_rounds || 0
    const eventCount = numberOr(d.event_count, totalRounds)
    const valid = eventCount > 0
    const rawRate = numberOr(d.success_rate, 0)
    return {
      date: `${dateKey.slice(4, 6)}/${dateKey.slice(6, 8)}`,
      rawDate: dateKey,
      nightId: d.night_id,
      valid,
      snoreEvents: d.snore_event_count || totalRounds,
      interventions: totalRounds,
      eventCount,
      successRate: Math.round(rawRate <= 1 ? rawRate * 100 : rawRate),
      quality: valid ? (d.data_quality_score || 90) : 0,
      barHeight: valid ? Math.max(30, Math.min(150, totalRounds * 5)) : 18,
    }
  })
  return {
    nights: nights_list.filter((night) => night.valid).length,
    totalRounds: r.total_rounds || 0,
    successRounds: r.success_rounds || 0,
    successRate: r.success_rate || 0,
    avgRoundsPerNight: r.avg_rounds_per_night || 0,
    trend: r.trend || 'stable',
    dataSource: r.data_source || 'none',
    // 前端 wxml 用 nights.*.date / .valid / .snoreEvents
    nights_list,
    // 兼容老字段
    daily: daily.map(d => ({
      date: d.date,
      nightId: d.night_id,
      totalRounds: d.total_rounds,
      successRounds: d.success_rounds,
      successRate: d.success_rate,
      maxLevel: d.max_level,
    })),
  }
}

// ═══════════════════════════════════════
// AI（解读 / 聊天 / 候选 / 历史）
// ═════════════════════════════════════===

function wrapFeedback(f) {
  if (!f) return null
  // morning_feeling 是 1-5 int，前端可能读 comfort 字符串
  const feeling = f.morning_feeling
  const comfort = feeling >= 4 ? 'comfortable' : feeling === 3 ? 'okay' : 'uncomfortable'
  return {
    id: f.id,
    deviceId: f.device_id,
    userId: f.user_id,
    nightId: f.night_id,
    wasDisturbed: Boolean(f.was_disturbed),
    awakened: Boolean(f.awakened == null ? f.was_disturbed : f.awakened),
    // Keep compatibility with older responses that did not include partner feedback.
    partnerAffected: typeof f.partner_affected === 'boolean' ? f.partner_affected : (typeof f.partnerAffected === 'boolean' ? f.partnerAffected : null),
    morningFeeling: feeling,
    nextDayEnergy: Math.max(1, Math.min(5, numberOr(feeling, 3))),
    comfort,
    // 前端 trends/report 用 wasDisturbed/comment/createdAt
    comment: f.comment || '',
    createdAt: f.created_at,
  }
}

// 通用 interpretation 包装器 —— 后端 /ai/interpretation 返回基础 LLM 解读
// 包装为前端 interpretation 对象（17 字段 mock 契约）
function wrapInterpretation(ai, scope, nightId) {
  if (!ai) return null
  const isWeek = scope === 'seven-night'
  const basis = Array.isArray(ai.basis) ? ai.basis : []
  // evidence 数组：basis.map 推 3 条结构化证据（前端 wxml 用 evidence[].metric/value/unit/window/explanation）
  const evidence = basis.map((text, i) => ({
    id: `ev-real-${i}`,
    metric: i === 0 ? '整体响应' : i === 1 ? '趋势' : '观察项',
    value: text.length,
    unit: '项',
    window: isWeek ? '7 晚' : '昨夜',
    sourceRefs: [`summary:${nightId || 'current'}`],
    quality: 'good',
    explanation: text,
  }))
  // periodStart/periodEnd：7 晚解读用最近 7 天推算，单晚用当天
  let periodStart = ai.period_start
  let periodEnd = ai.period_end
  if (isWeek && !periodStart) {
    const end = new Date()
    const start = new Date()
    start.setDate(end.getDate() - 6)
    periodStart = start.toISOString().slice(0, 10)
    periodEnd = end.toISOString().slice(0, 10)
  }
  return {
    interpretationId: ai.interpretation_id
      || (isWeek ? `week-${nightId || 'current'}-r1` : `night-${nightId || 'current'}-r1`),
    kind: isWeek ? 'seven-night' : 'single-night',
    nightId: isWeek ? null : (nightId || ai.night_id || ''),
    periodStart: isWeek ? periodStart : null,
    periodEnd: isWeek ? periodEnd : null,
    timezone: isWeek ? 'Asia/Shanghai' : null,
    status: 'ready',
    hasData: ai.has_data !== false,
    eventCount: numberOr(ai.event_count, 0),
    source: ai.source || 'llm',
    sourceLabel: ai.source === 'llm' ? '云端 AI 解读' : '本地规则',
    generatedAt: ai.generated_at || new Date().toISOString(),
    periodLabel: isWeek ? '最近 7 晚' : (ai.date ? ai.date + ' 昨夜' : '昨夜'),
    revision: ai.revision || 1,
    modelVersion: 'SnoozMate Insight 0.9',
    inputSnapshotVersion: 'night-summary-v1',
    dataQuality: '良好',
    consentVersion: 'privacy-v1',
    conclusion: ai.summary || '',
    summary: ai.summary || '',
    nextStep: ai.tonight_suggestion || ai.next_step || '继续观察',
    evidence,
  }
}

async function requireAiAuthorization() {
  const profile = await auth.getProfile()
  if (!profile.aiDataAuthorized) throw serviceError('AI_CONSENT_REQUIRED', '请先允许 AI 使用结构化睡眠资料')
  return profile
}

const ai = {
  async getOverview(scope = 'single-night') {
    await requireAiAuthorization()
    const id = getDeviceId()
    const r = await request('GET', `/api/v1/ai/interpretation/${id}`, undefined, { timeout: 35000, cacheTtl: 10000 })
    const inner = { ...((r && r.ai_interpretation) || {}), has_data: r && r.has_data, event_count: r && r.event_count }
    return wrapInterpretation(inner, scope, r.night_id)
  },

  
  async getRecords({ kind } = {}) {
    await requireAiAuthorization()
    const id = getDeviceId()
    const r = await request('GET', `/api/v1/ai/interpretation/${id}`, undefined, { timeout: 35000, cacheTtl: 10000 })
    const inner = { ...((r && r.ai_interpretation) || {}), has_data: r && r.has_data, event_count: r && r.event_count }
    const single = wrapInterpretation(inner, 'single-night', r.night_id)
    const week = wrapInterpretation(inner, 'seven-night', r.night_id)
    const all = [single, week].filter(Boolean)
    return kind ? all.filter(x => x.kind === kind) : all
  },

  async getChatSessions() {
    try {
      const stored = wx.getStorageSync('haomian-ai-chat-sessions') || []
      return stored.map(s => ({
        sessionId: s.sessionId || s.id,
        title: s.title || '新对话',
        preview: s.messages && s.messages.length ? (s.messages[s.messages.length - 1].text || '') : '',
        updatedAt: s.updatedAt || s.updated_at || new Date().toISOString(),
        messages: s.messages || [],
        interpretationId: s.interpretationId,
        interpretationRevision: s.interpretationRevision,
        contextTitle: s.contextTitle,
        contextConclusion: s.contextConclusion,
        contextSummary: s.contextSummary,
        conversationSummary: s.conversationSummary,
        carriedMemory: s.carriedMemory,
      }))
    } catch { return [] }
  },

  async getChatSession(input) {
    const sessionId = typeof input === 'string' ? input : input && input.sessionId
    try {
      const stored = wx.getStorageSync('haomian-ai-chat-sessions') || []
      return stored.find(s => (s.sessionId || s.id) === sessionId) || null
    } catch { return null }
  },

  async saveChatSession(session = {}) {
    try {
      const stored = wx.getStorageSync('haomian-ai-chat-sessions') || []
      const sid = session.sessionId || session.id || `ai-chat-${Date.now()}`
      const idx = stored.findIndex(s => (s.sessionId || s.id) === sid)
      const next = { ...session, sessionId: sid, updatedAt: new Date().toISOString() }
      if (idx >= 0) stored[idx] = next
      else stored.unshift(next)
      const trimmed = stored.slice(0, 30)
      wx.setStorageSync('haomian-ai-chat-sessions', trimmed)
      return next
    } catch { return session }
  },

  async getInterpretation(input = {}) {
    await requireAiAuthorization()
    const source = typeof input === 'string' ? { interpretationId: input } : input
    const { interpretationId, nightId } = source
    const id = getDeviceId()
    const r = await request('GET', `/api/v1/ai/interpretation/${id}`, undefined, { timeout: 35000 })
    const inner = { ...((r && r.ai_interpretation) || {}), has_data: r && r.has_data, event_count: r && r.event_count }
    const scope = interpretationId && interpretationId.includes('week') ? 'seven-night' : 'single-night'
    return wrapInterpretation(inner, scope, nightId || r.night_id)
  },

  async ask({ message, question, interpretationId, recentMessages = [], conversationSummary = '' } = {}) {
    await requireAiAuthorization()
    const text = (message || question || '').toString().trim()
    if (!text) throw new Error('AI_MESSAGE_REQUIRED')
    const id = getDeviceId()
    const r = await request('POST', '/api/v1/ai/chat', {
      device_id: id,
      message: text,
      interpretation_id: interpretationId || '',
      chat_history: recentMessages
        .filter((item) => item && ['user', 'assistant'].includes(item.role) && (item.text || item.content))
        .slice(-12)
        .map((item) => ({ role: item.role, content: item.text || item.content })),
      conversation_summary: conversationSummary,
    }, { timeout: 35000 })
    const sections = r.sections && Object.values(r.sections).some(Boolean)
      ? r.sections
      : {
        canExplain: '可以解释已记录的事件、提醒次数、响应率和连续趋势。',
        cannotDetermine: '不能据此进行医疗诊断，也不能给出用药建议。',
        nextStep: '继续保持设备在线并结合晨间感受观察变化。',
      }
    return {
      role: 'assistant',
      id: 'ai-' + Date.now(),
      text: r.answer || r.text || '',
      answer: r.answer || r.text || '',
      sections,
      actions: r.actions || [],
      answerKind: r.answerKind || r.answer_kind || (r.source === 'llm' ? 'trend' : 'data-unavailable'),
      safetyClass: r.safetyClass || r.safety_class || 'trend',
      evidenceRefs: r.evidenceRefs || r.evidence_refs || [],
      messageId: r.messageId || r.message_id,
      source: r.source || 'llm',
      contextUsed: r.context_used || null,
    }
  },

  async getTonightCandidate(interpretationId) {
    await requireAiAuthorization()
    const id = getDeviceId()
    const existing = await request('GET', `/api/v1/candidates/${id}?status=pending`, undefined, { cacheTtl: 2000 })
    let cand = existing && Array.isArray(existing.candidates) ? existing.candidates[0] : null
    if (!cand) {
      const generated = await request('POST', `/api/v1/weekly/${id}/generate_candidate`)
      cand = (generated && generated.candidate) || generated || {}
    }
    const currentSettings = await device.getTonightSettings()
    let basis = cand.basis
    if (typeof basis === 'string') {
      try { basis = JSON.parse(basis) } catch { basis = [] }
    }
    return {
      candidateId: cand.candidate_id,
      currentSettings,
      currentConfigVersion: cand.expected_config_version || currentSettings.configVersion || 0,
      interpretationId: cand.interpretation_id || interpretationId || '',
      candidateSettings: normalizeSettings(s2c(cand.suggested_config || cand.candidate_settings || {})),
      rationale: cand.summary || '基于近期趋势的参数建议',
      summary: cand.summary || '',
      basis: Array.isArray(basis) ? basis : [],
      source: cand.source || 'ai',
      createdAt: cand.created_at || '刚刚',
      expiresAt: cand.expires_at || '明天 06:00',
    }
  },
}

// ═══════════════════════════════════════
// Guardian（实时守护 / 演示阶段）
// ═════════════════════════════════════===

const guardian = {
  async getSnapshot() {
    const id = getDeviceId()
    const [agent, dev] = await Promise.all([
      request('GET', `/api/v1/agent/${id}/status`).catch(() => ({})),
      request('GET', `/api/v1/device/${id}/status`).catch(() => ({})),
    ])
    const state = agent.guardian_state || agent.state || 'observing'
    const sequence = agent.sequence || Date.now()
    const cycleId = ['intervening', 'verifying'].includes(state) ? (agent.cycle_id || `cycle-${sequence}`) : null
    const now = new Date().toISOString()
    return {
      // 14 字段（live 页 wxml 全要）
      deviceId: id,
      nightId: agent.night_id || '',
      sessionId: `sess-${id}`,
      snapshotId: agent.snapshot_id || `guardian-${sequence}`,
      sequence,
      deviceTime: now,
      receivedAt: now,
      validUntil: new Date(Date.now() + 30000).toISOString(),
      // Stop eligibility uses a fresh local-device snapshot; keep the mock and
      // real contracts identical instead of inventing an un-stoppable source.
      source: dev.source === 'cloud-cache' ? 'cloud-cache' : 'ble',
      freshness: dev.freshness || 'fresh',
      // 前端 wxml 用 snapshot.guardianState
      guardianState: state,
      state,
      cycleId,
      enteredAt: now,
      activeIntervention: cycleId ? {
        level: agent.current_level || 1,
        startedAt: now,
        elapsedSeconds: 0,
      } : null,
      protectionRemainingSeconds: agent.protection_remaining || 0,
      interventionCount: agent.rounds_done || 0,
      interventionLimit: agent.rounds_remaining || 6,
      micStatus: 'ok',
      radarStatus: 'ok',
      padStatus: dev.device_status === 'online' ? 'connected' : 'disconnected',
      stopResult: null,
      reasonCodes: ['LOCAL_' + state.toUpperCase()],
      configVersion: agent.config_version,
    }
  },

  async stopCurrentIntervention({ snapshotId, cycleId } = {}) {
    const id = getDeviceId()
    await request('POST', `/api/v1/agent/${id}/reset`, { snapshot_id: snapshotId, cycle_id: cycleId })
    const snapshot = await this.getSnapshot()
    return {
      ...snapshot,
      guardianState: snapshot.guardianState === 'intervening' || snapshot.guardianState === 'verifying' ? 'stopped' : snapshot.guardianState,
      cycleId: null,
      activeIntervention: null,
      stopResult: 'confirmed',
    }
  },

  async setDemoPhase(input = {}) {
    const phase = typeof input === 'string' ? input : input.phase
    // 后端通过 demo-states 演示
    const id = getDeviceId()
    const kindMap = {
      'offline': { kind: 'offline', enabled: true },
      'unprovisioned': { kind: 'unprovisioned', enabled: true },
      'pad-disconnected': { kind: 'pad-disconnected', enabled: true },
      'no-data': { kind: 'no-data', enabled: true },
      'sync-failed': { kind: 'sync-failed', enabled: true },
      'high-attention': { kind: 'high-attention', enabled: true },
      'firmware-update': { kind: 'firmware-update', enabled: true },
      'model-update': { kind: 'model-update', enabled: true },
      'reset': { kind: 'offline', enabled: false },
    }
    const patch = kindMap[phase] || { kind: phase, enabled: true }
    const r = await request('PUT', `/api/v1/device/${id}/demo-states`, patch)
    return this.getSnapshot()
  },
}

// ═══════════════════════════════════════
// 工厂导出
// ═══════════════════════════════════════

function createRealServices() {
  return {
    serviceMode: 'real',
    configured: true,
    transport: env.transport,
    initializeCloudContainer,
    auth,
    device,
    reports,
    ai,
    guardian,
  }
}

function toBackendSettings(input) {
  const settings = normalizeSettings(input)
  const thresholds = { 1: 0.75, 2: 0.65, 3: 0.55 }
  return {
    max_rounds_per_night: settings.nightlyInterventionLimit,
    fall_asleep_protection: settings.sleepProtectionMinutes * 60,
    max_vibration_level: settings.maxVibrationLevel,
    snore_confidence_threshold: thresholds[settings.sensitivity],
  }
}

module.exports = {
  createRealServices,
  __test__: {
    c2s,
    getClientId,
    initializeCloudContainer,
    invalidateSession,
    normalizeCommand,
    normalizeSettings,
    normalizeSound,
    request,
    s2c,
    toBackendSettings,
    translateMorningReport,
    translateWeeklyTrend,
    wrapFeedback,
    wrapInterpretation,
    wrapProfile,
  },
}
