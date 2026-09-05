const services = require('../../services/index')
const { getAttentionGuidance } = require('../../domain/attention-guidance')
const { runServiceErrorAction, toUserError } = require('../../domain/service-error')

Page({
  data: {
    scope: 'night',
    report: null,
    durationText: '',
    durationHours: 0,
    durationMinutes: 0,
    responseCount: 0,
    supineAssociationRate: null,
    timelineStart: '23:18',
    timelineEnd: '06:42',
    timelineTicks: [0, 12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100],
    timelineMarks: [],
    guidance: null,
    nights: [],
    validNightCount: 0,
    trendUnavailable: false,
    feedback: null,
    interpretation: null,
    weekInterpretation: null,
    activeInterpretation: null,
    interpretationFallback: false,
    loading: true,
    phase: 'loading',
    error: null,
    errorMessage: '',
  },

  onShow() { this.load() },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },

  async load() {
    const requestId = (this._requestId || 0) + 1
    this._requestId = requestId
    const preserveContent = this.data.phase === 'data' && Boolean(this.data.report)
    if (preserveContent) {
      this.setData({ loading: false, error: null, errorMessage: '' })
    } else {
      this.setData({
        loading: true,
        phase: 'loading',
        error: null,
        errorMessage: '',
        report: null,
        guidance: null,
        durationText: '',
        durationHours: 0,
        durationMinutes: 0,
        responseCount: 0,
        supineAssociationRate: null,
        timelineStart: '23:18',
        timelineEnd: '06:42',
        timelineMarks: [],
        nights: [],
        validNightCount: 0,
        trendUnavailable: false,
        feedback: null,
        interpretation: null,
        weekInterpretation: null,
        activeInterpretation: null,
        interpretationFallback: false,
      })
    }

    const reportResult = await settle(services.reports.getLatest())
    if (requestId !== this._requestId) return
    if (!reportResult.ok) {
      const userError = toUserError(reportResult.error, '晨报')
      if (preserveContent) {
        this.setData({ loading: false })
        wx.showToast({ title: userError.title, icon: 'none' })
        return
      }
      this.setData({ loading: false, phase: 'error', error: userError, errorMessage: `晨报同步失败。${userError.detail}` })
      return
    }

    const report = reportResult.value
    if (!report || report.hasData === false) {
      this.setData({ loading: false, phase: 'empty' })
      return
    }

    const guidance = getAttentionGuidance(report.attentionLevel)
    if (!guidance) {
      this.setData({ loading: false, phase: 'unavailable', errorMessage: '晨报关注类别暂不可用，请同步后重试。' })
      return
    }

    const hours = Math.floor(report.effectiveMonitoringMinutes / 60)
    const minutes = report.effectiveMonitoringMinutes % 60
    this.setData({
      report,
      guidance,
      phase: 'data',
      loading: false,
      durationText: `${hours} 小时 ${minutes} 分钟`,
      durationHours: hours,
      durationMinutes: minutes,
      responseCount: report.snoreStoppedResponses + report.turnOverResponses,
      supineAssociationRate: Number.isFinite(report.supineAssociationRate) ? report.supineAssociationRate : null,
      timelineStart: report.startTime || '23:18',
      timelineEnd: report.endTime || '06:42',
      timelineMarks: report.timelineMarks || [],
      interpretation: report.aiInterpretation || null,
      activeInterpretation: report.aiInterpretation || null,
      interpretationFallback: !report.aiInterpretation,
    })
    this.loadSupplementary(requestId, report)
  },

  async loadSupplementary(requestId, report) {
    const [trendResult, feedbackResult, nightAiResult, weekAiResult] = await Promise.all([
      settle(services.reports.getSevenNightTrend ? services.reports.getSevenNightTrend() : Promise.resolve([])),
      settle(services.reports.getFeedback ? services.reports.getFeedback(report.id) : Promise.resolve(null)),
      settle(services.ai && services.ai.getOverview ? services.ai.getOverview('single-night') : Promise.resolve(null)),
      settle(services.ai && services.ai.getOverview ? services.ai.getOverview('seven-night') : Promise.resolve(null)),
    ])
    if (requestId !== this._requestId) return

    const nights = trendResult.ok ? trendResult.value.map((night) => ({
      ...night,
      barHeight: night.valid ? Math.max(30, Math.min(150, night.snoreEvents * 5)) : 18,
    })) : []
    const interpretation = nightAiResult.ok ? nightAiResult.value : null
    const weekInterpretation = weekAiResult.ok ? weekAiResult.value : null
    const activeInterpretation = this.data.scope === 'week' ? weekInterpretation : interpretation

    this.setData({
      nights,
      validNightCount: nights.filter((night) => night.valid).length,
      trendUnavailable: !trendResult.ok,
      feedback: feedbackResult.ok ? feedbackResult.value : null,
      interpretation,
      weekInterpretation,
      activeInterpretation,
      interpretationFallback: !interpretation,
    })
  },

  setScope(event) {
    const scope = event.currentTarget.dataset.scope
    if (!['night', 'week'].includes(scope)) return
    this.setData({
      scope,
      activeInterpretation: scope === 'week' ? this.data.weekInterpretation : this.data.interpretation,
    })
  },

  retry() { return this.load() },
  handleServiceAction(event) { return runServiceErrorAction(event.detail.action, () => this.retry(), wx) },
  openEvents() { wx.navigateTo({ url: '/pages/events/index' }) },
  openFeedback() { wx.navigateTo({ url: '/pages/trends/index' }) },
  openInterpretation() {
    if (!this.data.activeInterpretation) return
    wx.navigateTo({ url: `/pages/ai-detail/index?interpretationId=${this.data.activeInterpretation.interpretationId}` })
  },
})

async function settle(promise) {
  try {
    return { ok: true, value: await promise }
  } catch (error) {
    return { ok: false, error }
  }
}
