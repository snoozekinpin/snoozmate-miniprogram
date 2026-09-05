const services = require('../../services/index')
const { normalizeTonightSettings } = require('../../domain/limits')
const { runServiceErrorAction, toUserError } = require('../../domain/service-error')

Page({
  data: { settings: null, status: null, controlAvailable: false, controlError: null, loading: true, loadError: null, actionError: null, phase: 'loading', saving: false, fromAiPlan: false },
  onLoad(options = {}) {
    this.setData({ fromAiPlan: options.source === 'ai-plan' })
    return this.load()
  },
  async load() {
    this.setData({ loading: true, loadError: null, actionError: null, phase: 'loading' })
    try {
      const [settings, status] = await Promise.all([services.device.getTonightSettings(), services.device.getStatus()])
      const controlAvailable = Boolean(status && status.controlAvailable)
      const controlError = controlAvailable ? null : toUserError({ code: status && status.provisioned ? 'DEVICE_OFFLINE' : 'NOT_PROVISIONED' }, '今晚设置')
      this.setData({ settings, status, controlAvailable, controlError, phase: settings ? 'data' : 'empty' })
    } catch (error) {
      this.setData({ settings: null, loadError: toUserError(error, '今晚设置'), phase: 'error' })
    } finally {
      this.setData({ loading: false })
    }
  },
  retry() { return this.load() },
  handleServiceAction(event) { return runServiceErrorAction(event.detail.action, () => this.retry(), wx) },
  handleActionError(event) { return runServiceErrorAction(event.detail.action, () => this.retryAction(), wx) },
  setMode(event) { if (!this.data.saving && this.data.controlAvailable) this.setData({ 'settings.sleepMode': event.currentTarget.dataset.mode }) },
  setValue(event) { if (!this.data.saving && this.data.controlAvailable) this.setData({ [`settings.${event.currentTarget.dataset.key}`]: Number(event.detail.value) }) },
  async save() {
    if (this.data.saving || !this.data.controlAvailable) return
    this._retryAction = () => this.save()
    this.setData({ saving: true, actionError: null })
    try {
      const settings = normalizeTonightSettings(this.data.settings)
      await services.device.saveTonightSettings(settings)
      this._retryAction = null
      wx.showToast({ title: '今晚设置已同步', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    } catch (error) {
      const userError = toUserError(error, '今晚设置')
      this.setData({ actionError: userError })
      wx.showToast({ title: userError.title, icon: 'none' })
    } finally { this.setData({ saving: false }) }
  },
  retryAction() {
    if (!this.data.actionError || !this.data.actionError.retryable || !this._retryAction) return
    return this._retryAction()
  },
})
