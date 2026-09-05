const services = require('../../services/index')
const { toUserError } = require('../../domain/service-error')

Page({
  data: { interpretation: null, selectedEvidenceId: '', loading: true, error: null },
  onLoad(options) { this.load(decodeURIComponent(options.interpretationId || '')) },

  async load(interpretationId) {
    if (!interpretationId) {
      this.setData({ loading: false, error: toUserError(new Error('AI_INTERPRETATION_NOT_FOUND'), 'AI 解读') })
      return
    }
    this.setData({ loading: true, error: null })
    try {
      const interpretation = await services.ai.getInterpretation(interpretationId)
      this.setData({ interpretation, selectedEvidenceId: interpretation.evidence[0] ? interpretation.evidence[0].id : '' })
    } catch (error) {
      this.setData({ error: toUserError(error, 'AI 解读') })
    } finally {
      this.setData({ loading: false })
    }
  },

  toggleEvidence(event) {
    const id = event.currentTarget.dataset.id
    this.setData({ selectedEvidenceId: this.data.selectedEvidenceId === id ? '' : id })
  },
  openChat() {
    const item = this.data.interpretation
    if (item) wx.navigateTo({ url: `/pages/ai-chat/index?interpretationId=${item.interpretationId}&revision=${item.revision}` })
  },
  openSleepRecord() { wx.switchTab({ url: '/pages/report/index' }) },
  openPlan() {
    const item = this.data.interpretation
    if (item && item.kind === 'single-night') wx.navigateTo({ url: `/pages/ai-plan/index?interpretationId=${item.interpretationId}` })
  },
})
