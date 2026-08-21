/**
 * The `dsh-sidebar-qa:ask` tab: an embedded conversation view for the current
 * session's follow-up thread. A follow-up is a real workspace session, but the
 * Q&A happens IN the panel — the transcript streams here and a composer at the
 * bottom continues the conversation, without ever jumping to the child
 * session's main window. Selecting text + 提问 starts a new (nested) follow-up
 * from whatever session is currently open.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import { MarkdownText, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context, SidebarqaHistoryEntry, SidebarqaModelSelection, SidebarqaTabComponentProps } from '../context-types.ts'
import type { SidebarqaHistoryStrategy } from '../config.ts'
import { lastEndSeedIndex, transcriptRowsOf, type TranscriptRow } from './answer.ts'
import { parseUserMessage } from './injection.ts'
import { askFollowUp, sendFollowUp, titleSideSessionOnce } from './orchestrate.ts'
import { sidebarqaApi, type SidebarqaConfigView } from './api.ts'
import { resolveModelSeat } from './model-seat.ts'
import { t } from './locales.ts'
import { useLocaleRevision } from './use-locale.ts'
import { StrategySelect } from './StrategySelect.tsx'
import { ModelSelect } from './ModelSelect.tsx'
import { ContextMeter } from './ContextMeter.tsx'
import { resolveMetaQuote, consumeMetaQuote, resolveAskMode } from './meta-quote.ts'
import { expandPanelIfCollapsed, type SidebarqaSidebarStore } from './ensure-panel.ts'
import { onTabActivated } from './tab-activation.ts'
import type { SidebarqaStore } from './store.ts'
import css from './ask-panel.module.css'

interface AskPanelProps extends Omit<SidebarqaTabComponentProps, 'store'> {
  store: SidebarqaStore
  /** The better-sidebar state store (self-healing panel expansion, issue #6). */
  bsStore?: SidebarqaSidebarStore
}

type Phase = 'idle' | 'asking' | 'answering' | 'error'

export function AskPanel(props: AskPanelProps) {
  const { ctx, scope, visible, store, bsStore } = props
  // Follow the DSH language: t() reads at call time, so this single root
  // re-render re-localizes the whole subtree (keep it free of React.memo).
  const localeRevision = useLocaleRevision()
  const sessionId = scope.sessionId
  const tabId = props.tab.id

  // An OPEN tab's title is a plain string persisted in better-sidebar's
  // per-session state, so the registerTab title thunk (live in the + menu)
  // never re-runs for it. Re-push it whenever the language changes; every
  // other session's tab heals the moment the user visits it. updateTab
  // short-circuits an unchanged title, so the mount-time call is free.
  useEffect(() => {
    ctx.betterSidebar.updateTab(tabId, { title: t('askTabTitle') })
  }, [ctx, tabId, localeRevision])

  // Self-healing panel expansion (issue #6): better-sidebar only auto-expands
  // a collapsed panel for content opens, so the 追问 tab opened by a type-only
  // openTab used to land invisible. Two triggers:
  // - MOUNT: a freshly created tab landed in a possibly collapsed panel (the
  //   tab component is rendered even while the panel is collapsed — `visible`
  //   only pauses live views);
  // - RE-ACTIVATION: the user collapsed the panel, then clicked 提问 again —
  //   openTab merely re-focuses the existing tab (no remount), so only the
  //   activation signal (fired even for an already-active tab) reaches us.
  // A plain manual collapse never fires onActivate, so a deliberate layout is
  // never fought.
  useEffect(() => {
    if (bsStore === undefined) return
    expandPanelIfCollapsed(bsStore)
    return onTabActivated(() => expandPanelIfCollapsed(bsStore))
  }, [bsStore])

  const snapshot = useSyncExternalStore(
    (cb: () => void) => store.subscribe(cb),
    () => store.getSnapshot(),
  )
  // Cross-plugin seam: a quote handed over through `openTab({ meta: { quote } })`
  // (e.g. dsh-sidebar-preview-select's preview selection) takes precedence over
  // the store's pending quote; the store path stays the popover's channel.
  const metaQuote = resolveMetaQuote(props.tab.meta)
  const pendingQuote = metaQuote ?? snapshot.pendingBySession[sessionId] ?? null
  const children = snapshot.parentToChildren[sessionId] ?? []

  const sessionList = useSyncExternalStore(
    (cb: () => void) => ctx.sessions.list.subscribe(cb),
    () => ctx.sessions.list.getSnapshot(),
  )

  const [activeChildId, setActiveChildId] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [strategy, setStrategy] = useState<SidebarqaHistoryStrategy>('compressed')
  const [strategyNote, setStrategyNote] = useState<string | null>(null)
  // Model picked in the panel for the NEXT ask (new-ask mode only): applied to
  // compressed/trim children; inherit children keep the parent's model anyway.
  const [pendingModel, setPendingModel] = useState<SidebarqaModelSelection | null>(null)
  // The resolved plugin config; null while it loads (the seat then falls back
  // to the read session's own model rather than a half-empty chip).
  const [config, setConfig] = useState<SidebarqaConfigView | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // Identity-stable per locale — MarkdownText caches its component table on
  // this object and discards the streaming render cache when it changes, so
  // it must NOT be rebuilt on every render (it used to be a module const).
  const codeLabels = useMemo(
    () => ({ copyLabel: t('commonCopy'), copiedLabel: t('commonCopied') }),
    [localeRevision],
  )

  const activeRunning = activeChildId !== null && sessionList.byId[activeChildId]?.running === true
  // The context meter binds to the session the ask is about: the active side
  // session when continuing, the parent when starting a new ask (the future
  // side session does not exist yet — and the parent's occupancy is exactly
  // what tells the user whether 全量继承 or 裁切 is the right call).
  const toolSessionId = activeChildId ?? sessionId
  // The model seat needs more than an id: a new ask must NOT write the asked
  // session's model (issue #10), so the binding also says how a pick lands.
  const seat = useMemo(
    () => resolveModelSeat({ activeChildId, parentSessionId: sessionId, strategy, pendingModel, config }),
    [activeChildId, sessionId, strategy, pendingModel, config],
  )

  // ── Fork-seed anchored transcript ─────────────────────────────────────────
  // A fork (inherit) child's log leads with the parent's full history plus a
  // `session/end-seed` marker. The panel renders everything, but anchors the
  // initial view on the child's OWN first message (quote + question) and
  // loads the inherited history upward on scroll, like the main conversation.
  const [loadedEvents, setLoadedEvents] = useState<SidebarqaHistoryEntry[]>([])
  const [anchorSeq, setAnchorSeq] = useState<number | null>(null)
  const [hasOlder, setHasOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const seededRef = useRef(false)
  const anchoredRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const anchorRowRef = useRef<HTMLDivElement>(null)

  // The transcript rows derive from the loaded events (the poll and the
  // upward paging both append to `loadedEvents`). Declared before the anchor
  // effect so the effect can retry anchoring once the own first message lands.
  const rows = useMemo(() => transcriptRowsOf(loadedEvents), [loadedEvents])

  // On session change: default to the latest follow-up of that session.
  useEffect(() => {
    const list = store.childrenOf(sessionId)
    setActiveChildId(list.length > 0 ? (list[list.length - 1] ?? null) : null)
    setQuestion('')
    setPhase('idle')
    setError(null)
    setStrategyNote(null)
    setPendingModel(null)
  }, [sessionId, store])

  // Reset the anchored transcript when the followed session changes.
  useEffect(() => {
    seededRef.current = false
    anchoredRef.current = false
    setLoadedEvents([])
    setAnchorSeq(null)
    setHasOlder(false)
    setLoadingOlder(false)
    if (scrollRef.current !== null) scrollRef.current.scrollTop = 0
  }, [activeChildId])

  // Seed the per-ask strategy selector — and the model seat's drafted default —
  // from the configured values. One request feeds both.
  useEffect(() => {
    let cancelled = false
    void sidebarqaApi.config().then((view) => {
      if (cancelled) return
      setStrategy(view.historyStrategy ?? 'compressed')
      setConfig(view)
    }).catch(() => { /* keep the built-in defaults; the seat falls back too */ })
    return () => { cancelled = true }
  }, [])

  // A new pending quote switches the panel back to "start a new follow-up".
  useEffect(() => {
    if (pendingQuote !== null) {
      setActiveChildId(null)
      setPhase('idle')
      setError(null)
    }
  }, [pendingQuote !== null])

  // Pre-focus the composer when the tab becomes visible.
  useEffect(() => {
    if (visible) inputRef.current?.focus()
  }, [visible])

  // Stream the active follow-up's transcript (poll the history tail). The
  // first page anchors the fork-seed boundary; later pages append only the
  // events newer than what is already loaded, so an upward-loaded inherited
  // history is never dropped by the poll.
  useEffect(() => {
    if (activeChildId === null || !visible) return
    let cancelled = false
    const poll = async (): Promise<void> => {
      try {
        const response = await ctx.connection.api.sessions.history({ sessionId: activeChildId, maxMessages: 60 })
        if (cancelled || !response.result.ok) return
        const events = response.result.value.events
        if (!seededRef.current) {
          seededRef.current = true
          const seedIndex = lastEndSeedIndex(events)
          const anchor = seedIndex >= 0 ? events[seedIndex]?.event.seq ?? null : null
          setAnchorSeq(anchor)
          setHasOlder(seedIndex >= 0 || response.result.value.hasMore)
          setLoadedEvents(events)
          // Right after an inherit ask, the prompt's `user/message` has not hit
          // the log yet (prompt only queues into the agent inbox). The own
          // message is therefore missing from this page — re-poll soon so the
          // anchor effect can position on it, instead of waiting a full tick.
          if (anchor !== null && !events.some(entry =>
            entry.event.seq > anchor
            && (entry.event.type === 'user/message' || entry.event.type === 'assistant/message'))) {
            window.setTimeout(() => { if (!cancelled) void poll() }, 200)
          }
          return
        }
        setLoadedEvents(prev => {
          const latest = prev.at(-1)?.event.seq ?? -1
          const fresh = events.filter(event => event.event.seq > latest)
          return fresh.length === 0 ? prev : [...prev, ...fresh]
        })
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

  // Post-answer retitle: fires once (guarded by the store's titled flag). Only
  // the child's OWN events feed it — inherited parent history must not
  // contaminate the question/answer extraction.
  useEffect(() => {
    if (activeChildId === null || loadedEvents.length === 0) return
    const ownEvents = anchorSeq === null
      ? loadedEvents
      : loadedEvents.filter(entry => entry.event.seq > anchorSeq)
    if (ownEvents.length === 0) return
    void titleSideSessionOnce(ctx, store, {
      sideSessionId: activeChildId,
      parentSessionId: store.parentOf(activeChildId) ?? sessionId,
      events: ownEvents,
    })
  }, [loadedEvents, anchorSeq, activeChildId, ctx, store, sessionId])

  // Anchor the initial view on the child's own first message (quote +
  // question), skipping past the inherited parent history. Position within OUR
  // scrollport only — scrollIntoView would also scroll better-sidebar's outer
  // container and could drag the composer out of view.
  //
  // Depends on `rows` (not just `anchorSeq`): right after an inherit ask the
  // own first message may not be in the first page yet (prompt queues into the
  // agent inbox and lands a beat later). Once it appears, this retries — but
  // only once, via `anchoredRef`, so later page appends don't yank the view.
  useEffect(() => {
    if (anchorSeq === null || anchoredRef.current) return
    const scrollEl = scrollRef.current
    const anchorEl = anchorRowRef.current
    if (scrollEl === null || anchorEl === null) return
    anchoredRef.current = true
    requestAnimationFrame(() => {
      const containerTop = scrollEl.getBoundingClientRect().top
      const anchorTop = anchorEl.getBoundingClientRect().top
      scrollEl.scrollTop += anchorTop - containerTop
    })
  }, [anchorSeq, rows])

  // Load the inherited (fork-seed) history upward, preserving the scroll
  // position, like the main conversation's "load older" paging.
  const loadOlder = async (): Promise<void> => {
    if (activeChildId === null || loadingOlder || !hasOlder) return
    const first = loadedEvents[0]
    if (first === undefined) return
    setLoadingOlder(true)
    try {
      const before = first.event.seq
      const response = await ctx.connection.api.sessions.history({
        sessionId: activeChildId,
        beforeSeq: before,
        maxMessages: 60,
      })
      if (!response.result.ok) return
      const older = response.result.value.events.filter(event => event.event.seq < before)
      if (older.length > 0) {
        const scrollEl = scrollRef.current
        const heightBefore = scrollEl?.scrollHeight ?? 0
        setLoadedEvents(prev => [...older, ...prev])
        setHasOlder(response.result.value.hasMore)
        if (scrollEl !== null) {
          requestAnimationFrame(() => {
            scrollEl.scrollTop += scrollEl.scrollHeight - heightBefore
          })
        }
      } else {
        setHasOlder(response.result.value.hasMore)
      }
    } catch {
      // keep the loaded page; the next scroll retries
    } finally {
      setLoadingOlder(false)
    }
  }

  // The transcript scrollport: reaching the top loads the older history.
  const onScroll = (): void => {
    const el = scrollRef.current
    if (el === null) return
    if (el.scrollTop <= 48) void loadOlder()
  }

  // When the active follow-up finishes, leave the answering phase.
  useEffect(() => {
    if (!activeRunning) setPhase(prev => (prev === 'answering' ? 'idle' : prev))
  }, [activeRunning])

  const submit = async (): Promise<void> => {
    const q = question.trim()
    if (q === '' || phase === 'asking') return
    setPhase('asking')
    setError(null)
    setStrategyNote(null)
    try {
      if (activeChildId === null) {
        const result = await askFollowUp(
          ctx,
          store,
          {
            parentSessionId: sessionId,
            quote: pendingQuote ?? { text: '' },
            question: q,
            strategy,
            modelOverride: pendingModel ?? undefined,
          },
          (next) => {
            if (next === 'answering') setPhase('answering')
          },
        )
        setActiveChildId(result.sideSessionId)
        // The inherit fork can degrade to compressed when the parent is
        // mid-turn; surface that so the user knows the context was not full.
        if (result.strategy !== strategy) {
          setStrategyNote(t('askDegradedToCompressed'))
        }
        store.setPendingQuote(sessionId, null)
        // Consume a meta-carried quote after it was sent, so refocusing the tab
        // (or a page reload, where the meta persists) never resurfaces it.
        consumeMeta()
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
  // A parked quote only owns the view while no follow-up is selected: the
  // switcher can always return to an existing conversation, and the 新追问
  // button returns to the parked quote (see resolveAskMode).
  const mode = resolveAskMode(pendingQuote !== null, activeChildId)

  // Consume the meta-carried quote channel once (send or cancel both count).
  const consumeMeta = (): void => {
    if (metaQuote !== null) {
      ctx.betterSidebar.updateTab(props.tab.id, { meta: consumeMetaQuote(props.tab.meta) })
    }
  }

  // Cancel a parked quote: clear both channels and return to the latest
  // follow-up when one exists, else the empty hint.
  const clearQuote = (): void => {
    store.setPendingQuote(sessionId, null)
    consumeMeta()
    const list = store.childrenOf(sessionId)
    setActiveChildId(list.length > 0 ? (list[list.length - 1] ?? null) : null)
    setPhase('idle')
    setError(null)
  }

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
            onClick={() => { setActiveChildId(null); setPhase('idle'); setError(null) }}
          >
            {t('askNewAsk')}
          </button>
        </div>
      )}

      <div className={css.body} ref={scrollRef} onScroll={onScroll}>
        {mode === 'conversation' && (
          <Transcript
            rows={rows}
            running={activeRunning}
            codeLabels={codeLabels}
            anchorSeq={anchorSeq}
            anchorRef={anchorRowRef}
            hasOlder={hasOlder}
          />
        )}
        {mode === 'start' && (
          <div className={css.startHint}>
            {pendingQuote !== null && pendingQuote.text !== ''
              ? (
                <div className={css.quoteChip}>
                  <div className={css.quoteChipHead}>
                    {t('askQuoteHead')}
                    <button type="button" className={css.quoteCancel} onClick={clearQuote}>{t('commonCancel')}</button>
                  </div>
                  <div className={css.quoteChipText}>{pendingQuote.text}</div>
                </div>
              )
              : <div className={css.emptyHint}>{t('askNoQuoteHint')}</div>}
          </div>
        )}
        {mode === 'empty' && (
          <div className={css.emptyHint}>{t('askEmptyHint')}</div>
        )}
      </div>

      {strategyNote !== null && <div className={css.strategyNote}>{strategyNote}</div>}
      {phase === 'asking' && <div className={css.busyHint}>{t('askPreparing')}</div>}

      {/* DSH-style composer card: the same capsule chrome as the main
          conversation's input bar — textarea on top, action row below
          (strategy chip left; model seat + context meter + send right). */}
      <div className={css.card}>
        <textarea
          ref={inputRef}
          className={css.input}
          placeholder={t('askComposerPlaceholder')}
          value={question}
          onChange={(event) => { setQuestion(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void submit()
            }
          }}
        />
        <div className={css.row}>
          <div className={css.tools}>
            {activeChildId === null && (
              <StrategySelect value={strategy} disabled={busy} onChange={setStrategy} />
            )}
          </div>
          <div className={css.trailing}>
            <ModelSelect
              ctx={ctx}
              sessionId={seat.sessionId}
              mode={seat.mode}
              value={seat.value}
              {...seat.hintKey === undefined ? {} : { hint: t(seat.hintKey) }}
              disabled={busy}
              // Only a draft feeds `pendingModel`: a switch made on a child
              // session must not silently become the next new ask's model.
              onChange={seat.mode === 'draft' ? setPendingModel : undefined}
            />
            <ContextMeter ctx={ctx} sessionId={toolSessionId} />
            <Tooltip label={t('askSend')} side="top" delayMs={500}>
              <button
                type="button"
                className={css.primary}
                aria-label={t('askSend')}
                disabled={question.trim() === '' || busy}
                onClick={() => { void submit() }}
              >
                {/* The host composer's send glyph (design 34:10465). */}
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                  <path d="M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z" fill="currentColor" />
                </svg>
              </button>
            </Tooltip>
          </div>
        </div>
      </div>

      {phase === 'error' && error !== null && (
        <div className={css.error}>{t('errAskFailed', { detail: error })}</div>
      )}
    </div>
  )
}

/** The streaming transcript (user right, assistant left; assistant is plain
 *  markdown). When the followed session is a fork child, the inherited parent
 *  history renders ABOVE the anchor divider — the divider sits at the child's
 *  own first message (the quote + question), which is also the initial
 *  scroll anchor. */
function Transcript({
  rows,
  running,
  anchorSeq,
  anchorRef,
  hasOlder,
  codeLabels,
}: {
  rows: readonly TranscriptRow[]
  running: boolean
  /** Identity-stable per locale (see the AskPanel memo). */
  codeLabels: { copyLabel: string; copiedLabel: string }
  anchorSeq: number | null
  anchorRef: RefObject<HTMLDivElement>
  hasOlder: boolean
}) {
  if (rows.length === 0) {
    return <div className={css.emptyHint}>{t('askGenerating')}</div>
  }
  const lastIndex = rows.length - 1
  let dividerPlaced = false
  return (
    <div className={css.transcript}>
      {rows.map((row, index) => {
        const isAnchor = !dividerPlaced && anchorSeq !== null && row.seq > anchorSeq
        if (isAnchor) dividerPlaced = true
        const streaming = running && index === lastIndex && row.role === 'assistant'
        return (
          <div key={row.seq} ref={isAnchor ? anchorRef : undefined}>
            {isAnchor && (
              <div className={css.seedDivider}>
                {hasOlder ? t('askSeedDividerMore') : t('askSeedDivider')}
              </div>
            )}
            {row.role === 'user'
              ? <UserRow text={row.text} />
              : <AssistantRow text={row.text} streaming={streaming} codeLabels={codeLabels} />}
          </div>
        )
      })}
    </div>
  )
}

/** One assistant message: raw markdown, no card (mirrors the main conversation). */
function AssistantRow({ text, streaming, codeLabels }: {
  text: string
  streaming: boolean
  /** Identity-stable per locale (see the AskPanel memo). */
  codeLabels: { copyLabel: string; copiedLabel: string }
}) {
  return (
    <div className={css.assistantRow}>
      <div className={css.assistantMarkdown}>
        <MarkdownText text={text} streaming={streaming} codeLabels={codeLabels} />
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
