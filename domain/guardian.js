const STOPPABLE_STATES = ['intervening', 'verifying']

function canStopIntervention(snapshot) {
  return Boolean(
    snapshot &&
    snapshot.source === 'ble' &&
    snapshot.freshness === 'fresh' &&
    STOPPABLE_STATES.includes(snapshot.guardianState)
  )
}

module.exports = {
  STOPPABLE_STATES,
  canStopIntervention
}
