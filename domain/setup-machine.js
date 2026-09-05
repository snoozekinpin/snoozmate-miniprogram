const allowedTransitions = {
  idle: ['START_SEARCH'],
  searching: ['DEVICE_FOUND', 'FAILED'],
  found: ['START_CONNECT', 'START_SEARCH', 'FAILED'],
  connecting: ['CONNECTED', 'FAILED'],
  connected: ['START_PROVISION', 'FAILED'],
  provisioning: ['PROVISIONED', 'FAILED'],
  failed: ['RETRY'],
  success: [],
}

function initialSetupState() {
  return { step: 'idle', device: null, reason: null, retryStep: 'idle' }
}

function transitionSetup(state, event) {
  if (!allowedTransitions[state.step] || !allowedTransitions[state.step].includes(event.type)) return state

  switch (event.type) {
    case 'START_SEARCH': return { ...state, step: 'searching', reason: null, retryStep: 'searching' }
    case 'DEVICE_FOUND': return { ...state, step: 'found', device: event.device, reason: null, retryStep: 'searching' }
    case 'START_CONNECT': return { ...state, step: 'connecting', reason: null, retryStep: 'found' }
    case 'CONNECTED': return { ...state, step: 'connected', reason: null, retryStep: 'found' }
    case 'START_PROVISION': return { ...state, step: 'provisioning', reason: null, retryStep: 'connected' }
    case 'PROVISIONED': return { ...state, step: 'success', reason: null, retryStep: 'connected' }
    case 'FAILED': return { ...state, step: 'failed', reason: event.reason || 'UNKNOWN', retryStep: event.retryStep || state.retryStep }
    case 'RETRY': return { ...state, step: state.retryStep || 'idle', reason: null }
    default: return state
  }
}

module.exports = { initialSetupState, transitionSetup }
