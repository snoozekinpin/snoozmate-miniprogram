const services = require('../../services/index')
const { CALIBRATION_STORAGE_KEY, createCalibrationMarker, evaluateReadiness } = require('../../domain/readiness')
const { runServiceErrorAction, toUserError } = require('../../domain/service-error')

Page({
  data: {
    phase: 'checking',
    result: null,
    status: null,
    settings: null,
    readiness: null,
    failedChecks: [],
    completing: false,
    error: null,
    errorMessage: '',
  },

  onLoad() { this.run() },

  onShow() {
    if (!this._refreshAfterSettings) return
    this._refreshAfterSettings = false
    return this.refreshReadiness()
  },

  async run() {
    this.setData({ phase: 'checking', result: null, status: null, settings: null, readiness: null, failedChecks: [], error: null, errorMessage: '' })
    wx.removeStorageSync(CALIBRATION_STORAGE_KEY)
    try {
      const result = await services.device.runCalibration()
      const marker = createCalibrationMarker(result)
      if (marker) wx.setStorageSync(CALIBRATION_STORAGE_KEY, marker)
      if (!marker) {
        this.setData({
          result: { ...result, ready: false },
          failedChecks: (result.checks || []).filter((check) => !check.ready),
          phase: 'failed',
        })
        return
      }
      const [status, settings] = await Promise.all([
        services.device.getStatus(),
        services.device.getTonightSettings(),
      ])
      const readiness = evaluateReadiness(status, marker)
      this.setData({
        result,
        status,
        settings,
        readiness,
        failedChecks: readiness.checks.filter((check) => !check.ready),
        phase: readiness.ready ? 'ready' : 'failed',
      })
    } catch (error) {
      const userError = toUserError(error, '设备自检')
      this.setData({ phase: 'failed', result: null, error: userError, errorMessage: `自检暂时没有完成。${userError.detail}` })
    }
  },

  retry() { this.run() },
  handleServiceAction(event) { return runServiceErrorAction(event.detail.action, () => this.retry(), wx) },

  async refreshReadiness() {
    try {
      const [status, settings] = await Promise.all([
        services.device.getStatus(),
        services.device.getTonightSettings(),
      ])
      const readiness = evaluateReadiness(status, wx.getStorageSync(CALIBRATION_STORAGE_KEY))
      this.setData({
        status,
        settings,
        readiness,
        failedChecks: readiness.checks.filter((check) => !check.ready),
        phase: readiness.ready ? 'ready' : 'failed',
        error: null,
        errorMessage: '',
      })
    } catch (error) {
      const userError = toUserError(error, '设备自检')
      this.setData({ error: userError, errorMessage: `暂时无法更新今晚设置。${userError.detail}` })
    }
  },

  async complete() {
    if (this.data.completing) return
    this.setData({ completing: true, error: null, errorMessage: '' })
    try {
      const status = await services.device.getStatus()
      const readiness = evaluateReadiness(status, wx.getStorageSync(CALIBRATION_STORAGE_KEY))
      this.setData({
        status,
        readiness,
        failedChecks: readiness.checks.filter((check) => !check.ready),
        phase: readiness.ready ? 'ready' : 'failed',
      })
      if (!readiness.ready) return
      wx.setStorageSync('haomian-setup-complete', true)
      wx.setStorageSync('haomian-setup-mode', 'normal')
      wx.removeStorageSync('haomian-demo-mode')
      wx.switchTab({ url: '/pages/home/index' })
    } catch (error) {
      const userError = toUserError(error, '设备自检')
      this.setData({ error: userError, errorMessage: `暂时无法确认设备状态。${userError.detail}` })
    } finally {
      this.setData({ completing: false })
    }
  },

  adjustTonightSettings() {
    this._refreshAfterSettings = true
    wx.navigateTo({ url: '/pages/tonight/index' })
  },
})
