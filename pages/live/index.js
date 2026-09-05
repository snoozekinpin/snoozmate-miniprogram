const services = require('../../services/index')
const { canStopIntervention } = require('../../domain/guardian')
const { toUserError } = require('../../domain/service-error')

const STATE_COPY = {
  observing: { title: '正在安静观察', detail: '麦克风与雷达在本地识别趋势，不上传连续原始音频。' },
  sensing: { title: '捕捉到变化', detail: '正在核对声音与体动趋势。' },
  deciding: { title: '本地判断中', detail: '月石在安全边界内判断是否需要提醒。' },
  intervening: { title: '正在温和提醒', detail: '枕下定向振动片正在执行月石确认过的渐进提醒。' },
  verifying: { title: '正在验证响应', detail: '月石正在确认停鼾或翻身响应。' },
  stopped: { title: '本次提醒已停止', detail: '月石已确认停止，随后继续安静观察。' },
  delayed: { title: '状态有所延迟', detail: '当前显示最近一次缓存快照，本地守护仍由月石继续。' },
  'stop-unconfirmed': { title: '停止尚未确认', detail: '请靠近月石床头主机检查连接状态。' },
}

Page({
  data: {
    loading: true,
    error: null,
    snapshot: null,
    presentation: STATE_COPY.observing,
    canStop: false,
    stopping: false,
    demoMode: services.serviceMode === 'mock',
    settings: { maxVibrationLevel: 3 },
    loopSteps: ['感知', '判断', '提醒', '验证', '停止'],
    demoPhases: [
      { id: 'observing', name: '观察' },
      { id: 'sensing', name: '感知' },
      { id: 'deciding', name: '判断' },
      { id: 'intervening', name: '提醒' },
      { id: 'verifying', name: '验证' },
      { id: 'delayed', name: '延迟' },
    ],
  },

  onShow() { this.load() },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },

  async load() {
    this.setData({ loading: true, error: null })
    try {
      const [snapshot, settings] = await Promise.all([
        services.guardian.getSnapshot(),
        services.device && services.device.getTonightSettings
          ? services.device.getTonightSettings().catch(() => this.data.settings)
          : Promise.resolve(this.data.settings),
      ])
      this.setData({ settings })
      this.applySnapshot(snapshot)
    } catch (error) {
      this.setData({ error: toUserError(error, '实时守护') })
    } finally {
      this.setData({ loading: false })
    }
  },

  applySnapshot(snapshot) {
    this.setData({
      snapshot,
      presentation: STATE_COPY[snapshot.guardianState] || STATE_COPY.delayed,
      canStop: canStopIntervention(snapshot),
    })
  },

  async stopCurrent() {
    if (this.data.stopping || !this.data.canStop || !this.data.snapshot) return
    this.setData({ stopping: true, error: null })
    try {
      const snapshot = await services.guardian.stopCurrentIntervention({
        snapshotId: this.data.snapshot.snapshotId,
        cycleId: this.data.snapshot.cycleId,
      })
      this.applySnapshot(snapshot)
    } catch (error) {
      const delayed = {
        ...this.data.snapshot,
        guardianState: 'stop-unconfirmed',
        freshness: 'stale',
      }
      this.applySnapshot(delayed)
      this.setData({ error: toUserError(error, '停止请求') })
    } finally {
      this.setData({ stopping: false })
    }
  },

  async setDemoPhase(event) {
    if (!this.data.demoMode || !services.guardian.setDemoPhase) return
    const phase = event.currentTarget.dataset.phase
    this.setData({ loading: true, error: null })
    try {
      this.applySnapshot(await services.guardian.setDemoPhase(phase))
    } catch (error) {
      this.setData({ error: toUserError(error, '演示状态') })
    } finally {
      this.setData({ loading: false })
    }
  },
  openTonight() { wx.navigateTo({ url: '/pages/tonight/index' }) },
  backTonight() { wx.switchTab({ url: '/pages/home/index' }) },
})
