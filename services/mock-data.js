const profile = {
  id: 'demo-user',
  nickname: '月石用户',
  sleepMode: 'shared',
  privacyAccepted: false,
  aiDataAuthorized: false,
}

const deviceStatus = {
  bound: true,
  provisioned: true,
  host: {
    name: '月石床头主机',
    serialNumber: 'SM-MOON-A102',
    online: true,
    firmwareVersion: '1.4.2',
    firmwareUpdateAvailable: false,
    modelVersion: 'SnoozSense 0.9.6',
    modelUpdateAvailable: true,
  },
  pad: { name: '枕下定向振动片', connected: true, connectionType: 'wired' },
  microphones: { label: '双麦克风', status: 'ready' },
  radar: { label: '24G 毫米波雷达', status: 'ready' },
  sync: { status: 'success', lastSyncedAt: '今天 07:42' },
  localLoop: '感知 → 判断 → 振动 → 验证 → 停止',
}

const tonightSettings = {
  sleepMode: 'shared',
  sensitivity: 2,
  maxVibrationLevel: 3,
  sleepProtectionMinutes: 30,
  nightlyInterventionLimit: 8,
}

const calibrationGuidance = {
  ready: '月石床头主机已准备好。保持主机正面朝向床中央，枕下定向振动片平整放在枕头下方。',
  adjust: '请按未通过项调整后重试。校准仅检查放置与连接，不会启动振动。',
}

const soundState = {
  scene: 'sleep',
  sceneName: '睡眠',
  trackName: '月石雨声',
  playing: false,
  volume: 32,
  timer: 30,
  fadeSeconds: 3,
  scenes: [
    { id: 'sleep', name: '睡眠', trackName: '月石雨声' },
    { id: 'healing', name: '治愈', trackName: '林间溪流' },
    { id: 'work', name: '工作', trackName: '柔和白噪' },
    { id: 'reading', name: '看书', trackName: '壁炉微响' },
  ],
}

const lightState = {
  enabled: true,
  mode: 'night-low',
  modeName: '低亮',
  brightness: 25,
  color: 'amber',
}

const latestReport = {
  id: 'night-2026-08-31',
  date: '9 月 1 日 周二',
  effectiveMonitoringMinutes: 432,
  snoreEventCount: 12,
  supineAssociationRate: 67,
  supineSnoreTrend: '较侧卧明显增多',
  interventionCount: 5,
  snoreStoppedResponses: 3,
  turnOverResponses: 1,
  interventionSuccessRate: 80,
  dataQuality: '良好',
  dataQualityScore: 92,
  startTime: '23:18',
  endTime: '06:42',
  timelineMarks: [18, 50, 86],
  attentionLevel: 'attention',
  safetyNotice: '用于趋势观察与体位提醒，不替代医疗检查',
}

const events = [
  { id: 'e1', time: '00:18', type: 'sleep-protection', title: '入睡保护结束', detail: '设备开始本地趋势观察' },
  { id: 'e2', time: '01:42', type: 'snore', title: '仰卧鼾声趋势上升', detail: '本地模型完成判断' },
  { id: 'e3', time: '01:44', type: 'intervention', title: '渐进振动提醒', detail: '第 2 级，24 秒后停止' },
  { id: 'e4', time: '01:45', type: 'response', title: '检测到翻身响应', detail: '趋势回落，验证后停止' },
  { id: 'e5', time: '04:26', type: 'intervention', title: '渐进振动提醒', detail: '第 3 级，停鼾响应' },
]

const sevenNightTrend = [
  { date: '8/25', valid: true, snoreEvents: 24, interventions: 6, successRate: 67, quality: 88 },
  { date: '8/26', valid: true, snoreEvents: 22, interventions: 5, successRate: 80, quality: 91 },
  { date: '8/27', valid: false, snoreEvents: 0, interventions: 0, successRate: 0, quality: 32 },
  { date: '8/28', valid: true, snoreEvents: 21, interventions: 5, successRate: 60, quality: 89 },
  { date: '8/29', valid: true, snoreEvents: 19, interventions: 4, successRate: 75, quality: 93 },
  { date: '8/30', valid: true, snoreEvents: 20, interventions: 5, successRate: 80, quality: 90 },
  { date: '8/31', valid: true, snoreEvents: 12, interventions: 5, successRate: 80, quality: 92 },
]

const aiInterpretations = [
  {
    interpretationId: 'night-2026-08-31-r1',
    kind: 'single-night',
    nightId: 'night-2026-08-31',
    status: 'ready',
    source: 'rule-demo',
    sourceLabel: '演示解读',
    generatedAt: '今天 07:45',
    periodLabel: '9 月 1 日',
    revision: 1,
    modelVersion: 'Demo Insight 0.3',
    inputSnapshotVersion: 'night-summary-v1',
    dataQuality: '良好',
    consentVersion: 'privacy-v1',
    conclusion: '后半夜仰卧鼾声更集中',
    summary: '共出现 12 次鼾声事件，其中 8 次与仰卧时段重合。',
    nextStep: '降低今晚干预上限，并延长入睡保护。',
    evidence: [
      { id: 'ev-snore', metric: '鼾声事件', value: 12, unit: '次', window: '昨夜', sourceRefs: ['event:e2', 'summary:night-2026-08-31'], quality: 'good', explanation: '主要集中在 03:10—05:20' },
      { id: 'ev-supine', metric: '仰卧重合', value: 8, unit: '次', window: '昨夜', sourceRefs: ['event:e2'], quality: 'good', explanation: '12 次事件中有 8 次与仰卧时段重合' },
      { id: 'ev-response', metric: '温和响应', value: 4, unit: '/5', window: '昨夜', sourceRefs: ['event:e3', 'event:e4', 'event:e5'], quality: 'good', explanation: '5 次提醒中有 4 次出现停鼾或翻身响应' },
    ],
  },
  {
    interpretationId: 'week-2026-08-25-r1',
    kind: 'seven-night',
    periodStart: '2026-08-25',
    periodEnd: '2026-08-31',
    timezone: 'Asia/Shanghai',
    status: 'ready',
    source: 'rule-demo',
    sourceLabel: '演示解读',
    generatedAt: '今天 07:46',
    periodLabel: '8 月 25—31 日',
    revision: 1,
    modelVersion: 'Demo Insight 0.3',
    inputSnapshotVersion: 'seven-night-v1',
    dataQuality: '6 晚有效',
    consentVersion: 'privacy-v1',
    conclusion: '保持当前温和强度',
    summary: '仰卧鼾声较前一周期减少 18%，提醒响应保持稳定。',
    nextStep: '继续记录 3 晚，优先关注共享睡眠时伴侣是否受影响。',
    evidence: [
      { id: 'ev-week-snore', metric: '鼾声趋势', value: -25, unit: '%', window: '7 晚', sourceRefs: ['trend:2026-08-25/2026-08-31'], quality: 'good', explanation: '从 24 次下降至 18 次' },
      { id: 'ev-week-valid', metric: '有效夜晚', value: 6, unit: '晚', window: '7 晚', sourceRefs: ['trend:2026-08-25/2026-08-31'], quality: 'good', explanation: '足以观察连续变化' },
      { id: 'ev-week-response', metric: '最近响应率', value: 80, unit: '%', window: '昨夜', sourceRefs: ['summary:night-2026-08-31'], quality: 'good', explanation: '仍处于近 7 晚稳定区间' },
    ],
  },
  {
    interpretationId: 'night-2026-08-30-r1',
    kind: 'single-night',
    nightId: 'night-2026-08-30',
    status: 'ready',
    source: 'rule-demo',
    sourceLabel: '演示解读',
    generatedAt: '昨天 07:38',
    periodLabel: '8 月 31 日',
    revision: 1,
    modelVersion: 'Demo Insight 0.3',
    inputSnapshotVersion: 'night-summary-v1',
    dataQuality: '良好',
    consentVersion: 'privacy-v1',
    conclusion: '共享睡眠影响较少',
    summary: '伴侣反馈未受影响，提醒响应稳定。',
    nextStep: '继续观察即可。',
    evidence: [
      { id: 'ev-prev-snore', metric: '鼾声事件', value: 20, unit: '次', window: '8 月 30 日', sourceRefs: ['summary:night-2026-08-30'], quality: 'good', explanation: '结构化夜间摘要' },
    ],
  },
]

const guardianSnapshot = {
  deviceId: 'mock-moon-a102',
  nightId: 'night-2026-09-01',
  sessionId: 'session-2026-09-01',
  snapshotId: 'guardian-1',
  sequence: 1,
  deviceTime: '23:18:05',
  receivedAt: '刚刚',
  validUntil: '23:18:20',
  source: 'ble',
  freshness: 'fresh',
  guardianState: 'observing',
  cycleId: null,
  enteredAt: '23:02',
  activeIntervention: null,
  protectionRemainingSeconds: 0,
  interventionCount: 2,
  interventionLimit: 8,
  micStatus: 'ready',
  radarStatus: 'ready',
  padStatus: 'connected',
  dataQuality: 'good',
  reasonCodes: ['LOCAL_GUARDIAN_ACTIVE'],
  latestEventId: 'e5',
  activities: [
    { time: '02:18', title: '温和提醒已停止', detail: '第 1 级 · 16 秒后检测到翻身' },
    { time: '01:42', title: '无需提醒', detail: '短暂鼾声后自行停止' },
  ],
  configVersion: 12,
  modelVersion: 'SnoozSense 0.9.6',
}

const aiTonightCandidate = {
  candidateId: 'gentle-night-2026-09-01-r1',
  interpretationId: 'night-2026-08-31-r1',
  createdAt: '今天 20:30',
  expiresAt: '明天 06:00',
  rationale: '最近 3 晚已有稳定响应，昨夜 5 次提醒中 4 次后续出现停鼾或翻身。',
  candidateSettings: {
    sleepMode: 'shared',
    sensitivity: 2,
    maxVibrationLevel: 2,
    sleepProtectionMinutes: 45,
    nightlyInterventionLimit: 6,
  },
}

module.exports = {
  profile,
  deviceStatus,
  tonightSettings,
  calibrationGuidance,
  soundState,
  lightState,
  latestReport,
  events,
  sevenNightTrend,
  aiInterpretations,
  guardianSnapshot,
  aiTonightCandidate,
}
