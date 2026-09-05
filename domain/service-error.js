const errorDefinitions = {
  DEVICE_OFFLINE: {
    title: '设备当前离线',
    detail: '请检查月石床头主机的电源与网络后重试。',
    retryable: true,
    action: 'retry',
  },
  NOT_PROVISIONED: {
    title: '设备尚未完成配网',
    detail: '请先完成月石床头主机配网，再重试当前操作。',
    retryable: false,
    action: 'setup',
  },
  AUTH_EXPIRED: {
    title: '登录状态已过期',
    detail: '请重新登录后继续。',
    retryable: false,
    action: 'reauth',
  },
  SYNC_TIMEOUT: {
    title: '同步超时',
    detail: '设备本地守护不受影响，请稍后重试。',
    retryable: true,
    action: 'retry',
  },
  NETWORK_ERROR: {
    title: '网络连接未完成',
    detail: '请检查网络后重试。请求已停止，不会在后台继续等待。',
    retryable: true,
    action: 'retry',
  },
  HTTP_5XX: {
    title: '云端服务暂时繁忙',
    detail: '请稍后重试。设备本地守护不会因此停止。',
    retryable: true,
    action: 'retry',
  },
  AI_CONSENT_REQUIRED: {
    title: '需要 AI 数据授权',
    detail: '请先在 AI 页面或“我的”中允许 AI 使用结构化睡眠资料。',
    retryable: false,
    action: 'retry',
  },
  NOT_CONFIGURED: {
    title: '生产服务尚未配置',
    detail: '真实硬件与云端适配器尚未接通，当前功能不可用。',
    retryable: false,
    action: 'retry',
  },
  CLOUD_NOT_CONFIGURED: {
    title: '微信云调用尚未配置',
    detail: '请确认小程序已初始化正确的云环境，并配置 snoozmate-api 服务名。',
    retryable: false,
    action: 'retry',
  },
}

function readCode(error) {
  const stableCode = error && typeof error.code === 'string' ? error.code : ''
  if (errorDefinitions[stableCode]) return stableCode

  const legacyMessage = error && typeof error.message === 'string' ? error.message : ''
  const match = legacyMessage.match(/^(DEVICE_OFFLINE|NOT_PROVISIONED|AUTH_EXPIRED|SYNC_TIMEOUT|NOT_CONFIGURED|CLOUD_NOT_CONFIGURED|NETWORK_ERROR|HTTP_5XX|AI_CONSENT_REQUIRED)(?::|\b)/)
  return match ? match[1] : 'UNKNOWN'
}

function toUserError(error, context = '当前内容') {
  const code = readCode(error)
  const definition = errorDefinitions[code]
  if (definition) return { code, ...definition }

  return {
    code: 'UNKNOWN',
    title: `${context}暂时不可用`,
    detail: '请稍后重试。如果问题持续，请联系客服。',
    retryable: true,
    action: 'retry',
  }
}

function runServiceErrorAction(action, retry, platform = typeof wx === 'undefined' ? null : wx) {
  if (action === 'reauth' && platform) return platform.reLaunch({ url: '/pages/onboarding/index?reauth=1' })
  if (action === 'setup' && platform) return platform.navigateTo({ url: '/pages/setup/index' })
  if (action === 'retry' && typeof retry === 'function') return retry()
  return undefined
}

module.exports = { runServiceErrorAction, toUserError }
