Component({
  properties: {
    tone: { type: String, value: 'warning' },
    title: { type: String, value: '' },
    detail: { type: String, value: '' },
    retryable: { type: Boolean, value: false },
    action: { type: String, value: 'retry' },
    retryText: { type: String, value: '重试' },
  },
  methods: {
    retry() { this.triggerEvent('retry', { action: 'retry' }) },
    act() { this.triggerEvent('action', { action: this.data.action }) },
  },
})
