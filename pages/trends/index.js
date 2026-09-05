const services = require('../../services/index')
const { getAttentionGuidance } = require('../../domain/attention-guidance')
const { runServiceErrorAction, toUserError } = require('../../domain/service-error')

function isCompleteFeedback(feedback) {
  return Boolean(feedback)
    && typeof feedback.awakened === 'boolean'
    && typeof feedback.partnerAffected === 'boolean'
    && Number.isInteger(feedback.nextDayEnergy)
    && feedback.nextDayEnergy >= 1
    && feedback.nextDayEnergy <= 5
}

function emptyFeedback() {
  return { awakened: null, partnerAffected: null, nextDayEnergy: null }
}

function feedbackForNight(feedback, nightId) {
  return isCompleteFeedback(feedback) && feedback.nightId === nightId
    ? { awakened: feedback.awakened, partnerAffected: feedback.partnerAffected, nextDayEnergy: feedback.nextDayEnergy }
    : null
}

Page({
  data: {
    nights: [],
    feedback: emptyFeedback(),
    currentNightId: '',
    submitted: false,
    energyOptions: [1, 2, 3, 4, 5],
    validCount: 0,
    lastSuccessRate: 0,
    guidance: null,
    phase: 'loading',
    loading: true,
    error: null,
    errorMessage: '',
    insufficientData: false,
    submitting: false,
    dataSource: 'none',
  },
  onShow() { this.load() },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },
  async load() {
    const requestId = (this._requestId || 0) + 1
    this._requestId = requestId
    this.setData({ loading: true, phase: 'loading', error: null, errorMessage: '', nights: [], guidance: null, insufficientData: false, dataSource: 'none' })
    try {
      const [nights, latestReport] = await Promise.all([services.reports.getSevenNightTrend(), services.reports.getLatest()])
      if (requestId !== this._requestId) return
      const normalizedNights = nights.map((night) => ({ ...night, barHeight: night.valid ? Math.max(28, night.snoreEvents * 5) : 18 }))
      const validNights = normalizedNights.filter((night) => night.valid)
      const trendDataSource = nights.dataSource || 'none'
      const latestValidNight = validNights.length ? validNights[validNights.length - 1] : null
      const currentNightId = latestValidNight ? latestValidNight.nightId : ''
      const guidance = latestReport && latestReport.hasData !== false ? getAttentionGuidance(latestReport.attentionLevel) : null
      if (!validNights.length) {
        this.setData({
          nights: normalizedNights,
          currentNightId: '',
          feedback: emptyFeedback(),
          submitted: false,
          guidance: null,
          phase: 'empty',
          validCount: 0,
          lastSuccessRate: 0,
          dataSource: 'none',
        })
        return
      }
      if (!guidance) {
        this.setData({
          nights: normalizedNights,
          currentNightId,
          feedback: emptyFeedback(),
          submitted: false,
          guidance: null,
          phase: 'unavailable',
          errorMessage: '趋势关注类别暂不可用，请同步后重试。',
        })
        return
      }
      const feedback = currentNightId ? await services.reports.getFeedback(currentNightId) : null
      if (requestId !== this._requestId) return
      const savedFeedback = feedbackForNight(feedback, currentNightId)
      this.setData({
        nights: normalizedNights,
        guidance,
        phase: 'data',
        validCount: validNights.length,
        insufficientData: validNights.length < 3,
        lastSuccessRate: validNights.length ? validNights[validNights.length - 1].successRate : 0,
        currentNightId,
        feedback: savedFeedback || emptyFeedback(),
        submitted: Boolean(savedFeedback),
        dataSource: trendDataSource === 'mixed' || trendDataSource === 'simulated'
          ? trendDataSource
          : (latestReport.dataSource || 'device'),
      })
    } catch (error) {
      if (requestId === this._requestId) {
        const userError = toUserError(error, '七晚趋势')
        this.setData({ phase: 'error', error: userError, errorMessage: `趋势同步失败。${userError.detail}` })
      }
    } finally {
      if (requestId === this._requestId) this.setData({ loading: false })
    }
  },
  chooseBoolean(event) {
    if (this.data.submitting) return
    const key = event.currentTarget.dataset.key
    const value = event.currentTarget.dataset.value === 'true'
    this.setData({ [`feedback.${key}`]: value, submitted: false })
  },
  retry() { return this.load() },
  handleServiceAction(event) { return runServiceErrorAction(event.detail.action, () => this.retry(), wx) },
  setEnergy(event) {
    if (this.data.submitting) return
    const value = Math.min(5, Math.max(1, Math.round(Number(event.currentTarget.dataset.value))))
    this.setData({ 'feedback.nextDayEnergy': value, submitted: false })
  },
  async submitFeedback() {
    if (this.data.submitting) return
    if (!isCompleteFeedback(this.data.feedback)) {
      wx.showToast({ title: '请完成三项反馈', icon: 'none' }); return
    }
    if (!this.data.currentNightId) {
      wx.showToast({ title: '当前夜晚尚未生成，暂不能记录反馈', icon: 'none' }); return
    }
    this.setData({ submitting: true })
    try {
      const response = await services.reports.submitFeedback({ nightId: this.data.currentNightId, ...this.data.feedback })
      const feedback = {
        ...response,
        nightId: response.nightId || this.data.currentNightId,
        awakened: typeof response.awakened === 'boolean' ? response.awakened : this.data.feedback.awakened,
        partnerAffected: typeof response.partnerAffected === 'boolean' ? response.partnerAffected : this.data.feedback.partnerAffected,
        nextDayEnergy: Number.isInteger(response.nextDayEnergy) ? response.nextDayEnergy : this.data.feedback.nextDayEnergy,
      }
      const savedFeedback = feedbackForNight(feedback, this.data.currentNightId)
      if (!savedFeedback) {
        wx.showToast({ title: '反馈暂未记录，请稍后重试', icon: 'none' }); return
      }
      this.setData({ feedback: savedFeedback, submitted: true })
      wx.showToast({ title: '反馈已记录', icon: 'success' })
    } catch (error) {
      const userError = toUserError(error, '晨间反馈')
      wx.showToast({ title: userError.title, icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },
})
