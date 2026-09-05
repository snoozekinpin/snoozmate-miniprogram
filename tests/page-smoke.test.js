const assert = require('assert')
const path = require('path')

const storage = new Map()
const audio = {
  src: '',
  volume: 0,
  autoplay: false,
  loop: false,
  stop() {},
  play() {},
  pause() {},
  destroy() {},
  onCanplay() {},
  onPlay() {},
  onPause() {},
  onStop() {},
  onEnded() {},
  onError() {},
}

global.wx = {
  getStorageSync(key) { return storage.get(key) },
  setStorageSync(key, value) { storage.set(key, value) },
  removeStorageSync(key) { storage.delete(key) },
  login({ success }) { setImmediate(() => success({ code: 'mock-code' })) },
  showModal({ success }) { setImmediate(() => success({ confirm: true })) },
  showToast() {},
  navigateTo() {},
  navigateBack() {},
  reLaunch() {},
  switchTab() {},
  stopPullDownRefresh() {},
  setNavigationBarTitle() {},
  createInnerAudioContext() { return { ...audio } },
}

const services = require('../services/index')
const mock = services.createServices({ mode: 'mock' })
for (const group of ['auth', 'device', 'reports', 'ai', 'guardian']) {
  Object.assign(services[group], mock[group])
}
services.serviceMode = 'mock'

function instantiate(definition) {
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

function loadPage(name) {
  let definition = null
  global.Page = (page) => { definition = page }
  const filename = path.resolve(__dirname, `../pages/${name}/index.js`)
  delete require.cache[require.resolve(filename)]
  require(filename)
  assert.ok(definition, `${name} must register a Page`)
  return instantiate(definition)
}

async function within(label, operation, milliseconds = 3000) {
  let timer
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function assertLoaded(name, page) {
  if (Object.prototype.hasOwnProperty.call(page.data, 'loading')) {
    assert.strictEqual(page.data.loading, false, `${name} left loading=true`)
  }
  assert.ok(!page.data.error, `${name} returned an error`)
  assert.ok(!page.data.loadError, `${name} returned a load error`)
}

async function run() {
  const onboarding = loadPage('onboarding')
  await within('onboarding login', () => onboarding.login())
  assert.strictEqual(onboarding.data.phase, 'profile')
  await within('onboarding profile', () => onboarding.saveProfile())
  await within('onboarding privacy', () => onboarding.acceptPrivacy())
  assert.strictEqual(storage.get('haomian-setup-mode'), 'normal')

  const setup = loadPage('setup')
  await within('setup search', () => setup.startSearch())
  assert.strictEqual(setup.data.machine.step, 'found')
  await within('setup connect', () => setup.connect())
  setup.data.password = 'test-password'
  await within('setup provision', () => setup.provision())
  assert.strictEqual(setup.data.machine.step, 'success')

  const calibration = loadPage('calibration')
  await within('calibration', () => calibration.run())
  assert.strictEqual(calibration.data.phase, 'ready')

  const readiness = loadPage('readiness')
  await within('readiness', () => readiness.load())
  assert.strictEqual(readiness.data.readiness.ready, true)

  await services.auth.saveProfile({ aiDataAuthorized: true })
  const scenarios = [
    ['home', 'loadData', []],
    ['report', 'load', []],
    ['ai', 'load', []],
    ['trends', 'load', []],
    ['profile', 'load', []],
    ['device', 'load', []],
    ['tonight', 'load', []],
    ['sound', 'load', []],
    ['light', 'load', []],
    ['events', 'load', []],
    ['live', 'load', []],
  ]
  const pages = {}
  for (const [name, method, args] of scenarios) {
    const page = loadPage(name)
    pages[name] = page
    await within(`${name}.${method}`, () => page[method](...args))
    assertLoaded(name, page)
  }
  assert.strictEqual(pages.events.data.nightId, 'night-2026-08-31')
  assert.ok(pages.events.data.nightLabel.includes('最近一晚'))

  const overview = await services.ai.getOverview('single-night')
  const detail = loadPage('ai-detail')
  await within('ai-detail', () => detail.load(overview.interpretationId))
  assertLoaded('ai-detail', detail)

  const chat = loadPage('ai-chat')
  await within('ai-chat', () => chat.loadContext(overview.interpretationId))
  assertLoaded('ai-chat', chat)

  const plan = loadPage('ai-plan')
  await within('ai-plan', () => plan.loadCandidate(overview.interpretationId))
  assertLoaded('ai-plan', plan)

  await new Promise((resolve) => setTimeout(resolve, 300))
  assert.strictEqual(pages.report.data.phase, 'data')
  assert.strictEqual(pages.home.data.morningReportState, 'ready')
  pages.sound.onUnload()
  pages.ai.onUnload()
  console.log('All 18 mini program pages passed normal-state smoke tests.')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
