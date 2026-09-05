const services = require('../../services/index')
const { toUserError } = require('../../domain/service-error')

const ACTIVE_STATUSES = ['pending', 'validating', 'sending', 'ack-accepted', 'readback-pending']

Page({
  data: {
    candidate: null,
    currentSettings: null,
    candidateSettings: null,
    command: null,
    appliedSettings: null,
    loading: true,
    applying: false,
    error: null,
  },

  onLoad(options) {
    if (options.commandId) this.restoreCommand(options.commandId)
    else this.loadCandidate(decodeURIComponent(options.interpretationId || ''))
  },
  onUnload() { if (this._pollTimer) clearTimeout(this._pollTimer) },

  async loadCandidate(interpretationId) {
    this.setData({ loading: true, error: null })
    try {
      const candidate = await services.ai.getTonightCandidate(interpretationId)
      this.setData({ candidate, currentSettings: candidate.currentSettings, candidateSettings: candidate.candidateSettings })
    } catch (error) {
      this.setData({ error: toUserError(error, '今晚温和方案') })
    } finally {
      this.setData({ loading: false })
    }
  },

  async restoreCommand(commandId) {
    this.setData({ loading: true, error: null })
    try {
      const [overview, command] = await Promise.all([
        services.ai.getOverview('single-night'),
        services.device.getSettingsCommand(commandId),
      ])
      const candidate = await services.ai.getTonightCandidate(overview.interpretationId)
      this.setData({ candidate, currentSettings: candidate.currentSettings, candidateSettings: candidate.candidateSettings })
      this.applyCommandState(command)
    } catch (error) {
      this.setData({ error: toUserError(error, '设置进度') })
    } finally {
      this.setData({ loading: false })
    }
  },

  async apply() {
    if (this.data.applying || !this.data.candidate) return
    const confirmed = await confirmApply()
    if (!confirmed) return
    this.setData({ applying: true, error: null })
    try {
      const command = await services.device.applyTonightCandidate({
        candidateId: this.data.candidate.candidateId,
        expectedConfigVersion: this.data.candidate.currentConfigVersion,
      })
      this.applyCommandState(command)
      this.schedulePoll()
    } catch (error) {
      this.setData({ error: toUserError(error, '应用今晚设置') })
    } finally {
      this.setData({ applying: false })
    }
  },

  async pollCommand() {
    const command = this.data.command
    if (!command || !ACTIVE_STATUSES.includes(command.status)) return
    try {
      this.applyCommandState(await services.device.getSettingsCommand(command.commandId))
      this.schedulePoll()
    } catch (error) {
      this.setData({ error: toUserError(error, '设置回读') })
    }
  },

  async reconcile() {
    if (!this.data.command) return
    try {
      this.applyCommandState(await services.device.reconcileSettingsCommand(this.data.command.commandId))
    } catch (error) {
      this.setData({ error: toUserError(error, '设置核对') })
    }
  },

  openManualSettings() { wx.navigateTo({ url: '/pages/tonight/index?source=ai-plan' }) },

  applyCommandState(command) {
    const appliedSettings = command.status === 'applied' && command.matchesCandidate === true
      ? command.readbackSettings
      : null
    this.setData({ command, appliedSettings })
  },

  schedulePoll() {
    if (this._pollTimer) clearTimeout(this._pollTimer)
    if (this.data.command && ACTIVE_STATUSES.includes(this.data.command.status)) {
      this._pollTimer = setTimeout(() => this.pollCommand(), 800)
    }
  },
})

function confirmApply() {
  return new Promise((resolve) => {
    wx.showModal({
      title: '应用今晚温和方案？',
      content: '月石会再次校验安全边界，只有设备回读一致后才会显示已应用。',
      confirmText: '确认应用',
      cancelText: '再看看',
      success: (result) => resolve(Boolean(result.confirm)),
      fail: () => resolve(false),
    })
  })
}
