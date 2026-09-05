const services = require('../../services/index')
const { runServiceErrorAction, toUserError } = require('../../domain/service-error')
const { buildDirectShare, buildTimelineShare } = require('../../domain/share-card')

Page({
  data: {
    loading: true,
    error: null,
    partialError: null,
    status: null,
    settings: null,
    sound: null,
    light: null,
    guardian: null,
    activeCommand: null,
    morningReportState: 'loading',
    morningReportCopy: '',
    morningReportError: null,
  },

  onShow() { this.loadData() },
  onPullDownRefresh() { this.loadData().finally(() => wx.stopPullDownRefresh()) },

  async loadData() {
    const preserveDevice = Boolean(this.data.status)
    const preserveReport = ['ready', 'empty'].includes(this.data.morningReportState)
    this.setData({
      loading: !preserveDevice,
      error: null,
      partialError: null,
      morningReportState: preserveReport ? this.data.morningReportState : 'loading',
      morningReportCopy: preserveReport ? this.data.morningReportCopy : '',
      morningReportError: null,
    })
    await Promise.all([this.loadDeviceData(), this.loadMorningReport()])
  },

  async loadDeviceData() {
    const requestId = (this._deviceRequestId || 0) + 1
    this._deviceRequestId = requestId
    const preserveContent = Boolean(this.data.status)
    this.setData({ loading: !preserveContent, error: null, partialError: null })
    try {
      const results = await Promise.all([
        services.device.getStatus(),
        services.device.getTonightSettings(),
        services.device.getSoundState(),
        services.device.getLightState(),
        services.guardian && services.guardian.getSnapshot ? services.guardian.getSnapshot() : Promise.resolve(null),
        services.device.getActiveSettingsCommand ? services.device.getActiveSettingsCommand() : Promise.resolve(null),
      ].map(settle))
      if (requestId !== this._deviceRequestId) return
      const [status, settings, sound, light, guardian, activeCommand] = results
      const firstFailure = results.find((result) => !result.ok)
      const criticalError = status.ok ? null : toUserError(status.error, '设备状态')
      this.setData({
        status: status.ok ? status.value : this.data.status,
        settings: settings.ok ? settings.value : this.data.settings,
        sound: sound.ok ? sound.value : this.data.sound,
        light: light.ok ? light.value : this.data.light,
        guardian: guardian.ok ? guardian.value : this.data.guardian,
        activeCommand: activeCommand.ok ? activeCommand.value : this.data.activeCommand,
        error: criticalError,
        partialError: !criticalError && firstFailure ? toUserError(firstFailure.error, '部分设备状态') : null,
      })
    } finally {
      if (requestId === this._deviceRequestId) this.setData({ loading: false })
    }
  },

  async loadMorningReport() {
    const requestId = (this._reportRequestId || 0) + 1
    this._reportRequestId = requestId
    const preserveContent = ['ready', 'empty'].includes(this.data.morningReportState)
    this.setData({
      morningReportState: preserveContent ? this.data.morningReportState : 'loading',
      morningReportCopy: preserveContent ? this.data.morningReportCopy : '',
      morningReportError: null,
    })

    try {
      const latestReport = await services.reports.getLatest()
      if (requestId === this._reportRequestId) {
        const hasReport = Boolean(latestReport && latestReport.hasData !== false)
        this.setData({
          morningReportState: hasReport ? 'ready' : 'empty',
          morningReportCopy: hasReport ? '最近一晚报告已生成' : '尚未收到有效夜间记录',
        })
      }
    } catch (error) {
      if (requestId === this._reportRequestId) this.setData({ morningReportState: 'error', morningReportCopy: '晨报同步失败', morningReportError: toUserError(error, '晨报') })
    }
  },

  retryDevice() { return this.loadDeviceData() },
  retryMorningReport() { return this.loadMorningReport() },
  handleDeviceAction(event) { return runServiceErrorAction(event.detail.action, () => this.retryDevice(), wx) },
  handleMorningReportAction(event) { return runServiceErrorAction(event.detail.action, () => this.retryMorningReport(), wx) },

  openDevice() { wx.navigateTo({ url: '/pages/device/index' }) },
  openLive() { wx.navigateTo({ url: '/pages/live/index' }) },
  openAi() { wx.switchTab({ url: '/pages/ai/index' }) },
  openActiveCommand() {
    if (!this.data.activeCommand) return
    wx.navigateTo({ url: `/pages/ai-plan/index?commandId=${this.data.activeCommand.commandId}` })
  },
  openTonight() { if (this.canOpenControl()) wx.navigateTo({ url: '/pages/tonight/index' }) },
  openSound() { if (this.canOpenControl()) wx.navigateTo({ url: '/pages/sound/index' }) },
  openLight() { if (this.canOpenControl()) wx.navigateTo({ url: '/pages/light/index' }) },
  openReport() { wx.switchTab({ url: '/pages/report/index' }) },
  canOpenControl() {
    if (this.data.status && this.data.status.controlAvailable) return true
    wx.showToast({ title: '设备离线或尚未配网，控制暂不可用', icon: 'none' })
    return false
  },
  onShareAppMessage() { return buildDirectShare() },
  onShareTimeline() { return buildTimelineShare() },
})

async function settle(promise) {
  try {
    return { ok: true, value: await promise }
  } catch (error) {
    return { ok: false, error }
  }
}
