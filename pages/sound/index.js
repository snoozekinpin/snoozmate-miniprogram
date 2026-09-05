const services = require('../../services/index')
const { runServiceErrorAction, toUserError } = require('../../domain/service-error')

const previewTracks = {
  sleep: '/audio/sleep.mp3',
  healing: '/audio/healing.mp3',
  work: '/audio/work.mp3',
  reading: '/audio/reading.mp3',
}

Page({
  data: { sound: null, volumeDraft: 0, status: null, controlAvailable: false, controlError: null, loading: true, loadError: null, actionError: null, phase: 'loading', syncing: false, previewMode: true, previewPlaying: false, previewError: '', timers: [15, 30, 60, 'all-night'] },
  onLoad() { return this.load() },
  onUnload() {
    if (this._previewFadeTimer) clearTimeout(this._previewFadeTimer)
    if (this._previewAudio) this._previewAudio.destroy()
    this._previewAudio = null
  },
  onHide() {
    if (this._previewAudio && this.data.previewPlaying) this._previewAudio.pause()
  },
  async load() {
    this.setData({ loading: true, loadError: null, actionError: null, phase: 'loading' })
    try {
      const [sound, status] = await Promise.all([services.device.getSoundState(), services.device.getStatus()])
      const controlAvailable = Boolean(status && status.controlAvailable)
      const controlError = controlAvailable ? null : toUserError({ code: status && status.provisioned ? 'DEVICE_OFFLINE' : 'NOT_PROVISIONED' }, '疗愈声音')
      this.setData({ sound, volumeDraft: sound ? sound.volume : 0, status, controlAvailable, controlError, phase: sound ? 'data' : 'empty' })
      if (sound) this.preparePreviewSource(sound)
    } catch (error) {
      this.setData({ sound: null, loadError: toUserError(error, '疗愈声音'), phase: 'error' })
    } finally {
      this.setData({ loading: false })
    }
  },
  retry() { return this.load() },
  handleServiceAction(event) { return runServiceErrorAction(event.detail.action, () => this.retry(), wx) },
  handleActionError(event) { return runServiceErrorAction(event.detail.action, () => this.retryAction(), wx) },
  async send(command) {
    if (this.data.syncing || !this.data.controlAvailable) return
    const previousSound = this.data.sound
    const optimisticSound = applySoundCommand(previousSound, command)
    this._retryAction = () => this.send(command)
    this.setData({ syncing: true, actionError: null, sound: optimisticSound })
    this.preparePreviewSource(optimisticSound)
    try {
      const sound = await services.device.updateSound(command)
      this.setData({ sound, volumeDraft: sound.volume })
      this.preparePreviewSource(sound)
      this._retryAction = null
    }
    catch (error) {
      const userError = toUserError(error, '疗愈声音')
      this.setData({ sound: previousSound, volumeDraft: previousSound.volume, actionError: userError })
      this.preparePreviewSource(previousSound)
      wx.showToast({ title: userError.title, icon: 'none' })
    }
    finally { this.setData({ syncing: false }) }
  },
  selectScene(event) {
    const command = { scene: event.currentTarget.dataset.scene }
    if (this.data.controlAvailable) return this.send(command)
    const sound = applySoundCommand(this.data.sound, command)
    this.setData({ sound })
    this.preparePreviewSource(sound)
  },
  togglePlayback() { this.togglePreview() },
  previewVolume(event) {
    const volumeDraft = event.detail.value
    this.setData({ volumeDraft })
    if (this._previewAudio) {
      this._previewAudio.volume = Math.max(0, Math.min(1, volumeDraft / 100))
    }
  },
  setVolume(event) { return this.send({ volume: event.detail.value }) },
  setTimer(event) { this.send({ timer: event.currentTarget.dataset.timer }) },
  preparePreviewSource(nextSound) {
    if (!nextSound || typeof wx.createInnerAudioContext !== 'function') return
    const audio = this.ensurePreviewAudio()
    const source = previewTracks[nextSound.scene] || previewTracks.sleep
    const volume = this.data.volumeDraft == null ? nextSound.volume : this.data.volumeDraft
    audio.volume = Math.max(0, Math.min(1, Number(volume) / 100))
    if (audio.src !== source) {
      const resume = this.data.previewPlaying
      audio.stop()
      this._previewResumeOnCanplay = resume
      audio.src = source
      if (resume) this.setData({ previewPlaying: false })
    }
  },
  togglePreview() {
    if (!this.data.sound) return
    const audio = this.ensurePreviewAudio()
    this._previewUserStarted = true
    this.setData({ previewError: '' })
    if (this.data.previewPlaying) {
      audio.pause()
      return
    }
    const source = previewTracks[this.data.sound.scene] || previewTracks.sleep
    audio.volume = Math.max(0, Math.min(1, Number(this.data.volumeDraft) / 100))
    if (audio.src !== source) {
      this._previewResumeOnCanplay = true
      audio.src = source
    } else {
      audio.play()
    }
  },
  ensurePreviewAudio() {
    if (this._previewAudio) return this._previewAudio
    const audio = wx.createInnerAudioContext()
    audio.autoplay = false
    audio.loop = true
    audio.obeyMuteSwitch = false
    // Bind once per context so source switches do not accumulate callbacks.
    if (typeof audio.onCanplay === 'function') audio.onCanplay(() => {
      if (this._previewResumeOnCanplay && this._previewUserStarted) {
        this._previewResumeOnCanplay = false
        audio.play()
      }
    })
    if (typeof audio.onPlay === 'function') audio.onPlay(() => this.setData({ previewPlaying: true, previewError: '' }))
    if (typeof audio.onPause === 'function') audio.onPause(() => this.setData({ previewPlaying: false }))
    if (typeof audio.onStop === 'function') audio.onStop(() => this.setData({ previewPlaying: false }))
    if (typeof audio.onEnded === 'function') audio.onEnded(() => this.setData({ previewPlaying: false }))
    if (typeof audio.onError === 'function') audio.onError(() => {
      this._previewResumeOnCanplay = false
      this.setData({ previewPlaying: false, previewError: '试听音频加载失败，请检查手机媒体权限后重试。' })
    })
    this._previewAudio = audio
    return audio
  },
  retryAction() {
    if (!this.data.actionError || !this.data.actionError.retryable || !this._retryAction) return
    return this._retryAction()
  },
})

function applySoundCommand(current, command) {
  if (!current) return current
  let next = { ...current }
  if (command.scene) {
    const scene = current.scenes.find((item) => item.id === command.scene)
    if (scene) next = { ...next, scene: scene.id, sceneName: scene.name, trackName: scene.trackName }
  }
  if (typeof command.playing === 'boolean') next.playing = command.playing
  if (command.volume !== undefined) next.volume = Math.max(0, Math.min(100, command.volume))
  if ([15, 30, 60, 'all-night'].includes(command.timer)) next.timer = command.timer
  return next
}
