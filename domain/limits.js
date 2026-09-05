const TONIGHT_LIMITS = Object.freeze({
  sensitivity: { min: 1, max: 3 },
  maxVibrationLevel: { min: 1, max: 5 },
  sleepProtectionMinutes: { min: 15, max: 90 },
  nightlyInterventionLimit: { min: 0, max: 12 },
})

function clamp(value, min, max) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return min
  return Math.min(max, Math.max(min, Math.round(numeric)))
}

function normalizeTonightSettings(input = {}) {
  return {
    sleepMode: input.sleepMode === 'shared' ? 'shared' : 'solo',
    sensitivity: clamp(input.sensitivity, 1, 3),
    maxVibrationLevel: clamp(input.maxVibrationLevel, 1, 5),
    sleepProtectionMinutes: clamp(input.sleepProtectionMinutes, 15, 90),
    nightlyInterventionLimit: clamp(input.nightlyInterventionLimit, 0, 12),
  }
}

function normalizeFeedback(input = {}) {
  return {
    awakened: Boolean(input.awakened),
    partnerAffected: input.partnerAffected === null ? null : Boolean(input.partnerAffected),
    nextDayEnergy: clamp(input.nextDayEnergy, 1, 5),
  }
}

module.exports = { TONIGHT_LIMITS, clamp, normalizeTonightSettings, normalizeFeedback }
