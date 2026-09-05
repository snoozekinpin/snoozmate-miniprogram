const services = require('../../services/index')
const { runServiceErrorAction, toUserError } = require('../../domain/service-error')

Page({
  data: {
    events: [],
    visibleEvents: [],
    filter: 'all',
    nightId: '',
    nightLabel: '',
    loading: true,
    error: null,
    phase: 'loading',
    filters: [
      { id: 'all', name: '全部' },
      { id: 'snore', name: '鼾声趋势' },
      { id: 'intervention', name: '振动提醒' },
      { id: 'response', name: '响应' },
    ],
  },
  onLoad() { return this.load() },
  async load() {
    this.setData({
      loading: true,
      error: null,
      phase: 'loading',
      events: [],
      visibleEvents: [],
      nightId: '',
      nightLabel: '',
    })
    try {
      // Resolve the latest completed night first. Never fall back to a
      // device-wide recent-events query, which can span multiple nights.
      const latestReport = await services.reports.getLatest()
      const nightId = latestReport && (latestReport.nightId || latestReport.id)
      const nightLabel = formatNightLabel(latestReport)
      if (!latestReport || latestReport.hasData === false || !nightId) {
        this.setData({ nightId: nightId || '', nightLabel, phase: 'empty' })
        return
      }

      const events = await services.reports.getEvents({ nightId, limit: 100 })
      this.setData({
        events,
        visibleEvents: events,
        nightId,
        nightLabel,
        phase: events.length ? 'data' : 'empty',
      })
    } catch (error) {
      this.setData({
        events: [],
        visibleEvents: [],
        nightId: '',
        nightLabel: '',
        error: toUserError(error, '夜间事件'),
        phase: 'error',
      })
    } finally {
      this.setData({ loading: false })
    }
  },
  retry() { return this.load() },
  handleServiceAction(event) { return runServiceErrorAction(event.detail.action, () => this.retry(), wx) },
  setFilter(event) {
    const filter = event.currentTarget.dataset.filter
    const visibleEvents = filter === 'all' ? this.data.events : this.data.events.filter((item) => item.type === filter)
    this.setData({ filter, visibleEvents })
  },
})

function formatNightLabel(report) {
  const source = String((report && (report.date || report.nightId || report.id)) || '')
  const compact = source.match(/(20\d{2})[-/]?(\d{2})[-/]?(\d{2})/)
    || source.match(/night[-_](20\d{2})[-_](\d{2})[-_](\d{2})/)
  if (compact) {
    return `${compact[1]}年${Number(compact[2])}月${Number(compact[3])}日晚`
  }
  return source ? `${source} · 最近一晚` : ''
}
