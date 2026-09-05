const services = require('../../services/index')
const { runServiceErrorAction, toUserError } = require('../../domain/service-error')

Page({
  data: { status: null, loading: true, error: null, phase: 'loading' },
  onShow() { this.load() },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },
  async load() {
    this.setData({ loading: true, error: null, phase: 'loading' })
    try {
      const status = await services.device.getStatus()
      this.setData({ status, phase: status ? 'data' : 'empty' })
    } catch (error) {
      this.setData({ status: null, error: toUserError(error, '设备状态'), phase: 'error' })
    } finally {
      this.setData({ loading: false })
    }
  },
  retry() { return this.load() },
  handleServiceAction(event) { return runServiceErrorAction(event.detail.action, () => this.retry(), wx) },
  showUpdateInfo(event) {
    wx.showModal({ title: event.currentTarget.dataset.kind === 'model' ? '模型更新' : '固件更新', content: '当前为接口占位状态。正式版本需由硬件 OTA 与云端发布服务提供更新包和签名。', showCancel: false, confirmColor: '#B97728' })
  },
})
