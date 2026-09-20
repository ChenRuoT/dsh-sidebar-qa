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
import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  Context,
  SidebarqaHistoryEntry,
  SidebarqaModelSelection,
  SidebarqaPendingQuote,
  SidebarqaTabComponentProps,
} from '../context-types.ts'
import type { SidebarqaHistoryStrategy } from '../config.ts'
import { lastEndSeedIndex, transcriptRowsOf, type TranscriptRow } from './answer.ts'
import {
  followUpAvailability,
  isFollowable,
  lastFollowableFollowUp,
  type FollowUpAvailability,
} from './history-scope.ts'
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
  // The archive set is registry-global and arrives whole, so subscribing to the
  // workspaces feed is what lets this panel notice that the follow-up it is
  // READING has just been archived somewhere else.
  const workspaceList = useSyncExternalStore(
    (cb: () => void) => ctx.workspaces.list.subscribe(cb),
    () => ctx.workspaces.list.getSnapshot(),
  )
  // `workspaceList` is in the key purely as the invalidation trigger: the set is
  // derived from the service, and the feed's identity is what says it changed.
  const archivedIds = useMemo(() => archivedSetOf(ctx), [ctx, workspaceList])

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
  // MarkdownText's localized chrome. `labels` is the ONLY vocabulary the host
  // reads — the prop was renamed from `codeLabels` before DSH 0.1.2-alpha.2, and
  // `render.tsx` reads `labels.code.copyLabel` with NO guard, so leaving it
  // undefined turns every fenced code block (i.e. the whole inherited history of
  // a coding conversation) into a TypeError at render time. That error used to
  // escape this panel and retire the tab body page-wide — the "panel went white
  // and never came back" report. Identity-stable per locale: MarkdownText caches
  // its streaming render against this object's identity, so it must NOT be
  // rebuilt on every render.
  const markdownLabels = useMemo<MarkdownLabels>(
    () => ({
      code: { copyLabel: t('commonCopy'), copiedLabel: t('commonCopied') },
      footnotes: t('mdFootnotes'),
    }),
    [localeRevision],
  )

  // ── Follow-up availability ────────────────────────────────────────────────
  // The switcher's rows come from THIS plugin's own localStorage lineage, which
  // survives an archive/delete in DSH — so a chip may name a conversation whose
  // journal can no longer be read. Selecting one used to leave the panel on an
  // empty transcript with no explanation, and (worse) let a gesture navigate to
  // a session DSH immediately drops. The panel therefore follows `following`
  // (never a stale id) and says out loud why a stale row cannot be read.
  const feedReady = sessionList.phase === 'ready'
  const availabilityOf = (id: string): FollowUpAvailability =>
    followUpAvailability(id, sessionList.byId, archivedIds, feedReady)
  const activeAvailability: FollowUpAvailability | null =
    activeChildId === null ? null : availabilityOf(activeChildId)
  const staleStatus = activeAvailability !== null && !isFollowable(activeAvailability)
  // What the panel actually follows: the selected follow-up, unless it is stale.
  const following = staleStatus ? null : activeChildId
  const activeRunning = following !== null && sessionList.byId[following]?.running === true
  // The context meter binds to the session the ask is about: the active side
  // session when continuing, the parent when starting a new ask (the future
  // side session does not exist yet — and the parent's occupancy is exactly
  // what tells the user whether 全量继承 or 裁切 is the right call).
  const toolSessionId = following ?? sessionId
  // The model seat needs more than an id: a new ask must NOT write the asked
  // session's model (issue #10), so the binding also says how a pick lands.
  const seat = useMemo(
    () => resolveModelSeat({ activeChildId: following, parentSessionId: sessionId, strategy, pendingModel, config }),
    [following, sessionId, strategy, pendingModel, config],
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

  // On session change: default to the latest follow-up of that session that can
  // actually be read. The feeds are read HERE rather than through the render
  // snapshot on purpose: this effect also clears the composer, so re-running it
  // on every session-feed tick would wipe a half-typed question.
  useEffect(() => {
    const list = store.childrenOf(sessionId)
    const feed = ctx.sessions.list.getSnapshot()
    setActiveChildId(lastFollowableFollowUp(list, feed.byId, archivedSetOf(ctx), feed.phase === 'ready'))
    setQuestion('')
    setPhase('idle')
    setError(null)
    setStrategyNote(null)
    setPendingModel(null)
  }, [sessionId, store, ctx])
  // Reset the anchored transcript when the followed session changes. Keyed on
  // `following`, not on the selection: a re-classified (stale) selection must
  // not keep a transcript of a session the panel no longer follows.
  useEffect(() => {
    seededRef.current = false
    anchoredRef.current = false
    setLoadedEvents([])
    setAnchorSeq(null)
    setHasOlder(false)
    setLoadingOlder(false)
    cursorRef.current = null
    if (scrollRef.current !== null) scrollRef.current.scrollTop = 0
  }, [following])

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
    if (following === null || !visible) return
    return followSession(ctx, following, {
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
  }, [following, visible, ctx])

  // Post-answer retitle: fires once (guarded by the store's titled flag). Only
  // the child's OWN events feed it — inherited parent history must not
  // contaminate the question/answer extraction.
  useEffect(() => {
    if (following === null || loadedEvents.length === 0) return
    const ownEvents = anchorSeq === null
      ? loadedEvents
      : loadedEvents.filter(entry => entry.event.seq > anchorSeq)
    if (ownEvents.length === 0) return
    void titleSideSessionOnce(ctx, store, {
      sideSessionId: following,
      parentSessionId: store.parentOf(following) ?? sessionId,
      events: ownEvents,
    })
  }, [loadedEvents, anchorSeq, following, ctx, store, sessionId])

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
    if (following === null || loadingOlder || !hasOlder) return
    const first = loadedEvents[0]
    const throughSeq = cursorRef.current
    // Before the follow's opening frame there is no log cut to quote, so there
    // is nothing to page back from either.
    if (first === undefined || throughSeq === null) return
    setLoadingOlder(true)
    try {
      const before = first.event.seq
      const result = await ctx.remote.session.page({
        address: sessionAddress(following),
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
    // A stale selection must never be pushed anywhere: `following` is null for
    // it, and falling through to the new-ask branch would silently START a new
    // follow-up from the parent while the user believes they are continuing the
    // selected one. The composer is disabled in that state as well.
    if (q === '' || phase === 'asking' || staleStatus) return
    setPhase('asking')
    setError(null)
    setStrategyNote(null)
    try {
      if (following === null) {
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
        await sendFollowUp(ctx, following, q)
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
  // button returns to the parked quote (see resolveAskMode). A stale selection
  // owns nothing — the panel refuses to follow it.
  const mode = resolveAskMode(pendingQuote !== null, following)

  // Consume the cross-plugin quote channel once (send or cancel both count).
  // The adapter already marked the payload itself consumed, so this only stops
  // the PANEL from keeping it in view mode.
  const consumeMeta = (): void => {
    if (metaQuote !== null) setQuoteConsumed(true)
  }

  // Cancel a parked quote: clear both channels and return to the latest
  // follow-up that can be read, else the empty hint.
  const clearQuote = (): void => {
    store.setPendingQuote(sessionId, null)
    consumeMeta()
    setActiveChildId(latestFollowableChild(ctx, store, sessionId))
    setPhase('idle')
    setError(null)
  }

  /** Drop a stale row (and its subtree) from this plugin's own mapping. */
  const removeStale = (id: string): void => {
    store.removeSession(id)
    setActiveChildId(latestFollowableChild(ctx, store, sessionId))
    setPhase('idle')
    setError(null)
  }

  return (
    <div className={css.root}>
      {children.length > 0 && (
        <div className={css.switcher}>
          {children.map((id) => {
            // A row survives an archive/delete in DSH (it lives in this plugin's
            // own mapping), so it is classified on every render: an unavailable
            // conversation is shown, labelled and NOT clickable — exactly like a
            // stale row in 追问记录, and it can never strand the panel on a
            // transcript that cannot be read.
            const availability = availabilityOf(id)
            const stale = !isFollowable(availability)
            const label = titleOf(ctx, id)
            const statusLabel = availability === 'archived' ? t('histArchived') : t('histDeleted')
            return (
              <button
                key={id}
                type="button"
                className={[
                  css.switcherItem,
                  activeChildId === id ? css.switcherActive : '',
                  stale ? css.switcherStale : '',
                ].filter(Boolean).join(' ')}
                title={stale ? `${label} · ${statusLabel}` : label}
                disabled={stale}
                onClick={() => { setActiveChildId(id); setPhase('idle'); setError(null) }}
              >
                {stale ? `${label} · ${statusLabel}` : label}
              </button>
            )
          })}
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
        {staleStatus && activeChildId !== null && (
          <div className={css.staleNotice}>
            <div className={css.emptyHint}>
              {activeAvailability === 'archived' ? t('askStaleArchived') : t('askStaleDeleted')}
            </div>
            <button
              type="button"
              className={css.staleRemove}
              title={t('askStaleRemoveTitle')}
              onClick={() => { removeStale(activeChildId) }}
            >
              {t('commonRemove')}
            </button>
          </div>
        )}
        {!staleStatus && mode === 'conversation' && (
          <Transcript
            rows={rows}
            running={activeRunning}
            labels={markdownLabels}
            anchorSeq={anchorSeq}
            anchorRef={anchorRowRef}
            hasOlder={hasOlder}
          />
        )}
        {!staleStatus && mode === 'start' && (
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
        {mode === 'empty' && !staleStatus && (
          <div className={css.emptyHint}>{t('askEmptyHint')}</div>
        )}
      </div>

      {strategyNote !== null && <div className={css.strategyNote}>{strategyNote}</div>}
      {phase === 'asking' && <div className={css.busyHint}>{t('askPreparing')}</div>}

      {/* DSH-style composer card: the same capsule chrome as the main
          conversation's input bar — textarea on top, action row below
          (strategy chip left; model seat + context meter + send right).
          A stale selection leaves nothing to continue, so the composer is
          disabled outright rather than silently retargeted at the parent. */}
      <div className={css.card}>
        <textarea
          ref={inputRef}
          className={css.input}
          placeholder={staleStatus ? t('askStaleComposer') : t('askComposerPlaceholder')}
          value={question}
          disabled={staleStatus}
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
            {following === null && !staleStatus && (
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
              disabled={busy || staleStatus}
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
                disabled={question.trim() === '' || busy || staleStatus}
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
  labels,
}: {
  rows: readonly TranscriptRow[]
  running: boolean
  /** Identity-stable per locale (see the AskPanel memo). */
  labels: MarkdownLabels
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
              : <AssistantRow text={row.text} streaming={streaming} labels={labels} />}
          </div>
        )
      })}
    </div>
  )
}

/** One assistant message: raw markdown, no card (mirrors the main conversation). */
function AssistantRow({ text, streaming, labels }: {
  text: string
  streaming: boolean
  /** Identity-stable per locale (see the AskPanel memo). */
  labels: MarkdownLabels
}) {
  return (
    <div className={css.assistantRow}>
      <div className={css.assistantMarkdown}>
        <MarkdownText text={text} streaming={streaming} labels={labels} />
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

/**
 * The archive set as this client knows it, read at call time.
 *
 * Read through the service rather than cached in state: the set is a
 * registry-global HOST fact, and a panel that cached it would keep offering a
 * conversation that has just been archived. Any failure reads as "nothing is
 * archived", which is the same assumption the feature had before this guard —
 * a read that cannot work must not disable the panel.
 * @param ctx - the client plugin context.
 * @returns the archived session ids.
 */
function archivedSetOf(ctx: Context): ReadonlySet<string> {
  try {
    return new Set(ctx.workspaces.list.getSnapshot().archivedSessionIds ?? [])
  } catch {
    return new Set()
  }
}

/**
 * The follow-up to select after the current selection is gone: the newest one
 * this client can still read, else null (the panel's "no follow-up selected"
 * state). Reads the feeds at call time for the same reason {@link archivedSetOf}
 * does.
 * @param ctx - the client plugin context.
 * @param store - the plugin's lineage store.
 * @param sessionId - the session whose follow-ups are listed.
 * @returns the id to select, or null.
 */
function latestFollowableChild(ctx: Context, store: SidebarqaStore, sessionId: string): string | null {
  const feed = ctx.sessions.list.getSnapshot()
  return lastFollowableFollowUp(
    store.childrenOf(sessionId),
    feed.byId,
    archivedSetOf(ctx),
    feed.phase === 'ready',
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
