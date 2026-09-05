const services = require('../../services/index')
const { toUserError } = require('../../domain/service-error')
const { getTimeGreeting } = require('../../domain/time-greeting')
const { buildDirectShare, buildTimelineShare } = require('../../domain/share-card')

const ACTIVE_COMMAND_STATUSES = ['pending', 'validating', 'sending', 'ack-accepted', 'readback-pending']

Page({
  data: {
    greeting: getTimeGreeting(),
    heroTitle: 'AI 解读由你授权',
    scope: 'single-night',
    mode: 'overview',
    overview: null,
    records: [],
    filteredRecords: [],
    recordFilter: 'all',
    activeCommand: null,
    heroTitle: 'AI 解读由你授权',
    appliedSettings: null,
    evidenceOpen: false,
    expandedEvidenceId: '',
    planOpen: false,
    candidate: null,
    candidateLoading: false,
    candidateError: null,
    applyingPlan: false,
    loading: true,
    refreshing: false,
    refreshingScope: false,
    consentRequired: false,
    authorizing: false,
    error: null,
  },

  onShow() {
    this.setData({ greeting: getTimeGreeting() })
    this.load()
  },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },

  async load() {
    const requestId = (this._requestId || 0) + 1
    this._requestId = requestId
    const preserveContent = Boolean(this.data.consentRequired || this.data.overview || this.data.records.length)
    this.setData({ loading: !preserveContent, refreshing: preserveContent, error: null })
    try {
      const profile = await services.auth.getProfile()
      if (requestId !== this._requestId) return
      if (!profile || !profile.aiDataAuthorized) {
        this.setData({
          consentRequired: true,
          overview: null,
          records: [],
          filteredRecords: [],
          activeCommand: null,
          loading: false,
          refreshing: false,
        })
        return
      }
      const [overview, records, activeCommand] = await Promise.all([
        services.ai.getOverview(this.data.scope),
        services.ai.getRecords(),
        services.device.getActiveSettingsCommand ? services.device.getActiveSettingsCommand() : Promise.resolve(null),
      ])
      if (requestId !== this._requestId) return
      this.setData({
        consentRequired: false,
        overview,
        records,
        filteredRecords: filterRecords(records, this.data.recordFilter),
        activeCommand,
        appliedSettings: commandAppliedSettings(activeCommand),
        heroTitle: heroForOverview(overview),
      })
      if (overview.kind === 'single-night' && overview.hasData) this.ensureCandidate(overview)
    } catch (error) {
      if (requestId === this._requestId) this.setData({ error: toUserError(error, 'AI 解读') })
    } finally {
      if (requestId === this._requestId) this.setData({ loading: false, refreshing: false })
    }
  },

  async requestAiConsent() {
    if (this.data.authorizing) return
    this.setData({ authorizing: true, error: null })
    try {
      const answer = await new Promise((resolve, reject) => wx.showModal({
        title: '允许 AI 读取睡眠资料？',
        content: '仅使用结构化事件、夜间摘要、连续趋势和你主动填写的反馈；不读取整夜原始录音。',
        confirmText: '允许',
        cancelText: '暂不',
        confirmColor: '#C97810',
        success: resolve,
        fail: reject,
      }))
      if (!answer.confirm) return
      await services.auth.saveProfile({ aiDataAuthorized: true, aiConsentVersion: 'ai-data-v1' })
      this.setData({ consentRequired: false })
      await this.load()
    } catch (error) {
      this.setData({ error: toUserError(error, 'AI 数据授权') })
    } finally {
      this.setData({ authorizing: false })
    }
  },

  async setScope(event) {
    const scope = event.currentTarget.dataset.scope
    if (this.data.consentRequired || !['single-night', 'seven-night'].includes(scope) || scope === this.data.scope) return
    const previousScope = this.data.scope
    const requestId = (this._scopeRequestId || 0) + 1
    this._scopeRequestId = requestId
    this.setData({
      scope,
      mode: 'overview',
      refreshingScope: true,
      evidenceOpen: false,
      expandedEvidenceId: '',
      planOpen: false,
      candidate: null,
      candidateError: null,
      error: null,
    })
    try {
      const overview = await services.ai.getOverview(scope)
      if (requestId === this._scopeRequestId) this.setData({ overview, heroTitle: heroForOverview(overview) })
    } catch (error) {
      if (requestId === this._scopeRequestId) this.setData({ scope: previousScope, error: toUserError(error, 'AI 解读') })
    } finally {
      if (requestId === this._scopeRequestId) this.setData({ refreshingScope: false })
    }
  },

  setMode(event) {
    const mode = event.currentTarget.dataset.mode
    if (!['overview', 'records'].includes(mode)) return
    this.setData({ mode, greeting: getTimeGreeting() })
    if (typeof wx.setNavigationBarTitle === 'function') {
      wx.setNavigationBarTitle({ title: mode === 'records' ? '解读记录' : '好眠 AI' })
    }
  },

  setRecordFilter(event) {
    const recordFilter = event.currentTarget.dataset.filter
    if (!['all', 'single-night'].includes(recordFilter)) return
    this.setData({ recordFilter, filteredRecords: filterRecords(this.data.records, recordFilter) })
  },

  openDetail(event) {
    const interpretationId = event.currentTarget.dataset.id || (this.data.overview && this.data.overview.interpretationId)
    if (!interpretationId) return
    const record = this.data.records.find((item) => item.interpretationId === interpretationId)
    const revision = event.currentTarget.dataset.revision || (record && record.revision) || 1
    wx.navigateTo({ url: `/pages/ai-chat/index?interpretationId=${interpretationId}&revision=${revision}` })
  },

  toggleEvidence(event) {
    const id = event.currentTarget.dataset.id
    this.setData({ expandedEvidenceId: this.data.expandedEvidenceId === id ? '' : id })
  },

  toggleEvidenceList() {
    const evidenceOpen = !this.data.evidenceOpen
    const firstEvidence = this.data.overview && this.data.overview.evidence && this.data.overview.evidence[0]
    this.setData({
      evidenceOpen,
      expandedEvidenceId: evidenceOpen && firstEvidence ? firstEvidence.id : '',
    })
  },

  async toggleInlinePlan() {
    const item = this.data.overview
    if (!item || item.kind !== 'single-night') return
    if (this.data.planOpen) {
      this.setData({ planOpen: false })
      return
    }
    this.setData({ planOpen: true })
    if (this.data.activeCommand && ACTIVE_COMMAND_STATUSES.includes(this.data.activeCommand.status)) {
      this.scheduleInlinePoll()
    }
    return this.ensureCandidate(item)
  },

  async ensureCandidate(item) {
    if (!item || this.data.candidate || this.data.candidateLoading) return
    this.setData({ candidateLoading: true, candidateError: null })
    try {
      const candidate = await services.ai.getTonightCandidate(item.interpretationId)
      if (this.data.overview && this.data.overview.interpretationId === item.interpretationId) {
        this.setData({ candidate })
      }
    } catch (error) {
      this.setData({ candidateError: toUserError(error, '今晚温和方案') })
    } finally {
      this.setData({ candidateLoading: false })
    }
  },

  async applyInlinePlan() {
    if (this.data.applyingPlan) return
    if (!this.data.candidate) await this.ensureCandidate(this.data.overview)
    if (!this.data.candidate) return
    const confirmed = await confirmInlinePlan()
    if (!confirmed) return
    this.setData({ applyingPlan: true, candidateError: null })
    try {
      const command = await services.device.applyTonightCandidate({
        candidateId: this.data.candidate.candidateId,
        expectedConfigVersion: this.data.candidate.currentConfigVersion,
      })
      this.applyInlineCommandState(command)
      this.scheduleInlinePoll()
    } catch (error) {
      this.setData({ candidateError: toUserError(error, '应用今晚设置') })
    } finally {
      this.setData({ applyingPlan: false })
    }
  },

  async pollInlineCommand() {
    const command = this.data.activeCommand
    if (!command || !ACTIVE_COMMAND_STATUSES.includes(command.status)) return
    try {
      const nextCommand = await services.device.getSettingsCommand(command.commandId)
      this.applyInlineCommandState(nextCommand)
      this.scheduleInlinePoll()
    } catch (error) {
      this.setData({ candidateError: toUserError(error, '设置回读') })
    }
  },

  async reconcileInlineCommand() {
    if (!this.data.activeCommand) return
    try {
      this.applyInlineCommandState(await services.device.reconcileSettingsCommand(this.data.activeCommand.commandId))
    } catch (error) {
      this.setData({ candidateError: toUserError(error, '设置核对') })
    }
  },

  applyInlineCommandState(activeCommand) {
    this.setData({ activeCommand, appliedSettings: commandAppliedSettings(activeCommand) })
  },

  scheduleInlinePoll() {
    if (this._commandPollTimer) clearTimeout(this._commandPollTimer)
    if (this.data.activeCommand && ACTIVE_COMMAND_STATUSES.includes(this.data.activeCommand.status)) {
      this._commandPollTimer = setTimeout(() => this.pollInlineCommand(), 800)
    }
  },

  openManualSettings() { wx.navigateTo({ url: '/pages/tonight/index?source=ai-plan' }) },

  openChat() {
    const item = this.data.overview
    if (item) wx.navigateTo({ url: `/pages/ai-chat/index?interpretationId=${item.interpretationId}&revision=${item.revision}` })
  },

  openPlan() {
    return this.toggleInlinePlan()
  },
  openActiveCommand() {
    if (this.data.activeCommand && !this.data.planOpen) return this.toggleInlinePlan()
  },

  onUnload() {
    if (this._commandPollTimer) clearTimeout(this._commandPollTimer)
  },
  onShareAppMessage() { return buildDirectShare() },
  onShareTimeline() { return buildTimelineShare() },
})

function filterRecords(records, filter) {
  return filter === 'all' ? records : records.filter((item) => item.kind === filter)
}

function heroForOverview(overview) {
  if (!overview || overview.hasData === false) return '昨夜暂无有效记录'
  if (overview.kind === 'seven-night') return '最近七晚趋势已整理'
  return overview.eventCount
    ? `昨夜收到 ${overview.eventCount} 条有效记录`
    : '昨夜记录已整理'
}

function commandAppliedSettings(command) {
  return command && command.status === 'applied' && command.matchesCandidate === true
    ? command.readbackSettings
    : null
}

function confirmInlinePlan() {
  return new Promise((resolve) => {
    wx.showModal({
      title: '应用 AI 推荐？',
      content: '仅今晚有效。月石会再次校验安全边界，设备回读一致后才会生效。',
      confirmText: '确认应用',
      cancelText: '再看看',
      confirmColor: '#C97810',
      success: (result) => resolve(Boolean(result.confirm)),
      fail: () => resolve(false),
    })
  })
}
