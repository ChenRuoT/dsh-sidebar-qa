/**
 * The `dsh-sidebar-qa:ask` tab: an embedded conversation view for the current
 * session's follow-up thread. A follow-up is a real workspace session, but the
 * Q&A happens IN the panel — the transcript streams here and a composer at the
 * bottom continues the conversation, without ever jumping to the child
 * session's main window. Selecting text + 提问 starts a new (nested) follow-up
 * from whatever session is currently open.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context, SidebarqaTabComponentProps } from '../context-types.ts'
import { transcriptOf, type TranscriptMessage } from './answer.ts'
import { parseUserMessage } from './injection.ts'
import { askFollowUp, sendFollowUp } from './orchestrate.ts'
import type { SidebarqaStore } from './store.ts'
import css from './ask-panel.module.css'

interface AskPanelProps extends SidebarqaTabComponentProps {
  store: SidebarqaStore
}

/** Reference-stable code-block copy labels (MarkdownText clears its streaming cache on identity change). */
const CODE_LABELS = { copyLabel: '复制', copiedLabel: '已复制' }

type Phase = 'idle' | 'asking' | 'answering' | 'error'

export function AskPanel(props: AskPanelProps) {
  const { ctx, scope, visible, store } = props
  const sessionId = scope.sessionId

  const snapshot = useSyncExternalStore(
    (cb: () => void) => store.subscribe(cb),
    () => store.getSnapshot(),
  )
  const pendingQuote = snapshot.pendingBySession[sessionId] ?? null
  const children = snapshot.parentToChildren[sessionId] ?? []

  const sessionList = useSyncExternalStore(
    (cb: () => void) => ctx.sessions.list.subscribe(cb),
    () => ctx.sessions.list.getSnapshot(),
  )

  const [activeChildId, setActiveChildId] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [messages, setMessages] = useState<TranscriptMessage[]>([])
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const activeRunning = activeChildId !== null && sessionList.byId[activeChildId]?.running === true

  // On session change: default to the latest follow-up of that session.
  useEffect(() => {
    const list = store.childrenOf(sessionId)
    setActiveChildId(list.length > 0 ? (list[list.length - 1] ?? null) : null)
    setQuestion('')
    setPhase('idle')
    setError(null)
    setMessages([])
  }, [sessionId, store])

  // A new pending quote switches the panel back to "start a new follow-up".
  useEffect(() => {
    if (pendingQuote !== null) {
      setActiveChildId(null)
      setMessages([])
      setPhase('idle')
      setError(null)
    }
  }, [pendingQuote !== null])

  // Pre-focus the composer when the tab becomes visible.
  useEffect(() => {
    if (visible) inputRef.current?.focus()
  }, [visible])

  // Stream the active follow-up's transcript (poll the history tail).
  useEffect(() => {
    if (activeChildId === null || !visible) return
    let cancelled = false
    const poll = async (): Promise<void> => {
      try {
        const response = await ctx.connection.api.sessions.history({ sessionId: activeChildId, maxMessages: 60 })
        if (cancelled || !response.result.ok) return
        setMessages(transcriptOf(response.result.value.events))
      } catch {
        // keep the last known transcript; retry on the next tick
      }
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, 1200)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [activeChildId, visible, ctx])

  // When the active follow-up finishes, leave the answering phase.
  useEffect(() => {
    if (!activeRunning) setPhase(prev => (prev === 'answering' ? 'idle' : prev))
  }, [activeRunning])

  const submit = async (): Promise<void> => {
    const q = question.trim()
    if (q === '' || phase === 'asking') return
    setPhase('asking')
    setError(null)
    try {
      if (activeChildId === null) {
        const result = await askFollowUp(
          ctx,
          store,
          { parentSessionId: sessionId, quote: pendingQuote ?? { text: '' }, question: q },
          (next) => {
            if (next === 'answering') setPhase('answering')
          },
        )
        setActiveChildId(result.sideSessionId)
        store.setPendingQuote(sessionId, null)
        setPhase('answering')
      } else {
        await sendFollowUp(ctx, activeChildId, q)
        setPhase('answering')
      }
      setQuestion('')
    } catch (err) {
      setPhase('error')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const busy = phase === 'asking'
  const mode = pendingQuote !== null ? 'start' : activeChildId !== null ? 'conversation' : 'empty'

  return (
    <div className={css.root}>
      {children.length > 0 && (
        <div className={css.switcher}>
          {children.map((id) => (
            <button
              key={id}
              type="button"
              className={activeChildId === id ? `${css.switcherItem} ${css.switcherActive}` : css.switcherItem}
              title={titleOf(ctx, id)}
              onClick={() => { setActiveChildId(id); setPhase('idle'); setError(null) }}
            >
              {titleOf(ctx, id)}
            </button>
          ))}
          <button
            type="button"
            className={css.newAsk}
            onClick={() => { setActiveChildId(null); setMessages([]); setPhase('idle'); setError(null) }}
          >
            新追问
          </button>
        </div>
      )}

      <div className={css.body}>
        {mode === 'conversation' && (
          <Transcript messages={messages} running={activeRunning} />
        )}
        {mode === 'start' && (
          <div className={css.startHint}>
            {pendingQuote !== null && pendingQuote.text !== ''
              ? (
                <div className={css.quoteChip}>
                  <div className={css.quoteChipHead}>引文</div>
                  <div className={css.quoteChipText}>{pendingQuote.text}</div>
                </div>
              )
              : <div className={css.emptyHint}>未选择文本，可直接提问（仅不带引文）。</div>}
          </div>
        )}
        {mode === 'empty' && (
          <div className={css.emptyHint}>划选对话文本后点击「提问」，或直接输入问题。</div>
        )}
      </div>

      <div className={css.composer}>
        <textarea
          ref={inputRef}
          className={css.input}
          placeholder="继续追问…（Enter 发送，Shift+Enter 换行）"
          value={question}
          onChange={(event) => { setQuestion(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void submit()
            }
          }}
        />
        <button
          type="button"
          className={css.send}
          disabled={question.trim() === '' || busy}
          onClick={() => { void submit() }}
        >
          {phase === 'asking' ? '主对话上下文整理中…' : phase === 'answering' ? '回答中…' : '发送'}
        </button>
      </div>

      {phase === 'error' && error !== null && <div className={css.error}>{error}</div>}
    </div>
  )
}

/** The streaming transcript (user right, assistant left; assistant is plain markdown). */
function Transcript({ messages, running }: { messages: readonly TranscriptMessage[]; running: boolean }) {
  if (messages.length === 0) {
    return <div className={css.emptyHint}>生成中…</div>
  }
  const lastIndex = messages.length - 1
  return (
    <div className={css.transcript}>
      {messages.map((message, index) => {
        const streaming = running && index === lastIndex && message.role === 'assistant'
        return message.role === 'user'
          ? <UserRow key={index} text={message.text} />
          : <AssistantRow key={index} text={message.text} streaming={streaming} />
      })}
    </div>
  )
}

/** One assistant message: raw markdown, no card (mirrors the main conversation). */
function AssistantRow({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <div className={css.assistantRow}>
      <div className={css.assistantMarkdown}>
        <MarkdownText text={text} streaming={streaming} codeLabels={CODE_LABELS} />
      </div>
    </div>
  )
}

/** One user message: strip the summary, render the quote as a blockquote, then the question. */
function UserRow({ text }: { text: string }) {
  const { quote, question } = parseUserMessage(text)
  return (
    <div className={css.userRow}>
      <div className={css.userContent}>
        {quote !== null && quote !== '' && (
          <blockquote className={css.quoteBlock}>{quote}</blockquote>
        )}
        <div className={css.questionText}>{question}</div>
      </div>
    </div>
  )
}

/** Resolve a session's display title (fallback to the id). */
function titleOf(ctx: Context, id: string): string {
  try {
    const summary = ctx.sessions.list.getSnapshot().byId[id]
    if (summary?.displayTitle !== undefined && summary.displayTitle !== '') return summary.displayTitle
    if (summary?.title !== undefined && summary.title !== '') return summary.title
  } catch {
    // fall through to the id
  }
  return id
}
