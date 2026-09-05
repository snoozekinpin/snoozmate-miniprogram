const services = require('../../services/index')
const { runServiceErrorAction, toUserError } = require('../../domain/service-error')

Page({
  data: { light: null, brightnessDraft: 5, status: null, controlAvailable: false, controlError: null, loading: true, loadError: null, actionError: null, phase: 'loading', syncing: false },
  onLoad() { return this.load() },
  async load() {
    this.setData({ loading: true, loadError: null, actionError: null, phase: 'loading' })
    try {
      const [light, status] = await Promise.all([services.device.getLightState(), services.device.getStatus()])
      const controlAvailable = Boolean(status && status.controlAvailable)
      const controlError = controlAvailable ? null : toUserError({ code: status && status.provisioned ? 'DEVICE_OFFLINE' : 'NOT_PROVISIONED' }, '琥珀夜灯')
      this.setData({ light, brightnessDraft: light ? light.brightness : 5, status, controlAvailable, controlError, phase: light ? 'data' : 'empty' })
    } catch (error) {
      this.setData({ light: null, loadError: toUserError(error, '琥珀夜灯'), phase: 'error' })
    } finally {
      this.setData({ loading: false })
    }
  },
  retry() { return this.load() },
  handleServiceAction(event) { return runServiceErrorAction(event.detail.action, () => this.retry(), wx) },
  handleActionError(event) { return runServiceErrorAction(event.detail.action, () => this.retryAction(), wx) },
  async send(command) {
    if (this.data.syncing || !this.data.controlAvailable) return
    this._retryAction = () => this.send(command)
    this.setData({ syncing: true, actionError: null })
    try {
      const light = await services.device.updateLight(command)
      this.setData({ light, brightnessDraft: light.brightness })
      this._retryAction = null
    }
    catch (error) {
      const userError = toUserError(error, '琥珀夜灯')
      this.setData({ brightnessDraft: this.data.light.brightness, actionError: userError })
      wx.showToast({ title: userError.title, icon: 'none' })
    }
    finally { this.setData({ syncing: false }) }
  },
  toggle() { this.send({ enabled: !this.data.light.enabled }) },
  setMode(event) { this.send({ mode: event.currentTarget.dataset.mode, enabled: true }) },
  previewBrightness(event) { this.setData({ brightnessDraft: event.detail.value }) },
  setBrightness(event) { return this.send({ brightness: event.detail.value }) },
  retryAction() {
    if (!this.data.actionError || !this.data.actionError.retryable || !this._retryAction) return
    return this._retryAction()
  },
})
