const services = require('../../services/index')
const { runServiceErrorAction, toUserError } = require('../../domain/service-error')
const { buildDirectShare, buildTimelineShare } = require('../../domain/share-card')

const demoOptions = [
  { kind: 'offline', key: 'offline', label: '设备离线', detail: '控制禁用，历史报告可查看' },
  { kind: 'unprovisioned', key: 'unprovisioned', label: '未配网', detail: '引导重新发送 Wi-Fi 信息' },
  { kind: 'pad-disconnected', key: 'padDisconnected', label: '振动片未连接', detail: '今晚只记录，不执行提醒' },
  { kind: 'no-data', key: 'noData', label: '无有效数据', detail: '报告与趋势展示空状态' },
  { kind: 'sync-failed', key: 'syncFailed', label: '同步失败', detail: '本地守护不中断，可稍后同步' },
  { kind: 'high-attention', key: 'highAttention', label: '高关注趋势（仅 Mock）', detail: '仅切换上游关注类别，不计算医疗阈值' },
  { kind: 'firmware-update', key: 'firmwareUpdate', label: '固件待更新', detail: '等待硬件 OTA 接口' },
  { kind: 'model-update', key: 'modelUpdate', label: '模型待更新', detail: '等待模型发布与签名接口' },
]

Page({
  data: { profile: null, avatar: '月', status: null, demos: null, options: demoOptions, activeState: '', loading: true, refreshing: false, loadError: null, actionError: null, phase: 'loading', syncing: false, authorizing: false, expandedSection: '', showDiagnostics: false },
  onShow() { this.load() },
  async load() {
    const preserveContent = this.data.phase === 'data' && Boolean(this.data.profile)
    this.setData({ loading: !preserveContent, refreshing: preserveContent, loadError: null, actionError: null, phase: preserveContent ? 'data' : 'loading' })
    try {
      const [profile, status, demos] = await Promise.all([services.auth.getProfile(), services.device.getStatus(), services.device.getDemoStates()])
      if (!profile || !status || !demos) {
        this.setData({ profile: null, status: null, demos: null, phase: 'empty' })
        return
      }
      const active = demoOptions.find((option) => demos[option.key])
      this.setData({
        profile,
        avatar: (profile.nickname || '月').slice(0, 1),
        status,
        demos,
        options: demoOptions.map((option) => ({ ...option, enabled: Boolean(demos[option.key]) })),
        activeState: active ? active.label : '',
        phase: 'data',
      })
    } catch (error) {
      this.setData({ profile: null, status: null, demos: null, loadError: toUserError(error, '个人与设备资料'), phase: 'error' })
    } finally {
      this.setData({ loading: false, refreshing: false })
    }
  },
  retry() { return this.load() },
  handleServiceAction(event) { return runServiceErrorAction(event.detail.action, () => this.retry(), wx) },
  handleActionError(event) { return runServiceErrorAction(event.detail.action, () => this.retryAction(), wx) },
  async toggleDemo(event) {
    if (this.data.syncing) return
    const { kind } = event.currentTarget.dataset
    this._retryAction = () => this.toggleDemo(event)
    this.setData({ syncing: true, actionError: null })
    try {
      await services.device.setDemoState({ kind, enabled: event.detail.value })
      await this.load()
      this._retryAction = null
    } catch (error) {
      const userError = toUserError(error, '演示状态')
      this.setData({ actionError: userError })
      wx.showToast({ title: userError.title, icon: 'none' })
    } finally {
      this.setData({ syncing: false })
    }
  },
  openDevice() { wx.navigateTo({ url: '/pages/device/index' }) },
  toggleSection(event) {
    const section = event.currentTarget.dataset.section
    if (!['ai', 'privacy'].includes(section)) return
    this.setData({ expandedSection: this.data.expandedSection === section ? '' : section })
  },
  async toggleAiAuthorization(event) {
    if (this.data.authorizing || !this.data.profile) return
    const enabled = Boolean(event.detail.value)
    if (enabled === Boolean(this.data.profile.aiDataAuthorized)) return
    this.setData({ authorizing: true, actionError: null })
    try {
      const answer = await new Promise((resolve, reject) => wx.showModal({
        title: enabled ? '允许 AI 读取睡眠资料？' : '关闭 AI 数据授权？',
        content: enabled
          ? '仅使用结构化事件、夜间摘要、连续趋势和主动反馈。'
          : '关闭后 AI 将停止读取新的睡眠资料；已生成的结构化报告仍会保留。',
        confirmText: enabled ? '允许' : '确认关闭',
        cancelText: '取消',
        confirmColor: enabled ? '#C97810' : '#A45237',
        success: resolve,
        fail: reject,
      }))
      if (!answer.confirm) {
        this.setData({ profile: { ...this.data.profile } })
        return
      }
      const profile = await services.auth.saveProfile({
        aiDataAuthorized: enabled,
        ...(enabled ? { aiConsentVersion: 'ai-data-v1' } : {}),
      })
      this.setData({ profile })
    } catch (error) {
      const userError = toUserError(error, 'AI 数据授权')
      this.setData({ actionError: userError, profile: { ...this.data.profile } })
      wx.showToast({ title: userError.title, icon: 'none' })
    } finally {
      this.setData({ authorizing: false })
    }
  },
  toggleDiagnostics() { this.setData({ showDiagnostics: !this.data.showDiagnostics }) },
  async unbind() {
    if (this.data.syncing) return
    this._retryAction = () => this.unbind()
    this.setData({ syncing: true, actionError: null })
    try {
      const result = await new Promise((resolve, reject) => wx.showModal({ title: '解绑设备', content: '解绑不会删除已归属到当前用户的历史报告。重新绑定后可继续查看。', confirmText: '确认解绑', confirmColor: '#A45237', success: resolve, fail: reject }))
      if (!result.confirm) {
        this._retryAction = null
        return
      }
      await services.device.unbind()
      this._retryAction = null
      wx.removeStorageSync('haomian-setup-complete')
      wx.removeStorageSync('haomian-setup-mode')
      wx.removeStorageSync('haomian-demo-mode')
      wx.reLaunch({ url: '/pages/onboarding/index' })
    } catch (error) {
      const userError = toUserError(error, '解绑设备')
      this.setData({ actionError: userError })
      wx.showToast({ title: userError.title, icon: 'none' })
    } finally {
      this.setData({ syncing: false })
    }
  },
  retryAction() {
    if (!this.data.actionError || !this.data.actionError.retryable || !this._retryAction) return
    return this._retryAction()
  },
  onShareAppMessage() {
    return buildDirectShare()
  },
  onShareTimeline() {
    return buildTimelineShare()
  },
})
