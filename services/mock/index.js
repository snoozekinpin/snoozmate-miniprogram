const data = require('../mock-data')
const { normalizeTonightSettings, normalizeFeedback, clamp } = require('../../domain/limits')
const { buildCalibration } = require('../../domain/calibration')
const { classifyAiQuestion } = require('../../domain/ai-safety')
const { canStopIntervention } = require('../../domain/guardian')
const { validateGentleCandidate } = require('../../domain/ai-candidate')

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function delay(value, milliseconds = 120) {
  return new Promise((resolve) => setTimeout(() => resolve(clone(value)), milliseconds))
}

function delayReject(error, milliseconds = 120) {
  return new Promise((resolve, reject) => setTimeout(() => reject(error), milliseconds))
}

function readStoredProfile() {
  if (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') return null
  const profile = wx.getStorageSync('haomian-profile')
  return profile && typeof profile === 'object' ? clone(profile) : null
}

function storeProfile(profile) {
  if (typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function') {
    wx.setStorageSync('haomian-profile', clone(profile))
  }
}

function readStoredChatSessions() {
  if (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') return []
  const sessions = wx.getStorageSync('haomian-ai-chat-sessions')
  return Array.isArray(sessions) ? clone(sessions) : []
}

function storeChatSessions(sessions) {
  if (typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function') {
    wx.setStorageSync('haomian-ai-chat-sessions', clone(sessions))
  }
}

function canControlDevice(status) {
  return status.bound && status.provisioned && status.host.online
}

function statusSnapshot(status) {
  return { ...clone(status), controlAvailable: canControlDevice(status) }
}

function createMockServices() {
  let currentProfile = { ...clone(data.profile), ...(readStoredProfile() || {}) }
  let status = clone(data.deviceStatus)
  let settings = clone(data.tonightSettings)
  let sound = clone(data.soundState)
  let light = clone(data.lightState)
  let configVersion = data.guardianSnapshot.configVersion
  let guardianSnapshot = clone(data.guardianSnapshot)
  let settingsCommand = null
  let commandSequence = 0
  let chatSessions = readStoredChatSessions()
  const feedbackByNight = new Map()
  let demoStates = {
    offline: false,
    unprovisioned: false,
    padDisconnected: false,
    noData: false,
    syncFailed: false,
    highAttention: false,
    firmwareUpdate: false,
    modelUpdate: true,
    commandOutcome: 'applied',
  }

  return {
    serviceMode: 'mock',
    configured: true,
    auth: {
      login: ({ code } = {}) => {
        if (!code) return delayReject(new Error('AUTH_EXPIRED'))
        return delay({ sessionId: 'mock-session', userId: currentProfile.id, profile: currentProfile })
      },
      getProfile: () => delay(currentProfile),
      saveProfile: async (profile) => {
        currentProfile = { ...currentProfile, ...clone(profile) }
        storeProfile(currentProfile)
        return delay(currentProfile)
      },
    },
    device: {
      discover: ({ serialNumber } = {}) => delay(!serialNumber || serialNumber === 'SM-MOON-A102' ? [{
        deviceId: 'mock-moon-a102',
        serialNumber: 'SM-MOON-A102',
        name: 'SNOOZ',
        signal: '良好',
      }] : [], 420),
      bind: async (input) => {
        const source = typeof input === 'string' ? { serialNumber: input } : (input || {})
        const serialNumber = source.serialNumber || status.host.serialNumber
        status.bound = true
        status.provisioned = false
        status.host.online = false
        status.host.serialNumber = serialNumber
        return delay({ bound: true, serialNumber: status.host.serialNumber })
      },
      provisionWifi: async ({ ssid, password }) => {
        if (!ssid || !password) throw new Error('WIFI_CREDENTIALS_REQUIRED')
        demoStates.unprovisioned = false
        status.provisioned = true
        status.host.online = !demoStates.offline
        return delay({ provisioned: true, ssid }, 600)
      },
      unbind: async () => {
        status.bound = false
        status.provisioned = false
        status.host.online = false
        return delay({ bound: false })
      },
      getStatus: () => delay(statusSnapshot(status)),
      runCalibration: () => {
        const result = buildCalibration(status, data.calibrationGuidance)
        return delay(result.ready ? { ...result, calibrationToken: `mock-calibration:${result.serialNumber}` } : result, 600)
      },
      getTonightSettings: () => delay(settings),
      saveTonightSettings: async (next) => {
        if (!canControlDevice(status)) throw new Error('DEVICE_OFFLINE')
        settings = normalizeTonightSettings(next)
        return delay(settings)
      },
      getSoundState: () => delay(sound),
      updateSound: async (command) => {
        if (!canControlDevice(status)) throw new Error('DEVICE_OFFLINE')
        if (command.scene) {
          const scene = sound.scenes.find((item) => item.id === command.scene)
          if (scene) sound = { ...sound, scene: scene.id, sceneName: scene.name, trackName: scene.trackName }
        }
        if (typeof command.playing === 'boolean') sound.playing = command.playing
        if (command.volume !== undefined) sound.volume = clamp(command.volume, 0, 100)
        if ([15, 30, 60, 'all-night'].includes(command.timer)) sound.timer = command.timer
        return delay(sound)
      },
      getLightState: () => delay(light),
      updateLight: async (command) => {
        if (!canControlDevice(status)) throw new Error('DEVICE_OFFLINE')
        if (typeof command.enabled === 'boolean') light.enabled = command.enabled
        if (['bedtime-breathe', 'night-low'].includes(command.mode)) {
          light.mode = command.mode
          light.modeName = command.mode === 'bedtime-breathe' ? '睡前呼吸灯' : '低亮起夜'
        }
        if (command.brightness !== undefined) light.brightness = clamp(command.brightness, 5, 40)
        return delay(light)
      },
      setDemoState: async ({ kind, enabled }) => {
        if (kind === 'command-outcome') {
          const allowed = ['applied', 'readback-timeout', 'readback-mismatch']
          demoStates.commandOutcome = allowed.includes(enabled) ? enabled : 'applied'
          return delay(statusSnapshot(status))
        }
        const value = Boolean(enabled)
        if (kind === 'offline') {
          demoStates.offline = value
          status.host.online = !value && !demoStates.unprovisioned
        }
        if (kind === 'unprovisioned') {
          demoStates.unprovisioned = value
          status.provisioned = !value
          status.host.online = !value && !demoStates.offline
        }
        if (kind === 'pad-disconnected') { demoStates.padDisconnected = value; status.pad.connected = !value }
        if (kind === 'no-data') demoStates.noData = value
        if (kind === 'high-attention') demoStates.highAttention = value
        if (kind === 'sync-failed') {
          demoStates.syncFailed = value
          status.sync.status = value ? 'failed' : 'success'
          status.sync.lastSyncedAt = value ? '同步失败' : '今天 07:42'
        }
        if (kind === 'firmware-update') { demoStates.firmwareUpdate = value; status.host.firmwareUpdateAvailable = value }
        if (kind === 'model-update') { demoStates.modelUpdate = value; status.host.modelUpdateAvailable = value }
        return delay(statusSnapshot(status))
      },
      getDemoStates: () => delay(demoStates),
      applyTonightCandidate: async ({ candidateId, expectedConfigVersion } = {}) => {
        if (!canControlDevice(status)) throw new Error('DEVICE_OFFLINE')
        const candidate = buildTonightCandidate(settings, configVersion)
        if (candidate.candidateId !== candidateId) throw new Error('AI_CANDIDATE_NOT_FOUND')
        if (candidate.currentConfigVersion !== expectedConfigVersion) throw new Error('CONFIG_CONFLICT')
        const validation = validateGentleCandidate(settings, candidate.candidateSettings)
        if (!validation.valid) {
          settingsCommand = createRejectedCommand(candidate, validation.fieldErrors)
          return delay(settingsCommand)
        }
        commandSequence += 1
        settingsCommand = {
          commandId: `settings-command-${commandSequence}`,
          idempotencyKey: `mock-${candidate.candidateId}-${expectedConfigVersion}`,
          candidateId: candidate.candidateId,
          expectedConfigVersion,
          createdAt: '刚刚',
          expiresAt: candidate.expiresAt,
          status: 'pending',
          ackStatus: 'waiting',
          ackAt: null,
          errorCode: null,
          fieldErrors: [],
          readbackAt: null,
          readbackSettings: null,
          readbackConfigVersion: null,
          matchesCandidate: null,
          candidateSettings: clone(candidate.candidateSettings),
          pollCount: 0,
        }
        return delay(publicCommand(settingsCommand))
      },
      getActiveSettingsCommand: () => delay(settingsCommand ? publicCommand(settingsCommand) : null),
      getSettingsCommand: async (commandId) => {
        if (!settingsCommand || settingsCommand.commandId !== commandId) throw new Error('SETTINGS_COMMAND_NOT_FOUND')
        progressSettingsCommand()
        return delay(publicCommand(settingsCommand))
      },
      reconcileSettingsCommand: async (commandId) => {
        if (!settingsCommand || settingsCommand.commandId !== commandId) throw new Error('SETTINGS_COMMAND_NOT_FOUND')
        progressSettingsCommand()
        return delay(publicCommand(settingsCommand))
      },
    },
    reports: {
      getLatest: () => {
        if (demoStates.syncFailed) return delayReject(new Error('REPORT_SYNC_FAILED'))
        if (demoStates.noData) return delay(null)
        return delay({ ...data.latestReport, attentionLevel: demoStates.highAttention ? 'consult' : data.latestReport.attentionLevel })
      },
      getEvents: () => delay(demoStates.noData ? [] : data.events),
      getSevenNightTrend: () => delay(demoStates.noData ? [] : data.sevenNightTrend),
      submitFeedback: async (next) => {
        const nightId = requireNightId(next && next.nightId)
        const feedback = { nightId, ...normalizeFeedback(next) }
        feedbackByNight.set(nightId, feedback)
        return delay(feedback)
      },
      getFeedback: async (nightId) => delay(feedbackByNight.get(requireNightId(nightId)) || null),
    },
    ai: {
      getOverview: (scope = 'single-night') => {
        const kind = scope === 'seven-night' ? 'seven-night' : 'single-night'
        const interpretation = data.aiInterpretations.find((item) => item.kind === kind)
        return delay(interpretation)
      },
      getRecords: ({ kind } = {}) => delay(kind
        ? data.aiInterpretations.filter((item) => item.kind === kind)
        : data.aiInterpretations),
      getChatSessions: () => delay(chatSessions.map((session) => ({
        sessionId: session.sessionId,
        title: session.title,
        preview: session.messages.length ? session.messages[session.messages.length - 1].text : '',
        updatedAt: session.updatedAt,
      }))),
      getChatSession: (sessionId) => {
        const session = chatSessions.find((item) => item.sessionId === sessionId)
        return session ? delay(session) : delayReject(new Error('AI_CHAT_SESSION_NOT_FOUND'))
      },
      saveChatSession: async (next = {}) => {
        const session = {
          sessionId: next.sessionId || `ai-chat-${Date.now()}`,
          interpretationId: next.interpretationId,
          interpretationRevision: next.interpretationRevision,
          contextTitle: next.contextTitle,
          contextConclusion: next.contextConclusion,
          contextSummary: next.contextSummary,
          conversationSummary: next.conversationSummary || '',
          carriedMemory: next.carriedMemory || '',
          title: next.title || '新对话',
          messages: clone(next.messages || []),
          updatedAt: '刚刚',
        }
        chatSessions = [session, ...chatSessions.filter((item) => item.sessionId !== session.sessionId)].slice(0, 30)
        storeChatSessions(chatSessions)
        return delay(session)
      },
      getInterpretation: (interpretationId) => {
        const interpretation = findInterpretation(interpretationId)
        return interpretation ? delay(interpretation) : delayReject(new Error('AI_INTERPRETATION_NOT_FOUND'))
      },
      ask: ({ interpretationId, interpretationRevision, message } = {}) => {
        const interpretation = findInterpretation(interpretationId)
        if (!interpretation) return delayReject(new Error('AI_INTERPRETATION_NOT_FOUND'))
        if (interpretation.revision !== interpretationRevision) return delayReject(new Error('AI_CONTEXT_REVISION_MISMATCH'))
        if (!String(message || '').trim()) return delayReject(new Error('AI_MESSAGE_REQUIRED'))
        return delay(buildAiAnswer(interpretation, message))
      },
      getTonightCandidate: (interpretationId) => {
        const interpretation = findInterpretation(interpretationId)
        if (!interpretation) return delayReject(new Error('AI_INTERPRETATION_NOT_FOUND'))
        if (interpretation.kind !== 'single-night') return delayReject(new Error('AI_CANDIDATE_SINGLE_NIGHT_ONLY'))
        return delay(buildTonightCandidate(settings, configVersion, interpretationId))
      },
    },
    guardian: {
      getSnapshot: () => delay(guardianSnapshot),
      stopCurrentIntervention: ({ snapshotId, cycleId } = {}) => {
        if (guardianSnapshot.snapshotId !== snapshotId || guardianSnapshot.cycleId !== cycleId) {
          return delayReject(new Error('GUARDIAN_SNAPSHOT_STALE'))
        }
        if (!canStopIntervention(guardianSnapshot)) return delayReject(new Error('GUARDIAN_STOP_NOT_AVAILABLE'))
        guardianSnapshot = nextGuardianSnapshot('stopped', { stopResult: 'confirmed' })
        return delay(guardianSnapshot)
      },
      setDemoPhase: (phase) => {
        const allowed = ['observing', 'sensing', 'deciding', 'intervening', 'verifying', 'stopped', 'delayed']
        if (!allowed.includes(phase)) return delayReject(new Error('INVALID_GUARDIAN_PHASE'))
        const overrides = phase === 'delayed'
          ? { source: 'cloud-cache', freshness: 'stale', receivedAt: '2 分钟前' }
          : { source: 'ble', freshness: 'fresh', receivedAt: '刚刚' }
        guardianSnapshot = nextGuardianSnapshot(phase, overrides)
        return delay(guardianSnapshot)
      },
    },
  }

  function findInterpretation(interpretationId) {
    return data.aiInterpretations.find((item) => item.interpretationId === interpretationId)
  }

  function buildTonightCandidate(currentSettings, currentConfigVersion, interpretationId = data.aiTonightCandidate.interpretationId) {
    return {
      ...clone(data.aiTonightCandidate),
      interpretationId,
      currentSettings: clone(currentSettings),
      currentConfigVersion,
    }
  }

  function createRejectedCommand(candidate, fieldErrors) {
    commandSequence += 1
    return {
      commandId: `settings-command-${commandSequence}`,
      idempotencyKey: `mock-${candidate.candidateId}-${candidate.currentConfigVersion}`,
      candidateId: candidate.candidateId,
      expectedConfigVersion: candidate.currentConfigVersion,
      createdAt: '刚刚',
      expiresAt: candidate.expiresAt,
      status: 'rejected-boundary',
      ackStatus: 'rejected',
      ackAt: '刚刚',
      errorCode: 'REJECTED_BOUNDARY',
      fieldErrors: clone(fieldErrors),
      readbackAt: null,
      readbackSettings: null,
      readbackConfigVersion: null,
      matchesCandidate: false,
      candidateSettings: clone(candidate.candidateSettings),
      pollCount: 0,
    }
  }

  function progressSettingsCommand() {
    if (!settingsCommand || !['pending', 'readback-pending'].includes(settingsCommand.status)) return
    settingsCommand.pollCount += 1
    if (settingsCommand.status === 'pending') {
      settingsCommand.status = 'readback-pending'
      settingsCommand.ackStatus = 'accepted'
      settingsCommand.ackAt = '刚刚'
      return
    }

    if (demoStates.commandOutcome === 'readback-timeout') {
      settingsCommand.status = 'readback-timeout'
      settingsCommand.errorCode = 'READBACK_TIMEOUT'
      settingsCommand.matchesCandidate = null
      return
    }
    if (demoStates.commandOutcome === 'readback-mismatch') {
      settingsCommand.status = 'readback-mismatch'
      settingsCommand.errorCode = 'READBACK_MISMATCH'
      settingsCommand.readbackAt = '刚刚'
      settingsCommand.readbackSettings = clone(settings)
      settingsCommand.readbackConfigVersion = configVersion
      settingsCommand.matchesCandidate = false
      return
    }

    settings = clone(settingsCommand.candidateSettings)
    configVersion += 1
    guardianSnapshot.configVersion = configVersion
    guardianSnapshot.interventionLimit = settings.nightlyInterventionLimit
    settingsCommand.status = 'applied'
    settingsCommand.readbackAt = '刚刚'
    settingsCommand.readbackSettings = clone(settings)
    settingsCommand.readbackConfigVersion = configVersion
    settingsCommand.matchesCandidate = true
  }

  function nextGuardianSnapshot(guardianState, overrides = {}) {
    const nextSequence = guardianSnapshot.sequence + 1
    const active = ['intervening', 'verifying'].includes(guardianState)
    return {
      ...guardianSnapshot,
      snapshotId: `guardian-${nextSequence}`,
      sequence: nextSequence,
      guardianState,
      cycleId: active ? `cycle-${nextSequence}` : null,
      enteredAt: '刚刚',
      activeIntervention: active ? { level: 2, startedAt: '刚刚', elapsedSeconds: 12 } : null,
      reasonCodes: guardianState === 'delayed' ? ['SNAPSHOT_DELAYED'] : [`LOCAL_${guardianState.toUpperCase()}`],
      stopResult: null,
      ...overrides,
    }
  }
}

function publicCommand(command) {
  const copy = clone(command)
  delete copy.pollCount
  delete copy.candidateSettings
  return copy
}

function buildAiAnswer(interpretation, message) {
  const answerKind = classifyAiQuestion(message)
  const base = {
    messageId: `answer-${Date.now()}`,
    role: 'assistant',
    status: 'complete',
    answerKind,
    safetyClass: answerKind,
    evidenceRefs: interpretation.evidence.map((item) => item.id),
    actions: [],
  }
  if (answerKind === 'urgent') {
    return {
      ...base,
      text: '这类情况不能等待设备判断。请立即寻求身边帮助，并联系当地急救服务。',
      sections: {
        canExplain: '当前描述可能需要立即处理。',
        cannotDetermine: '好眠不能判断原因或严重程度。',
        nextStep: '立即联系当地急救服务。',
      },
      actions: ['emergency-help'],
    }
  }
  if (answerKind === 'medication') {
    return {
      ...base,
      text: '我不能根据设备记录建议用药、停药或调整剂量。',
      sections: {
        canExplain: '可以整理近期趋势与提醒响应。',
        cannotDetermine: '不能据此判断药物选择或剂量。',
        nextStep: '把记录摘要带给专业人员沟通。',
      },
      actions: ['doctor-summary'],
    }
  }
  if (answerKind === 'diagnosis') {
    return {
      ...base,
      text: '这些记录只能用于趋势观察，不能诊断疾病。',
      sections: {
        canExplain: interpretation.summary,
        cannotDetermine: '不能据此确认 OSA 或其他疾病。',
        nextStep: '如持续担心，请携带趋势记录咨询专业人员。',
      },
      actions: ['doctor-summary'],
    }
  }
  return {
    ...base,
    text: `${interpretation.summary} ${interpretation.nextStep}`,
    sections: {
      canExplain: interpretation.summary,
      cannotDetermine: '不能判断疾病或替代医疗检查。',
      nextStep: interpretation.nextStep,
    },
    actions: ['tonight-plan', 'doctor-summary'],
  }
}

function requireNightId(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('INVALID_NIGHT_ID')
  return value.trim()
}

module.exports = { createMockServices }
