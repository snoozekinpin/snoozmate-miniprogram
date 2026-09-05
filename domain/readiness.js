const CALIBRATION_STORAGE_KEY = 'haomian-calibration-success'
const REQUIRED_CHECK_IDS = ['placement', 'microphones', 'radar', 'pad']

function isSuccessfulCalibration(result) {
  if (!result || result.ready !== true) return false
  if (typeof result.calibrationToken !== 'string' || !result.calibrationToken.trim()) return false
  if (typeof result.serialNumber !== 'string' || !result.serialNumber.trim()) return false
  const checks = Array.isArray(result.checks) ? result.checks : []
  return REQUIRED_CHECK_IDS.every((id) => checks.some((check) => check && check.id === id && check.ready === true))
}

function createCalibrationMarker(result) {
  if (!isSuccessfulCalibration(result)) return null
  return {
    token: result.calibrationToken,
    serialNumber: result.serialNumber,
    checks: [...REQUIRED_CHECK_IDS],
  }
}

function evaluateReadiness(status, marker) {
  const markerChecks = Array.isArray(marker && marker.checks) ? marker.checks : []
  const markerReady = Boolean(
    marker
    && typeof marker.token === 'string'
    && marker.token.trim()
    && typeof marker.serialNumber === 'string'
    && marker.serialNumber === status?.host?.serialNumber
    && REQUIRED_CHECK_IDS.every((id) => markerChecks.includes(id))
  )
  const checks = [
    { id: 'calibration', label: '放置校准', ready: markerReady, detail: markerReady ? '已保留本次校准凭据' : '请重新完成放置校准' },
    { id: 'host', label: '月石床头主机', ready: Boolean(status?.bound && status?.provisioned && status?.host?.online), detail: '需完成绑定、配网并保持在线' },
    { id: 'pad', label: '枕下定向振动片', ready: Boolean(status?.pad?.connected), detail: '请确认有线连接牢固' },
    { id: 'microphones', label: '双麦克风', ready: status?.microphones?.status === 'ready', detail: '请移开遮挡并检查主机位置' },
    { id: 'radar', label: '24G 毫米波雷达', ready: status?.radar?.status === 'ready', detail: '请保持主机正面无遮挡' },
  ]
  return { ready: checks.every((check) => check.ready), checks }
}

module.exports = {
  CALIBRATION_STORAGE_KEY,
  createCalibrationMarker,
  evaluateReadiness,
  isSuccessfulCalibration,
}
