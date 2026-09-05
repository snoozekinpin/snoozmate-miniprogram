const services = require('../../services/index')
const { toUserError } = require('../../domain/service-error')

const SOFT_TURN_LIMIT = 12
const HARD_TURN_LIMIT = 20
const RECENT_MESSAGE_LIMIT = 12

Page({
  data: {
    mode: 'conversation',
    sessionId: '',
    sessions: [],
    historyLoading: false,
    interpretationId: '',
    interpretationRevision: 0,
    contextTitle: '',
    contextConclusion: '',
    contextSummary: '',
    inputText: '',
    messages: [],
    visibleMessages: [],
    collapsedMessageCount: 0,
    olderMessagesExpanded: false,
    conversationSummary: '',
    carriedMemory: '',
    contextLimitReached: false,
    scrollTarget: '',
    quickQuestions: ['为什么不建议提高振动强度？', '这能说明我有睡眠呼吸暂停吗？'],
    loading: true,
    sending: false,
    error: null,
  },

  onLoad(options) { this.loadContext(decodeURIComponent(options.interpretationId || '')) },

  async loadContext(interpretationId) {
    this.setData({ loading: true, error: null, messages: [], visibleMessages: [], collapsedMessageCount: 0, conversationSummary: '', carriedMemory: '', contextLimitReached: false })
    try {
      const interpretation = await services.ai.getInterpretation(interpretationId)
      this.setData({
        interpretationId: interpretation.interpretationId,
        interpretationRevision: interpretation.revision,
        contextTitle: interpretation.periodLabel
          ? `${interpretation.periodLabel}${interpretation.kind === 'seven-night' ? ' 7 晚趋势' : '单晚解读'}`
          : (interpretation.kind === 'seven-night' ? '近 7 晚解读' : '昨夜单晚解读'),
        contextConclusion: interpretation.conclusion,
        contextSummary: interpretation.summary,
      })
    } catch (error) {
      this.setData({ error: toUserError(error, 'AI 追问') })
    } finally {
      this.setData({ loading: false })
    }
  },

  onInput(event) { this.setData({ inputText: event.detail.value }) },
  resetConversation() { this.startNewConversation() },
  useQuickQuestion(event) { return this.sendMessage(event.currentTarget.dataset.question) },

  async openHistory() {
    if (this.data.historyLoading) return
    this.setData({ mode: 'history', historyLoading: true, error: null })
    if (typeof wx.setNavigationBarTitle === 'function') wx.setNavigationBarTitle({ title: '聊天记录' })
    try {
      const sessions = await services.ai.getChatSessions()
      this.setData({ sessions })
    } catch (error) {
      this.setData({ error: toUserError(error, '聊天记录') })
    } finally {
      this.setData({ historyLoading: false })
    }
  },

  closeHistory() {
    this.setData({ mode: 'conversation', error: null })
    if (typeof wx.setNavigationBarTitle === 'function') wx.setNavigationBarTitle({ title: '问好眠 AI' })
  },

  startNewConversation() {
    this.beginNewConversation(false)
  },

  continueInNewConversation() {
    this.beginNewConversation(true)
  },

  beginNewConversation(preserveDraft) {
    const carriedMemory = this.data.conversationSummary || this.data.carriedMemory
    this.setData({
      mode: 'conversation',
      sessionId: '',
      inputText: preserveDraft ? this.data.inputText : '',
      messages: [],
      visibleMessages: [],
      collapsedMessageCount: 0,
      olderMessagesExpanded: false,
      conversationSummary: '',
      carriedMemory,
      contextLimitReached: false,
      scrollTarget: '',
      error: null,
    })
    if (typeof wx.setNavigationBarTitle === 'function') wx.setNavigationBarTitle({ title: '问好眠 AI' })
  },

  async openSession(event) {
    const sessionId = event.currentTarget.dataset.id
    if (!sessionId) return
    this.setData({ historyLoading: true, error: null })
    try {
      const session = await services.ai.getChatSession(sessionId)
      if (!session) throw new Error('AI_CHAT_SESSION_NOT_FOUND')
      this.setData({
        mode: 'conversation',
        sessionId: session.sessionId,
        interpretationId: session.interpretationId,
        interpretationRevision: session.interpretationRevision,
        contextTitle: session.contextTitle,
        contextConclusion: session.contextConclusion || '',
        contextSummary: session.contextSummary || '',
        conversationSummary: session.conversationSummary || '',
        carriedMemory: session.carriedMemory || '',
        messages: session.messages || [],
      })
      this.refreshConversationState()
      if (typeof wx.setNavigationBarTitle === 'function') wx.setNavigationBarTitle({ title: '问好眠 AI' })
    } catch (error) {
      this.setData({ error: toUserError(error, '聊天记录') })
    } finally {
      this.setData({ historyLoading: false })
    }
  },

  async sendMessage(input) {
    if (this.data.sending) return
    this.refreshConversationState()
    if (this.data.contextLimitReached) return
    const message = typeof input === 'string' ? input : this.data.inputText
    const text = String(message || '').trim()
    if (!text || !this.data.interpretationId) return
    const userMessage = { messageId: `user-${Date.now()}`, role: 'user', text, status: 'complete' }
    const pendingMessages = [...this.data.messages, userMessage]
    this.setData({ messages: pendingMessages, inputText: '', sending: true, error: null })
    this.refreshConversationState()
    try {
      const answer = await services.ai.ask({
        interpretationId: this.data.interpretationId,
        interpretationRevision: this.data.interpretationRevision,
        message: text,
        conversationSummary: this.data.carriedMemory || this.data.conversationSummary,
        recentMessages: pendingMessages.slice(-RECENT_MESSAGE_LIMIT),
      })
      const messages = [...this.data.messages, answer]
      this.setData({ messages })
      this.refreshConversationState()
      const session = await services.ai.saveChatSession({
        sessionId: this.data.sessionId,
        interpretationId: this.data.interpretationId,
        interpretationRevision: this.data.interpretationRevision,
        contextTitle: this.data.contextTitle,
        contextConclusion: this.data.contextConclusion,
        contextSummary: this.data.contextSummary,
        conversationSummary: this.data.conversationSummary,
        carriedMemory: this.data.carriedMemory,
        title: firstUserMessage(messages),
        messages,
      })
      this.setData({ sessionId: session.sessionId })
    } catch (error) {
      this.setData({ error: toUserError(error, 'AI 回答') })
    } finally {
      this.setData({ sending: false })
    }
  },

  openPlan() {
    if (this.data.interpretationId) wx.navigateTo({ url: `/pages/ai-plan/index?interpretationId=${this.data.interpretationId}` })
  },

  refreshConversationState() {
    const messages = this.data.messages || []
    const userTurns = messages.filter((item) => item.role === 'user').length
    const shouldCollapse = userTurns > SOFT_TURN_LIMIT
    const olderMessagesExpanded = Boolean(this.data.olderMessagesExpanded)
    const collapsedMessageCount = shouldCollapse ? Math.max(0, messages.length - RECENT_MESSAGE_LIMIT) : 0
    const visibleMessages = shouldCollapse && !olderMessagesExpanded ? messages.slice(-RECENT_MESSAGE_LIMIT) : messages
    const conversationSummary = shouldCollapse
      ? summarizeConversation(this.data, messages)
      : this.data.conversationSummary
    const lastMessage = visibleMessages.length ? visibleMessages[visibleMessages.length - 1] : null
    this.setData({
      visibleMessages,
      collapsedMessageCount,
      conversationSummary,
      contextLimitReached: userTurns >= HARD_TURN_LIMIT,
      scrollTarget: lastMessage ? lastMessage.messageId : '',
    })
  },

  toggleOlderMessages() {
    this.setData({ olderMessagesExpanded: !this.data.olderMessagesExpanded })
    this.refreshConversationState()
  },
})

function firstUserMessage(messages) {
  const first = messages.find((item) => item.role === 'user')
  return first ? first.text.slice(0, 28) : '新对话'
}

function summarizeConversation(context, messages) {
  const recentQuestions = messages
    .filter((item) => item.role === 'user')
    .slice(-3)
    .map((item) => item.text)
    .join('；')
  return [
    context.contextTitle,
    context.contextConclusion,
    context.contextSummary,
    recentQuestions ? `最近关注：${recentQuestions}` : '',
  ].filter(Boolean).join('｜')
}
