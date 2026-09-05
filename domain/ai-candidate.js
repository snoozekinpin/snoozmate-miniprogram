const RULES = [
  {
    field: 'maxVibrationLevel',
    valid(current, candidate) {
      return candidate <= current
    },
    message: '最大振动等级不能高于当前值'
  },
  {
    field: 'sleepProtectionMinutes',
    valid(current, candidate) {
      return candidate >= current
    },
    message: '入睡保护时间不能短于当前值'
  },
  {
    field: 'nightlyInterventionLimit',
    valid(current, candidate) {
      return candidate <= current
    },
    message: '每晚次数上限不能高于当前值'
  }
]

function validateGentleCandidate(current, candidate) {
  const currentSettings = current || {}
  const candidateSettings = candidate || {}
  const fieldErrors = []

  RULES.forEach((rule) => {
    const currentValue = currentSettings[rule.field]
    const candidateValue = candidateSettings[rule.field]
    if (
      typeof currentValue !== 'number' ||
      !Number.isFinite(currentValue) ||
      typeof candidateValue !== 'number' ||
      !Number.isFinite(candidateValue) ||
      !rule.valid(currentValue, candidateValue)
    ) {
      fieldErrors.push({ field: rule.field, message: rule.message })
    }
  })

  return {
    valid: fieldErrors.length === 0,
    fieldErrors
  }
}

module.exports = {
  validateGentleCandidate
}
