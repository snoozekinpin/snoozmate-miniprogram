const services = require('../../services/index')
const { CALIBRATION_STORAGE_KEY, evaluateReadiness } = require('../../domain/readiness')
const { runServiceErrorAction, toUserError } = require('../../domain/service-error')

Page({
  data: { status: null, settings: null, readiness: null, loading: true, completing: false, error: null, errorMessage: '' },

  onLoad() { return this.load() },

  async load() {
    this._retryAction = () => this.load()
    this.setData({ loading: true, error: null, errorMessage: '' })
    try {
      const [status, settings] = await Promise.all([services.device.getStatus(), services.device.getTonightSettings()])
      const readiness = evaluateReadiness(status, wx.getStorageSync(CALIBRATION_STORAGE_KEY))
      this.setData({ status, settings, readiness, loading: false })
    } catch (error) {
      const userError = toUserError(error, '首夜准备')
      this.setData({ status: null, settings: null, readiness: null, loading: false, error: userError, errorMessage: `暂时无法加载首夜准备。${userError.detail}` })
    }
  },

  retry() { return this.load() },
  handleServiceAction(event) { return runServiceErrorAction(event.detail.action, () => this._retryAction(), wx) },

  async complete() {
    if (this.data.completing) return
    this._retryAction = () => this.complete()
    this.setData({ completing: true, error: null, errorMessage: '' })
    try {
      const status = await services.device.getStatus()
      const readiness = evaluateReadiness(status, wx.getStorageSync(CALIBRATION_STORAGE_KEY))
      this.setData({ status, readiness })
      if (!readiness.ready) return
      wx.setStorageSync('haomian-setup-complete', true)
      wx.setStorageSync('haomian-setup-mode', 'normal')
      wx.removeStorageSync('haomian-demo-mode')
      wx.switchTab({ url: '/pages/home/index' })
    } catch (error) {
      const userError = toUserError(error, '首夜准备')
      this.setData({ error: userError, errorMessage: `暂时无法确认设备状态。${userError.detail}` })
    } finally {
      this.setData({ completing: false })
    }
  },

  adjustPlacement() { wx.reLaunch({ url: '/pages/calibration/index' }) },
})
