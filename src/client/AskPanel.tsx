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
import type {
  Context,
  SidebarqaHistoryEntry,
  SidebarqaModelSelection,
  SidebarqaPendingQuote,
  SidebarqaTabComponentProps,
} from '../context-types.ts'
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
import { resolveAskMode } from './ask-mode.ts'
import { eventsOfRecords, followSession, mergeEntries, sessionAddress } from './session-wire.ts'
import type { SidebarqaStore } from './store.ts'
import css from './ask-panel.module.css'

interface AskPanelProps extends Omit<SidebarqaTabComponentProps, 'store'> {
  store: SidebarqaStore
}

type Phase = 'idle' | 'asking' | 'answering' | 'error'

export function AskPanel(props: AskPanelProps) {
  const { ctx, scope, visible, store, sidebar } = props
  // Follow the DSH language: t() reads at call time, so this single root
  // re-render re-localizes the whole subtree (keep it free of React.memo).
  const localeRevision = useLocaleRevision()
  const sessionId = scope.sessionId

  // Neither the chip text nor panel expansion needs anything from this panel.
  // `sidebar-native.ts` registers a LIVE title seat, so the tab chip re-localizes
  // with the language on its own; and a type-only `openTab` expands the column as
  // part of placing the tab, so a collapsed panel can never hide a tab this plugin
  // just opened. `localeRevision` still matters here — it re-renders the panel's
  // own headings below.

  const snapshot = useSyncExternalStore(
    (cb: () => void) => store.subscribe(cb),
    () => store.getSnapshot(),
  )
  // Cross-plugin seam: a quote an EXTERNAL plugin handed over with the open
  // (e.g. dsh-sidebar-preview-select's preview selection) takes precedence over
  // the store's pending quote, which is this plugin's own popover channel. It
  // rides the open as `navigation.params`, and the occurrence hands it over
  // exactly once per navigation, so this component reads it here and then owns
  // its lifetime.
  const [openQuote, setOpenQuote] = useState<SidebarqaPendingQuote | null>(null)
  const [quoteConsumed, setQuoteConsumed] = useState(false)
  const takeQuote = sidebar?.takeQuote
  const revision = sidebar?.revision
  useEffect(() => {
    if (takeQuote === undefined) return
    // Re-arming on activation is what makes a SECOND external open into the
    // same tab deliver its new quote: only the newest open's payload is read.
    setQuoteConsumed(false)
    setOpenQuote(takeQuote())
  }, [takeQuote, revision])
  const metaQuote = quoteConsumed ? null : openQuote
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
  // The follow snapshot's inclusive log cut. `session.page` rejects any
  // `throughSeq` the host did not hand out, so upward paging is only reachable
  // once the live follow has opened.
  const cursorRef = useRef<number | null>(null)

  // The transcript rows derive from the loaded events (the follow and the
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
    cursorRef.current = null
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

  // Stream the active follow-up's transcript. The follow's opening window
  // anchors the fork-seed boundary and hands out the log cut later pages must
  // quote; every append after it arrives as its own frame, so the answer
  // streams in instead of landing on a 1.2s poll tick. Reopening the follow
  // (the tab was hidden, or the carrier reconnected) republishes that window,
  // which merges by seq so an upward-loaded inherited history is never lost.
  useEffect(() => {
    if (activeChildId === null || !visible) return
    return followSession(ctx, activeChildId, {
      snapshot: ({ entries, cursor, hasMore }) => {
        cursorRef.current = cursor
        if (!seededRef.current) {
          seededRef.current = true
          const seedIndex = lastEndSeedIndex(entries)
          setAnchorSeq(seedIndex >= 0 ? entries[seedIndex]?.event.seq ?? null : null)
          setHasOlder(seedIndex >= 0 || hasMore)
          setLoadedEvents(entries)
          return
        }
        setLoadedEvents(prev => mergeEntries(prev, entries))
        if (hasMore) setHasOlder(true)
      },
      append: (entry) => {
        setLoadedEvents(prev => mergeEntries(prev, [entry]))
      },
    })
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
  // scrollport only — scrollIntoView would also scroll DSH's outer right-column
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
    const throughSeq = cursorRef.current
    // Before the follow's opening frame there is no log cut to quote, so there
    // is nothing to page back from either.
    if (first === undefined || throughSeq === null) return
    setLoadingOlder(true)
    try {
      const before = first.event.seq
      const result = await ctx.remote.session.page({
        address: sessionAddress(activeChildId),
        throughSeq,
        beforeSeq: before,
        maxMessages: 60,
      })
      if (!result.ok) return
      const older = eventsOfRecords(result.value.records).filter(entry => entry.event.seq < before)
      if (older.length > 0) {
        const scrollEl = scrollRef.current
        const heightBefore = scrollEl?.scrollHeight ?? 0
        setLoadedEvents(prev => [...older, ...prev])
        setHasOlder(result.value.hasMore)
        if (scrollEl !== null) {
          requestAnimationFrame(() => {
            scrollEl.scrollTop += scrollEl.scrollHeight - heightBefore
          })
        }
      } else {
        setHasOlder(result.value.hasMore)
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

  // Consume the cross-plugin quote channel once (send or cancel both count).
  // The adapter already marked the payload itself consumed, so this only stops
  // the PANEL from keeping it in view mode.
  const consumeMeta = (): void => {
    if (metaQuote !== null) setQuoteConsumed(true)
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
