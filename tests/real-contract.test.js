const assert = require('assert')
const path = require('path')

const storage = new Map()
let requestCount = 0
let requestHandler = null
const env = require('../config/env')
env.transport = 'public'

global.wx = {
  getStorageSync(key) { return storage.get(key) },
  setStorageSync(key, value) { storage.set(key, value) },
  removeStorageSync(key) { storage.delete(key) },
  request(options) {
    requestCount += 1
    const task = { abort() {} }
    if (requestHandler) setImmediate(() => requestHandler(options))
    return task
  },
}

const realModule = require('../services/real/index')
const services = realModule.createRealServices()
const helpers = realModule.__test__
const appServices = require('../services/index')

function instantiatePage(definition) {
  return {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) {
      for (const [key, value] of Object.entries(patch)) {
        const parts = key.split('.')
        let target = this.data
        while (parts.length > 1) {
          const part = parts.shift()
          target[part] = target[part] || {}
          target = target[part]
        }
        target[parts[0]] = value
      }
    },
  }
}

async function testSettingsMapping() {
  assert.deepStrictEqual(
    helpers.normalizeSettings({
      max_rounds_per_night: 7,
      fall_asleep_protection: 2700,
      max_vibration_level: 4,
      snore_confidence_threshold: 0.55,
      mode: 'partner',
    }),
    {
      sleepMode: 'shared',
      sensitivity: 3,
      maxVibrationLevel: 4,
      sleepProtectionMinutes: 45,
      nightlyInterventionLimit: 7,
    },
  )
  assert.deepStrictEqual(
    helpers.toBackendSettings({
      sleepMode: 'solo',
      sensitivity: 1,
      maxVibrationLevel: 5,
      sleepProtectionMinutes: 30,
      nightlyInterventionLimit: 8,
    }),
    {
      max_rounds_per_night: 8,
      fall_asleep_protection: 1800,
      max_vibration_level: 5,
      snore_confidence_threshold: 0.75,
    },
  )
}

async function testDataSemantics() {
  const empty = helpers.translateMorningReport({
    night_id: 'empty-night',
    has_data: false,
    event_count: 0,
    timeline: [],
    reminder_stats: {},
    weekly_trend: {},
  })
  assert.strictEqual(empty.hasData, false)
  assert.strictEqual(empty.dataSource, 'none')
  assert.strictEqual(empty.dataQualityScore, 0)
  assert.strictEqual(empty.startTime, '')

  const anchor = new Date()
  if (anchor.getHours() < 18) anchor.setDate(anchor.getDate() - 1)
  const dateKey = `${anchor.getFullYear()}${String(anchor.getMonth() + 1).padStart(2, '0')}${String(anchor.getDate()).padStart(2, '0')}`
  const trend = helpers.translateWeeklyTrend({
    daily: [{
      date: dateKey,
      night_id: `${dateKey}_device`,
      event_count: 8,
      total_rounds: 2,
      success_rate: 0.5,
    }],
  })
  assert.strictEqual(trend.nights_list.length, 7)
  assert.strictEqual(trend.nights_list.filter((night) => night.valid).length, 1)
  assert.strictEqual(trend.nights_list[6].successRate, 50)
  assert.strictEqual(trend.dataSource, 'none')
}

async function testLoginCacheAndDeduplication() {
  storage.clear()
  requestCount = 0
  requestHandler = (options) => {
    assert.strictEqual(options.url.endsWith('/api/v1/auth/login'), true)
    assert.ok(options.data.client_id)
    options.success({
      statusCode: 200,
      data: {
        user_id: 'client-user',
        session_token: 'session-1',
        expires_at: new Date(Date.now() + 60000).toISOString(),
        profile: { id: 'client-user', nickname: 'Tester', privacyAccepted: true },
      },
    })
  }
  const [first, second] = await Promise.all([
    services.auth.login({ code: 'wx-code', force: true }),
    services.auth.login({ code: 'wx-code', force: true }),
  ])
  assert.strictEqual(requestCount, 1)
  assert.strictEqual(first.sessionId, 'session-1')
  assert.strictEqual(second.sessionId, 'session-1')
  await services.auth.login({})
  assert.strictEqual(requestCount, 1)
}

async function testProfileAndSettingsContracts() {
  let savedProfileBody = null
  let savedConfigBody = null
  requestHandler = (options) => {
    if (options.url.endsWith('/api/v1/user/me/profile')) {
      savedProfileBody = options.data
      options.success({
        statusCode: 200,
        data: {
          id: 'client-user',
          nickname: options.data.nickname,
          sleepMode: options.data.sleepMode,
          privacyAccepted: options.data.privacyAccepted,
          aiDataAuthorized: options.data.aiDataAuthorized,
        },
      })
      return
    }
    if (options.method === 'GET' && options.url.includes('/config')) {
      options.success({
        statusCode: 200,
        data: {
          mode: 'partner',
          config_version: 4,
          config: {
            max_rounds_per_night: 7,
            fall_asleep_protection: 2700,
            max_vibration_level: 4,
            snore_confidence_threshold: 0.55,
          },
        },
      })
      return
    }
    if (options.method === 'PUT' && options.url.includes('/config')) {
      savedConfigBody = options.data
      options.success({
        statusCode: 200,
        data: { mode: options.data.mode, config_version: 5, config: options.data.config },
      })
      return
    }
    throw new Error(`Unexpected request: ${options.method} ${options.url}`)
  }
  const profile = await services.auth.saveProfile({ aiDataAuthorized: true })
  assert.strictEqual(profile.aiDataAuthorized, true)
  assert.strictEqual(savedProfileBody.aiDataAuthorized, true)
  assert.strictEqual(savedProfileBody.ai_data_authorized, true)

  const settings = await services.device.getTonightSettings()
  assert.strictEqual(settings.sleepMode, 'shared')
  assert.strictEqual(settings.maxVibrationLevel, 4)
  const saved = await services.device.saveTonightSettings({
    sleepMode: 'solo',
    sensitivity: 1,
    maxVibrationLevel: 5,
    sleepProtectionMinutes: 30,
    nightlyInterventionLimit: 8,
  })
  assert.strictEqual(saved.sleepMode, 'solo')
  assert.strictEqual(savedConfigBody.mode, 'solo')
  assert.strictEqual(savedConfigBody.config.max_rounds_per_night, 8)
  assert.strictEqual(savedConfigBody.config.fall_asleep_protection, 1800)
}

async function testProfileRefreshAfterAppRestart() {
  storage.set('haomian-profile', {
    id: 'client-user',
    nickname: 'Stale',
    privacyAccepted: true,
    aiDataAuthorized: false,
  })
  storage.set('haomian-session-token', 'session-1')
  let profileReads = 0
  requestHandler = (options) => {
    assert.strictEqual(options.url.endsWith('/api/v1/user/me/profile'), true)
    profileReads += 1
    options.success({
      statusCode: 200,
      data: {
        id: 'client-user',
        nickname: 'Server Profile',
        privacyAccepted: true,
        aiDataAuthorized: true,
      },
    })
  }
  const modulePath = require.resolve('../services/real/index')
  delete require.cache[modulePath]
  const freshServices = require(modulePath).createRealServices()
  const profile = await freshServices.auth.getProfile()
  assert.strictEqual(profileReads, 1)
  assert.strictEqual(profile.nickname, 'Server Profile')
  assert.strictEqual(profile.aiDataAuthorized, true)
}

async function testFeedbackAndChatStorage() {
  requestHandler = (options) => {
    if (options.url.endsWith('/api/v1/morning_feedback')) {
      assert.strictEqual(options.data.partner_affected, true)
      options.success({
        statusCode: 200,
        data: {
          feedback: {
            id: 1,
            device_id: 'device_esp32_real_001',
            night_id: 'night-1',
            was_disturbed: true,
            partner_affected: true,
            morning_feeling: 4,
          },
        },
      })
      return
    }
    throw new Error(`Unexpected request: ${options.method} ${options.url}`)
  }
  const feedback = await services.reports.submitFeedback({
    nightId: 'night-1',
    awakened: true,
    partnerAffected: true,
    nextDayEnergy: 4,
  })
  assert.strictEqual(feedback.awakened, true)
  assert.strictEqual(feedback.partnerAffected, true)
  assert.strictEqual(feedback.nextDayEnergy, 4)

  const saved = await services.ai.saveChatSession({
    interpretationId: 'night-1-r1',
    title: 'Question',
    messages: [{ role: 'user', text: 'Hello' }],
  })
  const restored = await services.ai.getChatSession(saved.sessionId)
  assert.strictEqual(restored.sessionId, saved.sessionId)
  assert.strictEqual((await services.ai.getChatSessions()).length, 1)
}

async function testFastReportAndAiChatContract() {
  storage.set('haomian-profile', {
    id: 'client-user',
    nickname: 'Tester',
    privacyAccepted: true,
    aiDataAuthorized: true,
  })
  let sawReportWithoutAi = false
  let sawNightFilter = false
  let sawHistory = false
  requestHandler = (options) => {
    if (options.url.includes('/morning_report/')) {
      sawReportWithoutAi = options.url.includes('generate_ai=false')
      options.success({
        statusCode: 200,
        data: {
          night_id: 'night-fast',
          date: '2026-09-03',
          timeline: [],
          reminder_stats: { total_count: 0, success_count: 0, success_rate: 0 },
          weekly_trend: {},
          ai_interpretation: {},
        },
      })
      return
    }
    if (options.url.includes('/events/')) {
      sawNightFilter = options.url.includes('/night/night-fast')
      options.success({
        statusCode: 200,
        data: {
          night_id: 'night-fast',
          events: [{
            id: 1,
            timestamp: 1788500000,
            event_type: 'in_bed',
          }],
        },
      })
      return
    }
    if (options.url.endsWith('/api/v1/ai/chat')) {
      sawHistory = Array.isArray(options.data.chat_history)
        && options.data.chat_history.length === 2
        && options.data.chat_history[0].content === 'Question'
      options.success({
        statusCode: 200,
        data: {
          answer: 'Answer',
          source: 'rule_based',
          answer_kind: 'trend',
          sections: {
            canExplain: 'Recorded events',
            cannotDetermine: 'Diagnosis',
            nextStep: 'Keep recording',
          },
        },
      })
      return
    }
    throw new Error(`Unexpected request: ${options.method} ${options.url}`)
  }
  const report = await services.reports.getLatest()
  assert.strictEqual(report.nightId, 'night-fast')
  assert.strictEqual(sawReportWithoutAi, true)
  const events = await services.reports.getEvents({ nightId: 'night-fast' })
  assert.strictEqual(events.length, 1)
  assert.strictEqual(sawNightFilter, true)
  const answer = await services.ai.ask({
    interpretationId: 'night-fast-r1',
    message: 'Follow up',
    recentMessages: [
      { role: 'user', text: 'Question' },
      { role: 'assistant', text: 'Previous answer' },
    ],
  })
  assert.strictEqual(answer.text, 'Answer')
  assert.strictEqual(answer.answerKind, 'trend')
  assert.strictEqual(answer.sections.nextStep, 'Keep recording')
  assert.strictEqual(sawHistory, true)
}

async function testLegacyAiResponseGetsSections() {
  storage.set('haomian-profile', {
    id: 'client-user',
    nickname: 'Tester',
    privacyAccepted: true,
    aiDataAuthorized: true,
  })
  requestHandler = (options) => {
    assert.strictEqual(options.url.endsWith('/api/v1/ai/chat'), true)
    options.success({ statusCode: 200, data: { answer: 'Legacy answer', source: 'llm' } })
  }
  const answer = await services.ai.ask({ message: 'Summarize this' })
  assert.strictEqual(answer.source, 'llm')
  assert.ok(answer.sections.canExplain)
  assert.ok(answer.sections.cannotDetermine)
  assert.ok(answer.sections.nextStep)
  assert.strictEqual(answer.answerKind, 'trend')
}

async function testOnboardingAndProvisionedSetupFlow() {
  let pageDefinition = null
  let navigatedTo = ''
  global.Page = (definition) => { pageDefinition = definition }
  wx.navigateTo = ({ url }) => { navigatedTo = url }
  wx.switchTab = ({ url }) => { navigatedTo = url }
  wx.showToast = () => {}
  wx.login = ({ success }) => success({ code: 'fresh-wx-code' })
  storage.set('haomian-setup-complete', true)
  let loginInput = null
  appServices.auth.login = async (input) => {
    loginInput = input
    return { profile: { nickname: 'Tester', sleepMode: 'shared' } }
  }
  appServices.auth.saveProfile = async (patch) => ({
    id: 'client-user',
    nickname: 'Tester',
    sleepMode: 'shared',
    privacyAccepted: Boolean(patch.privacyAccepted),
    aiDataAuthorized: true,
  })
  const onboardingPath = path.resolve(__dirname, '../pages/onboarding/index.js')
  delete require.cache[require.resolve(onboardingPath)]
  require(onboardingPath)
  const reauth = instantiatePage(pageDefinition)
  reauth._reauth = true
  await reauth.login()
  assert.strictEqual(loginInput.force, true)
  assert.strictEqual(loginInput.code, 'fresh-wx-code')
  const onboarding = instantiatePage(pageDefinition)
  await onboarding.acceptPrivacy()
  assert.strictEqual(navigatedTo, '/pages/setup/index')
  assert.strictEqual(storage.has('haomian-setup-complete'), false)
  assert.strictEqual(storage.get('haomian-setup-mode'), 'normal')

  appServices.device.bind = async (input) => {
    assert.strictEqual(input.deviceId, 'device-real')
    assert.strictEqual(input.serialNumber, 'SM-MOON-0001')
    return { bound: true }
  }
  const setupPath = path.resolve(__dirname, '../pages/setup/index.js')
  delete require.cache[require.resolve(setupPath)]
  require(setupPath)
  const setup = instantiatePage(pageDefinition)
  setup.data.serialNumber = 'SM-MOON-0001'
  setup.data.machine = {
    step: 'found',
    device: {
      deviceId: 'device-real',
      serialNumber: 'SM-MOON-0001',
      provisioned: true,
    },
    reason: null,
    retryStep: 'searching',
  }
  await setup.connect()
  assert.strictEqual(setup.data.machine.step, 'success')
}

async function testHomeLoadsPartialDataWithoutFreezing() {
  let pageDefinition = null
  global.Page = (definition) => { pageDefinition = definition }
  appServices.device.getStatus = async () => ({ controlAvailable: true, online: true })
  appServices.device.getTonightSettings = async () => ({ sleepMode: 'solo' })
  appServices.device.getSoundState = async () => { throw Object.assign(new Error('offline'), { code: 'DEVICE_OFFLINE' }) }
  appServices.device.getLightState = async () => ({ enabled: true })
  appServices.device.getActiveSettingsCommand = async () => null
  appServices.guardian.getSnapshot = async () => ({ guardianState: 'observing' })
  appServices.reports.getLatest = async () => ({ id: 'night-home' })
  const homePath = path.resolve(__dirname, '../pages/home/index.js')
  delete require.cache[require.resolve(homePath)]
  require(homePath)
  const home = instantiatePage(pageDefinition)
  await home.loadData()
  assert.strictEqual(home.data.loading, false)
  assert.strictEqual(home.data.status.online, true)
  assert.strictEqual(home.data.light.enabled, true)
  assert.strictEqual(home.data.error, null)
  assert.ok(home.data.partialError)
  assert.strictEqual(home.data.morningReportState, 'ready')
}

async function testTrendsTreatsMissingEventsAsEmpty() {
  let pageDefinition = null
  let feedbackRead = false
  global.Page = (definition) => { pageDefinition = definition }
  appServices.reports.getSevenNightTrend = async () => Array.from(
    { length: 7 },
    (_, index) => ({ date: `09/0${index + 1}`, valid: false, successRate: 0, barHeight: 18 }),
  )
  appServices.reports.getLatest = async () => ({ id: 'empty-night', hasData: false, attentionLevel: 'stable' })
  appServices.reports.getFeedback = async () => {
    feedbackRead = true
    return null
  }
  const trendsPath = path.resolve(__dirname, '../pages/trends/index.js')
  delete require.cache[require.resolve(trendsPath)]
  require(trendsPath)
  const trends = instantiatePage(pageDefinition)
  await trends.load()
  assert.strictEqual(trends.data.loading, false)
  assert.strictEqual(trends.data.phase, 'empty')
  assert.strictEqual(trends.data.currentNightId, '')
  assert.strictEqual(feedbackRead, false)
}

async function testRequestDeduplicationAndTimeout() {
  helpers.invalidateSession()
  requestCount = 0
  requestHandler = (options) => setTimeout(() => options.success({ statusCode: 200, data: { ok: true } }), 5)
  const [a, b] = await Promise.all([
    helpers.request('GET', '/dedupe', undefined, { cacheTtl: 0, timeout: 100 }),
    helpers.request('GET', '/dedupe', undefined, { cacheTtl: 0, timeout: 100 }),
  ])
  assert.deepStrictEqual(a, { ok: true })
  assert.deepStrictEqual(b, { ok: true })
  assert.strictEqual(requestCount, 1)

  requestHandler = null
  const started = Date.now()
  await assert.rejects(
    helpers.request('GET', '/timeout', undefined, { cacheTtl: 0, timeout: 20 }),
    (error) => error.code === 'SYNC_TIMEOUT',
  )
  assert.ok(Date.now() - started < 500)
}

async function testCloudContainerTransport() {
  const env = require('../config/env')
  const previousTransport = env.transport
  const previousCloud = wx.cloud
  const calls = []
  let initOptions = null
  try {
    env.transport = 'auto'
    wx.cloud = {
      init(options) { initOptions = options },
      callContainer(options) {
        calls.push(options)
        return Promise.resolve({ statusCode: 200, data: { ok: true } })
      },
    }
    const response = await helpers.request(
      'GET',
      '/cloud-container-contract',
      undefined,
      { cacheTtl: 0, timeout: 30000 },
    )
    assert.deepStrictEqual(response, { ok: true })
    assert.deepStrictEqual(initOptions, { env: env.cloudEnvId, traceUser: true })
    assert.strictEqual(calls.length, 1)
    assert.strictEqual(calls[0].config.env, env.cloudEnvId)
    assert.strictEqual(calls[0].path, '/cloud-container-contract')
    assert.strictEqual(calls[0].header['X-WX-SERVICE'], env.cloudServiceName)
    assert.strictEqual(calls[0].timeout, 15000)

    env.transport = 'cloud-container'
    wx.cloud = undefined
    assert.throws(
      () => helpers.request('GET', '/cloud-container-required', undefined, { cacheTtl: 0 }),
      (error) => error.code === 'CLOUD_NOT_CONFIGURED',
    )
  } finally {
    env.transport = previousTransport
    wx.cloud = previousCloud
  }
}

async function testAppInitializesCloudContainer() {
  const env = require('../config/env')
  const previousTransport = env.transport
  const previousCloud = wx.cloud
  const previousApp = global.App
  let appDefinition = null
  try {
    env.transport = 'cloud-container'
    wx.cloud = {
      init() {},
      callContainer() { return Promise.resolve({ statusCode: 200, data: {} }) },
    }
    global.App = (definition) => { appDefinition = definition }
    const appPath = path.resolve(__dirname, '../app.js')
    delete require.cache[require.resolve(appPath)]
    require(appPath)
    assert.ok(appDefinition)
    appDefinition.onLaunch.call(appDefinition)
    assert.strictEqual(appDefinition.globalData.cloudContainer, true)
  } finally {
    env.transport = previousTransport
    wx.cloud = previousCloud
    global.App = previousApp
  }
}

async function testSoundLifecycle() {
  for (const name of ['sleep.mp3', 'healing.mp3', 'work.mp3', 'reading.mp3']) {
    const file = path.resolve(__dirname, '../audio', name)
    assert.ok(require('fs').statSync(file).size > 1024, `${name} must be packaged and non-empty`)
  }
  let pageDefinition = null
  let playCount = 0
  let pauseCount = 0
  let destroyCount = 0
  let canplayHandler = null
  const audio = {
    src: '',
    volume: 0,
    stop() {},
    play() { playCount += 1 },
    pause() { pauseCount += 1 },
    destroy() { destroyCount += 1 },
    onCanplay(handler) { canplayHandler = handler },
    onPlay() {},
    onPause() {},
    onStop() {},
    onEnded() {},
    onError() {},
  }
  wx.createInnerAudioContext = () => audio
  global.Page = (definition) => { pageDefinition = definition }
  const soundPath = path.resolve(__dirname, '../pages/sound/index.js')
  delete require.cache[soundPath]
  require(soundPath)
  const page = instantiatePage(pageDefinition)
  page.data.sound = {
    scene: 'sleep',
    volume: 32,
    scenes: [{ id: 'sleep', name: 'Sleep', trackName: 'Sleep' }],
  }
  page.data.volumeDraft = 32
  page.preparePreviewSource(page.data.sound)
  assert.strictEqual(audio.src, '/audio/sleep.mp3')
  assert.strictEqual(audio.obeyMuteSwitch, false)
  page.togglePreview()
  assert.strictEqual(playCount, 1)
  page.data.previewPlaying = true
  page.onHide()
  assert.strictEqual(pauseCount, 1)
  page.onUnload()
  assert.strictEqual(destroyCount, 1)
  assert.strictEqual(typeof canplayHandler, 'function')
}

async function run() {
  await testSettingsMapping()
  await testDataSemantics()
  await testLoginCacheAndDeduplication()
  await testProfileAndSettingsContracts()
  await testProfileRefreshAfterAppRestart()
  await testFeedbackAndChatStorage()
  await testFastReportAndAiChatContract()
  await testLegacyAiResponseGetsSections()
  await testOnboardingAndProvisionedSetupFlow()
  await testHomeLoadsPartialDataWithoutFreezing()
  await testTrendsTreatsMissingEventsAsEmpty()
  await testRequestDeduplicationAndTimeout()
  await testCloudContainerTransport()
  await testAppInitializesCloudContainer()
  await testSoundLifecycle()
  console.log('Mini program real-service contract tests passed.')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
