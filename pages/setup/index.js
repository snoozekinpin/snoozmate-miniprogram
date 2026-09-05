const services = require('../../services/index')
const { initialSetupState, transitionSetup } = require('../../domain/setup-machine')
const { normalizeSerialNumber, isValidSerialNumber, matchesDiscoveredDevice } = require('../../domain/device-identity')

const errorCopy = {
  BLUETOOTH_DISABLED: '请打开手机蓝牙后重试',
  NOT_FOUND: '附近没有发现月石床头主机',
  CONNECT_FAILED: '连接没有完成，请靠近设备重试',
  WIFI_CREDENTIALS_REQUIRED: '请输入 2.4G Wi-Fi 名称和密码',
  INVALID_SN: '设备 SN 格式不正确，请扫码或输入 SM-MOON-XXXX。',
  IDENTITY_MISMATCH: '扫码 SN 与附近设备不一致，请重新搜索。',
  MULTIPLE_DEVICES: '附近发现多台月石，请仅保留需要连接的设备处于配对状态。',
  ALREADY_BOUND: '该月石床头主机已被绑定，请先在原账号解绑。',
  WIFI_5G_UNSUPPORTED: '当前 Wi-Fi 不受支持，月石仅支持 2.4G Wi-Fi。',
  WIFI_PASSWORD_REJECTED: 'Wi-Fi 密码未通过验证，请确认后重试。',
  PROVISION_TIMEOUT: '配网超时，请靠近主机后重试。',
  AUTH_EXPIRED: '登录状态已过期，请重新授权后继续。',
}

Page({
  data: {
    machine: initialSetupState(),
    serialNumber: '',
    ssid: 'Moonstone-2.4G',
    password: '',
    errorMessage: '',
    errorCode: '',
    errorAction: '',
    scanFeedback: '',
  },

  onLoad(options = {}) {
    const serialNumber = normalizeSerialNumber(options.serialNumber || this.data.serialNumber)
    if (serialNumber !== this.data.serialNumber) this.setData({ serialNumber })
    // 演示模式：直接进首页，不跑硬件配对流程
    if (options.demo === '1' || wx.getStorageSync('haomian-demo-mode')) {
      this.completeDemoSetup()
      wx.switchTab({ url: '/pages/home/index' })
      return
    }
    return this.startSearch()
  },

  onUnload() {
    this._searchRequestId = (this._searchRequestId || 0) + 1
    this._searching = false
  },

  setMachine(event) {
    const machine = transitionSetup(this.data.machine, event)
    this.setData({
      machine,
      errorCode: machine.reason || '',
      errorAction: machine.reason === 'AUTH_EXPIRED' ? 'reauth' : '',
      errorMessage: machine.reason ? (errorCopy[machine.reason] || '暂时无法完成，请重试') : '',
    })
  },

  inputSerial(event) { this.setData({ serialNumber: event.detail.value, scanFeedback: '' }) },
  inputSsid(event) { this.setData({ ssid: event.detail.value }) },
  inputPassword(event) { this.setData({ password: event.detail.value }) },

  scanCode() {
    wx.scanCode({
      onlyFromCamera: true,
      success: ({ result }) => this.setData({ serialNumber: normalizeSerialNumber(result), scanFeedback: '' }),
      fail: ({ errMsg }) => this.setData({
        scanFeedback: String(errMsg || '').toLowerCase().includes('cancel')
          ? '已取消扫码，可手动输入设备 SN。'
          : '扫码未完成，请手动输入设备 SN。',
      }),
    })
  },

  async startSearch() {
    if (this._searching) return
    this._searching = true
    const requestId = (this._searchRequestId || 0) + 1
    this._searchRequestId = requestId
    this.setMachine({ type: 'START_SEARCH' })
    const serialNumber = normalizeSerialNumber(this.data.serialNumber)
    if (serialNumber && !isValidSerialNumber(serialNumber)) {
      this.setMachine({ type: 'FAILED', reason: 'INVALID_SN', retryStep: 'idle' })
      this._searching = false
      return
    }
    this.setData({ serialNumber, scanFeedback: '' })
    try {
      const devices = await services.device.discover(serialNumber ? { serialNumber } : {})
      if (requestId !== this._searchRequestId) return
      if (!devices.length) throw { code: 'NOT_FOUND' }
      const validDevices = devices.filter((device) => isValidSerialNumber(device && device.serialNumber))
      if (!serialNumber && validDevices.length > 1) {
        this.setMachine({ type: 'FAILED', reason: 'MULTIPLE_DEVICES', retryStep: 'searching' })
        return
      }
      const matchedDevice = serialNumber
        ? validDevices.find((device) => matchesDiscoveredDevice(serialNumber, device))
        : validDevices[0]
      if (!matchedDevice) {
        this.setMachine({ type: 'FAILED', reason: 'IDENTITY_MISMATCH', retryStep: 'searching' })
        return
      }
      this.setData({ serialNumber: normalizeSerialNumber(matchedDevice.serialNumber) })
      this.setMachine({ type: 'DEVICE_FOUND', device: matchedDevice })
    } catch (error) {
      if (requestId === this._searchRequestId) this.setMachine({ type: 'FAILED', reason: stableError(error, 'NOT_FOUND'), retryStep: 'searching' })
    } finally {
      if (requestId === this._searchRequestId) this._searching = false
    }
  },

  async connect() {
    if (this.data.machine.step !== 'found') return
    if (!matchesDiscoveredDevice(this.data.serialNumber, this.data.machine.device)) {
      this.setMachine({ type: 'FAILED', reason: 'IDENTITY_MISMATCH', retryStep: 'found' })
      return
    }
    this.setMachine({ type: 'START_CONNECT' })
    try {
      const discovered = this.data.machine.device
      await services.device.bind({
        deviceId: discovered.deviceId,
        serialNumber: discovered.serialNumber,
      })
      this.setMachine({ type: 'CONNECTED' })
      if (discovered.provisioned) {
        this.setMachine({ type: 'START_PROVISION' })
        this.setMachine({ type: 'PROVISIONED' })
        this.setData({ scanFeedback: '云端调试设备已在线，无需重复发送 Wi-Fi 密码。' })
      }
    } catch (error) {
      this.setMachine({ type: 'FAILED', reason: stableError(error, 'CONNECT_FAILED'), retryStep: 'found' })
    }
  },

  async provision() {
    if (this.data.machine.step !== 'connected') return
    this.setMachine({ type: 'START_PROVISION' })
    const password = this.data.password
    this.setData({ password: '' })
    try {
      await services.device.provisionWifi({ ssid: this.data.ssid, password })
      this.setMachine({ type: 'PROVISIONED' })
    } catch (error) {
      const reason = provisionError(error)
      this.setMachine({ type: 'FAILED', reason, retryStep: 'connected' })
    } finally {
      this.setData({ password: '' })
    }
  },

  retry() {
    const retryStep = this.data.machine.retryStep
    this.setMachine({ type: 'RETRY' })
    if (retryStep === 'searching') this.startSearch()
  },

  recoverAuth() {
    wx.reLaunch({ url: '/pages/onboarding/index?reauth=1' })
  },

  // 演示模式：跳过硬件配对，直接进首页
  skipToHome() {
    this.completeDemoSetup()
    wx.switchTab({ url: '/pages/home/index' })
  },
  completeDemoSetup() {
    // A demo is deliberately marked so it cannot masquerade as a calibrated
    // physical-device setup or send the user back into onboarding.
    wx.setStorageSync('haomian-demo-mode', true)
    wx.setStorageSync('haomian-setup-mode', 'demo')
    wx.setStorageSync('haomian-setup-complete', true)
  },

  simulateBluetoothOff() {
    this.setData({ machine: { ...this.data.machine, step: 'searching' } })
    this.setMachine({ type: 'FAILED', reason: 'BLUETOOTH_DISABLED', retryStep: 'searching' })
  },

  finish() {
    wx.navigateTo({ url: '/pages/calibration/index' })
  },
})

function stableError(error, fallback) {
  const code = readErrorCode(error)
  return Object.prototype.hasOwnProperty.call(errorCopy, code) ? code : fallback
}

function provisionError(error) {
  const code = readErrorCode(error)
  return ['WIFI_CREDENTIALS_REQUIRED', 'WIFI_5G_UNSUPPORTED', 'WIFI_PASSWORD_REJECTED', 'PROVISION_TIMEOUT', 'AUTH_EXPIRED'].includes(code)
    ? code
    : 'PROVISION_TIMEOUT'
}

function readErrorCode(error) {
  const directCode = error && typeof error.code === 'string' ? error.code : ''
  if (Object.prototype.hasOwnProperty.call(errorCopy, directCode)) return directCode
  const message = error && typeof error.message === 'string' ? error.message : ''
  const match = message.match(/^([A-Z][A-Z0-9_]+)(?::|\b)/)
  if (match && Object.prototype.hasOwnProperty.call(errorCopy, match[1])) return match[1]
  return directCode || (match ? match[1] : '')
}
