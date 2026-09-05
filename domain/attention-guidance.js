const guidanceByLevel = {
  stable: {
    level: 'stable',
    label: '趋势平稳',
    tone: 'stable',
    title: '近期趋势整体平稳',
    action: '继续保持规律记录，关注体位变化与晨间感受。',
  },
  attention: {
    level: 'attention',
    label: '建议留意',
    tone: 'attention',
    title: '近期有值得留意的趋势',
    action: '可继续观察体位变化与晨间感受，必要时调整睡眠习惯。',
  },
  consult: {
    level: 'consult',
    label: '建议进一步咨询',
    tone: 'consult',
    title: '连续多晚出现值得关注的趋势',
    action: '如果同时有明显憋醒、白天持续困倦或其他不适，建议咨询医生并考虑接受专业检查。',
  },
}

function getAttentionGuidance(level) {
  return guidanceByLevel[level] || null
}

module.exports = { getAttentionGuidance }
