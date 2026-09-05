const services = require('./services/index')
const env = require('./config/env')

App({
  globalData: {
    brand: '好眠 SnoozMate',
    services,
  },

  onLaunch() {
    if (env.transport !== 'public' && services.initializeCloudContainer) {
      try {
        this.globalData.cloudContainer = services.initializeCloudContainer()
      } catch (error) {
        this.globalData.cloudContainerError = error.code || 'CLOUD_NOT_CONFIGURED'
      }
    }
    const profile = wx.getStorageSync('haomian-profile')
    if (profile) {
      this.globalData.profile = profile
    }
  },
})
