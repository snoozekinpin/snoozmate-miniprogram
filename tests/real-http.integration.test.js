const assert = require('assert')

const baseUrl = process.env.SNOOZMATE_TEST_API_BASE
if (!baseUrl) {
  console.error('Set SNOOZMATE_TEST_API_BASE before running this integration test.')
  process.exit(2)
}

const storage = new Map()
global.wx = {
  getStorageSync(key) { return storage.get(key) },
  setStorageSync(key, value) { storage.set(key, value) },
  removeStorageSync(key) { storage.delete(key) },
  request(options) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeout || 5000)
    fetch(options.url, {
      method: options.method,
      headers: options.header,
      body: options.data === undefined ? undefined : JSON.stringify(options.data),
      signal: controller.signal,
    }).then(async (response) => {
      const text = await response.text()
      let data = {}
      try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
      options.success({ statusCode: response.status, data })
    }).catch((error) => {
      options.fail({
        errMsg: error.name === 'AbortError' ? 'request:fail timeout' : `request:fail ${error.message}`,
      })
    }).finally(() => clearTimeout(timeout))
    return { abort() { controller.abort() } }
  },
}

const env = require('../config/env')
env.apiBaseUrl = baseUrl
env.transport = 'public'
const services = require('../services/real/index').createRealServices()

async function post(path, body, token = '') {
  const response = await fetch(baseUrl + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  assert.ok(response.ok, `${path} returned ${response.status}`)
  return response.json()
}

async function run() {
  const started = Date.now()
  const session = await services.auth.login({ code: 'wx-integration-code', force: true })
  assert.ok(session.sessionId)
  const profile = await services.auth.saveProfile({
    nickname: 'Mini Integration',
    privacyAccepted: true,
    aiDataAuthorized: true,
  })
  assert.strictEqual(profile.aiDataAuthorized, true)

  const discovered = await services.device.discover({})
  assert.strictEqual(discovered.length, 1)
  assert.ok(/^SM-MOON-[A-Z0-9]{4}$/.test(discovered[0].serialNumber))
  await services.device.bind(discovered[0])

  const status = await services.device.getStatus()
  assert.strictEqual(status.controlAvailable, true)
  const calibration = await services.device.runCalibration()
  assert.strictEqual(calibration.ready, true)

  const settings = await services.device.saveTonightSettings({
    sleepMode: 'shared',
    sensitivity: 3,
    maxVibrationLevel: 4,
    sleepProtectionMinutes: 45,
    nightlyInterventionLimit: 8,
  })
  assert.deepStrictEqual(
    {
      sleepMode: settings.sleepMode,
      sensitivity: settings.sensitivity,
      maxVibrationLevel: settings.maxVibrationLevel,
      sleepProtectionMinutes: settings.sleepProtectionMinutes,
      nightlyInterventionLimit: settings.nightlyInterventionLimit,
    },
    {
      sleepMode: 'shared',
      sensitivity: 3,
      maxVibrationLevel: 4,
      sleepProtectionMinutes: 45,
      nightlyInterventionLimit: 8,
    },
  )

  const timestamp = Math.floor(Date.now() / 1000) - 120
  const batch = await post('/api/v1/events/batch', {
    device_id: status.deviceId,
    events: [
      { timestamp, event_type: 'intervention', round_in_night: 1, vibration_level: 2 },
      {
        timestamp: timestamp + 20,
        event_type: 'position_change',
        round_in_night: 1,
        result: 'success',
        response_time_sec: 20,
      },
    ],
  })
  assert.strictEqual(batch.inserted, 2)

  const report = await services.reports.getLatest({ nightId: batch.night_ids[0] })
  assert.strictEqual(report.hasData, true)
  assert.strictEqual(report.dataSource, 'device')
  assert.strictEqual(report.interventionCount, 1)
  assert.strictEqual(report.snoreStoppedResponses + report.turnOverResponses, 1)
  const events = await services.reports.getEvents({ nightId: batch.night_ids[0] })
  assert.ok(events.length >= 2)

  const overview = await services.ai.getOverview('single-night')
  assert.ok(overview.interpretationId)
  assert.ok(overview.summary)
  const answer = await services.ai.ask({
    interpretationId: overview.interpretationId,
    message: 'What does the recorded trend show?',
    recentMessages: [{ role: 'user', text: 'Please use the latest report.' }],
  })
  assert.ok(answer.text)
  assert.ok(answer.sections)
  await new Promise((resolve) => setTimeout(resolve, 1100))
  const syncedStatus = await services.device.getStatus()
  assert.strictEqual(syncedStatus.hasData, true)
  assert.strictEqual(syncedStatus.dataSource, 'device')

  const sound = await services.device.updateSound({ scene: 'reading', volume: 37 })
  assert.strictEqual(sound.scene, 'reading')
  assert.strictEqual(sound.volume, 37)
  const light = await services.device.updateLight({ enabled: true, brightness: 29 })
  assert.strictEqual(light.brightness, 29)

  const feedback = await services.reports.submitFeedback({
    nightId: batch.night_ids[0],
    awakened: false,
    partnerAffected: false,
    nextDayEnergy: 4,
  })
  assert.strictEqual(feedback.partnerAffected, false)
  assert.strictEqual(feedback.nextDayEnergy, 4)

  const candidate = await services.ai.getTonightCandidate(overview.interpretationId)
  assert.ok(candidate.candidateId)
  const command = await services.device.applyTonightCandidate({
    candidateId: candidate.candidateId,
    expectedConfigVersion: candidate.currentConfigVersion,
  })
  assert.strictEqual(command.status, 'applied')
  assert.strictEqual(command.matchesCandidate, true)

  const readsStarted = Date.now()
  await Promise.all(Array.from({ length: 60 }, (_, index) => (
    index % 3 === 0
      ? services.device.getStatus()
      : index % 3 === 1
        ? services.reports.getLatest({ nightId: batch.night_ids[0] })
        : services.reports.getSevenNightTrend()
  )))
  const concurrentReadMs = Date.now() - readsStarted
  assert.ok(concurrentReadMs < 2500, `Concurrent adapter reads took ${concurrentReadMs}ms`)

  console.log(JSON.stringify({
    status: 'passed',
    total_ms: Date.now() - started,
    concurrent_adapter_reads_ms: concurrentReadMs,
    report_events: events.length,
    ai_source: answer.source,
    candidate_status: command.status,
  }, null, 2))
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
