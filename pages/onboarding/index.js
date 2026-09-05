const services = require('../../services/index')
const { runServiceErrorAction, toUserError } = require('../../domain/service-error')

Page({
  data: {
    phase: 'login',
    loading: false,
    submitting: false,
    error: null,
    nickname: '月石用户',
    sleepMode: 'shared',
    privacy: { structured: true, rawAudio: true, nonMedical: true },
  },

  onLoad(options = {}) {
    this._reauth = options.reauth === '1'
    if (!this._reauth && wx.getStorageSync('haomian-setup-complete')) {
      wx.switchTab({ url: '/pages/home/index' })
    }
  },

  async login() {
    if (this.data.submitting) return
    this.setData({ loading: true, submitting: true, error: null })
    try {
      // A valid cached session resolves immediately. Only invoke wx.login when
      // the adapter explicitly says the session is missing or expired.
      let result
      if (this._reauth) {
        result = await services.auth.login({ code: await getWeChatLoginCode(), force: true })
      } else {
        try {
          result = await services.auth.login({})
        } catch (error) {
          if (error.code !== 'AUTH_EXPIRED' && error.message !== 'AUTH_EXPIRED') throw error
          result = await services.auth.login({ code: await getWeChatLoginCode() })
        }
      }
      if (this._reauth && wx.getStorageSync('haomian-setup-complete')) {
        wx.switchTab({ url: '/pages/home/index' })
        return
      }
      this.setData({ phase: 'profile', nickname: result.profile.nickname, sleepMode: result.profile.sleepMode })
    } catch (error) {
      this.setData({ error: toUserError(error, '微信登录') })
    } finally {
      this.setData({ loading: false, submitting: false })
    }
  },

  setNickname(event) { if (!this.data.submitting) this.setData({ nickname: event.detail.value }) },
  setSleepMode(event) { if (!this.data.submitting) this.setData({ sleepMode: event.currentTarget.dataset.mode }) },

  async saveProfile() {
    if (this.data.submitting) return
    this.setData({ submitting: true, error: null })
    try {
      await services.auth.saveProfile({ nickname: this.data.nickname.trim() || '月石用户', sleepMode: this.data.sleepMode })
      this.setData({ phase: 'privacy' })
    } catch (error) {
      this.setData({ error: toUserError(error, '个人资料') })
    } finally {
      this.setData({ submitting: false })
    }
  },

  togglePrivacy(event) {
    if (this.data.submitting) return
    const key = event.currentTarget.dataset.key
    this.setData({ [`privacy.${key}`]: event.detail.value })
  },

  async acceptPrivacy() {
    if (this.data.submitting || !Object.values(this.data.privacy).every(Boolean)) return
    this.setData({ submitting: true, error: null })
    try {
      const profile = await services.auth.saveProfile({ privacyAccepted: true })
      wx.setStorageSync('haomian-profile', profile)
      wx.removeStorageSync('haomian-demo-mode')
      wx.removeStorageSync('haomian-setup-complete')
      wx.setStorageSync('haomian-setup-mode', 'normal')
      wx.navigateTo({ url: '/pages/setup/index' })
    } catch (error) {
      this.setData({ error: toUserError(error, '隐私授权') })
    } finally {
      this.setData({ submitting: false })
    }
  },

  handleServiceAction(event) {
    const retry = this.data.phase === 'login'
      ? () => this.login()
      : this.data.phase === 'profile'
        ? () => this.saveProfile()
        : () => this.acceptPrivacy()
    return runServiceErrorAction(event.detail.action, retry, wx)
  },
})

function getWeChatLoginCode() {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback(value)
    }
    const timer = setTimeout(
      () => finish(reject, Object.assign(new Error('微信登录超时'), { code: 'SYNC_TIMEOUT' })),
      5000,
    )
    wx.login({
      success(result) {
        if (result && result.code) finish(resolve, result.code)
        else finish(reject, Object.assign(new Error('AUTH_EXPIRED'), { code: 'AUTH_EXPIRED' }))
      },
      fail(error) { finish(reject, error) },
    })
  })
}
