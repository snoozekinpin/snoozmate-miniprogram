function buildCalibration(status, guidance) {
  const placementReady = Boolean(status.bound && status.provisioned && status.host && status.host.online)
  const microphonesReady = Boolean(status.microphones && status.microphones.status === 'ready')
  const radarReady = Boolean(status.radar && status.radar.status === 'ready')
  const padReady = Boolean(status.pad && status.pad.connected)
  const checks = [
    { id: 'placement', label: '主机放置', ready: placementReady, detail: placementReady ? '主机在线，正面朝向床中央' : '请确认主机已通电、在线并正面朝向床中央' },
    { id: 'microphones', label: '双麦克风', ready: microphonesReady, detail: microphonesReady ? '本地声音趋势感知可用' : '请移开遮挡并检查主机位置' },
    { id: 'radar', label: '24G 毫米波雷达', ready: radarReady, detail: radarReady ? '在床与体动趋势感知可用' : '请保持雷达正面无遮挡' },
    { id: 'pad', label: '枕下定向振动片', ready: padReady, detail: padReady ? '已通过有线连接' : '请将振动片平整放在枕头下方并接牢' },
  ]
  const ready = checks.every((item) => item.ready)

  return {
    ready,
    checks,
    serialNumber: status.host && status.host.serialNumber,
    guidance: ready ? guidance.ready : guidance.adjust,
  }
}

module.exports = { buildCalibration }
