/**
 * The AskPanel's model selector: a compact port of the host composer's
 * `conversation.input.model` seat (ModelSelect), driven directly by the same
 * wire facts — `session.models` for the advisory directory and
 * `session.selectModel` for submission — so a switch here is what the host
 * composer and the /model command show next. Two-level menu (模型 / 推理强度)
 * over the provider-grouped directory; failures surface as an inline strip
 * with Retry.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type FocusEvent } from 'react'
import {
  IconCheckOutline16, IconChevronDownOutline14, IconChevronRightOutline14, IconWarningOutline16, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context } from '../context-types.ts'
import type {
  SidebarqaModelCatalogFailure,
  SidebarqaModelProviderGroup,
  SidebarqaModelSelection,
} from '../context-types.ts'
import { t } from './locales.ts'
import { useLocaleRevision } from './use-locale.ts'
import { effectiveEffortOf, isNoopSelection, modelChoiceId, modelChoicesOf, modelSelectionOf } from './model-menu.ts'
import type { ModelSeatMode } from './model-seat.ts'
import css from './ask-panel.module.css'

/** Join truthy class names (no clsx dependency in this package). */
function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ')
}

/** One pane of the dropdown: the two-row root or one drilled-in list. */
type Pane = 'root' | 'models' | 'effort'

/** Local mirror of the directory lifecycle (the component owns its load). */
interface DirState {
  current: SidebarqaModelSelection | null
  routable: boolean | null
  groups: readonly SidebarqaModelProviderGroup[]
  failures: readonly SidebarqaModelCatalogFailure[]
  status: 'idle' | 'loading' | 'ready' | 'selecting' | 'error'
  error: string | null
}

const IDLE: DirState = { current: null, routable: null, groups: [], failures: [], status: 'idle', error: null }

/** One dynamic effort row; undefined means preserve the provider default. */
interface EffortChoice {
  key: string
  effort: string | undefined
  label: string
}

export interface ModelSelectProps {
  ctx: Context
  /**
   * The session whose model directory this selector READS — and, in `commit`
   * mode only, writes. `draft` / `readonly` never write it (issue #10: a new
   * ask used to rewrite the asked session's model before its follow-up existed).
   */
  sessionId: string
  /** How a pick lands. Default `commit` — submit it to `sessionId`. */
  mode?: ModelSeatMode
  /** The selection to DISPLAY, overriding the directory's own current. */
  value?: SidebarqaModelSelection | null
  /** Hover hint (the read-only seat's explainer); absent leaves the tooltip off. */
  hint?: string
  disabled?: boolean
  /**
   * Called with the accepted selection: after a switch lands in `commit` mode,
   * immediately in `draft` mode. Lets the owner record "the model the next ask
   * should use".
   */
  onChange?: (selection: SidebarqaModelSelection) => void
}

/**
 * The compact model seat for the side panel. `ctx.connection.api.sessions`
 * carries both verbs; the RPC surface mirrors the host's `session.models` /
 * `session.selectModel` exactly, so no plugin-to-plugin import is involved.
 */
export function ModelSelect({
  ctx,
  sessionId,
  mode = 'commit',
  value = null,
  hint,
  disabled = false,
  onChange,
}: ModelSelectProps) {
  // The seat renders inside the panel root, but its own useMemo caches copy —
  // the revision keys that memo so a language switch rebuilds the labels.
  const localeRevision = useLocaleRevision()
  const [dir, setDir] = useState<DirState>(IDLE)
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<Pane>('root')
  const generation = useRef(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()

  const choices = useMemo(() => modelChoicesOf(dir), [dir])
  // What the seat DISPLAYS. `dir.current` is wire truth (the session's own
  // reported model); a draft overrides it so the seat shows what the follow-up
  // will actually use, without anything being written anywhere.
  const selection: SidebarqaModelSelection | null = mode === 'commit' ? dir.current : (value ?? dir.current)
  const selectedIndex = selection === null
    ? -1
    : choices.findIndex(c => c.provider === selection.provider && c.model === selection.model)
  const currentChoice = choices[selectedIndex]
  const reasoning = currentChoice?.reasoning
  const effectiveEffort = effectiveEffortOf(dir, selection)
  const effortLabel = reasoning === undefined
    ? undefined
    : effectiveEffort === undefined
      ? t('commonDefault')
      : reasoning.efforts.find(level => level.id === effectiveEffort)?.name ?? effectiveEffort
  const effortChoices = useMemo<readonly EffortChoice[]>(() => reasoning === undefined
    ? []
    : [
      ...reasoning.defaultEffort === undefined
        ? [{ key: 'provider-default', effort: undefined as string | undefined, label: t('modelProviderDefault') }]
        : [],
      ...reasoning.efforts.map((effort) => ({
        key: `effort:${effort.id}`,
        effort: effort.id,
        label: effort.name,
      })),
    ], [reasoning, localeRevision])
  const busy = dir.status === 'selecting'

  const load = (): void => {
    const gen = ++generation.current
    setDir(prev => ({ ...prev, status: 'loading', error: null }))
    void ctx.connection.api.sessions.models({ sessionId }).then((response) => {
      if (gen !== generation.current) return
      // Destructure first: the discriminated narrowing of `result` (a const)
      // survives into the setDir closures below; a `response.result.ok`
      // chain-narrowing would not.
      const { result } = response
      if (!result.ok) {
        setDir(prev => ({
          ...prev,
          status: 'error',
          error: `${result.error.code}: ${result.error.message}`,
        }))
        return
      }
      const { current, routable, groups, failures } = result.value
      setDir({ current, routable, groups, failures, status: 'ready', error: null })
    }).catch((error: unknown) => {
      if (gen !== generation.current) return
      setDir(prev => ({ ...prev, status: 'error', error: error instanceof Error ? error.message : String(error) }))
    })
  }

  // Mount-time load resolves the trigger label; every open refreshes.
  useEffect(() => { load() }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => { document.removeEventListener('mousedown', closeOutside) }
  }, [open])

  const show = (): void => {
    setPane('root')
    setOpen(true)
    load()
  }
  const close = (restoreFocus = false): void => {
    setOpen(false)
    setPane('root')
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }

  const moveFocus = (offset: number): void => {
    const items = itemRefs.current.filter(item => item !== null)
    if (items.length === 0) return
    const active = items.findIndex(item => item === document.activeElement)
    const next = (Math.max(active, 0) + offset + items.length) % items.length
    items[next]?.focus()
  }

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      if (pane !== 'root') setPane('root')
      else close(true)
      return
    }
    if (!open) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(event.key === 'ArrowDown' ? 1 : -1)
    }
  }

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return
    close()
  }

  const choose = (next: SidebarqaModelSelection): void => {
    // A read-only seat (the `inherit` fork keeps the parent's model) never picks.
    if (mode === 'readonly') {
      close(true)
      return
    }
    // A draft is local: the pick travels to the follow-up as `modelOverride`
    // once it exists. No RPC, so the asked session is left untouched. No no-op
    // short-circuit either — re-picking the displayed model is how the user
    // pins a config-derived default as an explicit draft.
    if (mode === 'draft') {
      onChange?.(next)
      close(true)
      return
    }
    // Same route AND same effective effort is the only true no-op. The earlier
    // guard compared provider/model only, which swallowed every effort switch.
    if (isNoopSelection(dir, selection, next)) {
      close(true)
      return
    }
    const gen = ++generation.current
    setDir(prev => ({ ...prev, status: 'selecting', error: null }))
    void ctx.connection.api.sessions.selectModel({
      sessionId,
      provider: next.provider,
      model: next.model,
      ...next.reasoningEffort === undefined ? {} : { reasoningEffort: next.reasoningEffort },
    }).then((response) => {
      if (gen !== generation.current) return
      const { result } = response
      if (!result.ok) {
        setDir(prev => ({ ...prev, status: 'error', error: `${result.error.code}: ${result.error.message}` }))
        return
      }
      setDir(prev => ({ ...prev, current: result.value.selected, routable: true, status: 'ready', error: null }))
      onChange?.(result.value.selected)
      close(true)
    }).catch((error: unknown) => {
      if (gen !== generation.current) return
      setDir(prev => ({ ...prev, status: 'error', error: error instanceof Error ? error.message : String(error) }))
    })
  }

  // An effort-only pick keeps the route, so it MUST go through the same guard
  // as a model pick — `isNoopSelection` folds in the model's default effort and
  // is the single place that decides whether anything changed.
  const chooseEffort = (effort: string | undefined): void => {
    if (selection === null) return
    choose({
      provider: selection.provider,
      model: selection.model,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    })
  }

  // Fall back to the raw model id while the directory loads, after a failed
  // load, or for a drafted model the catalog does not list — a bare 「模型」
  // would hide which model the ask is actually going to use.
  const modelLabel = currentChoice?.name ?? selection?.model ?? t('modelFallbackLabel')
  const triggerLabel = effortLabel === undefined ? modelLabel : `${modelLabel} · ${effortLabel}`
  const readonly = mode === 'readonly'
  itemRefs.current = []
  let itemIndex = 0
  const itemRef = () => {
    const at = itemIndex++
    return (node: HTMLButtonElement | null) => { itemRefs.current[at] = node }
  }

  // The read-only seat uses `aria-disabled`, never the native `disabled`
  // attribute: browsers dispatch no pointer events on a disabled control (and
  // do not bubble them), which would silence the very hint that explains why
  // the seat cannot be used.
  const root = (
    <div ref={rootRef} className={css.modelRoot} onKeyDown={onRootKeyDown} onBlur={onBlur}>
      <button
        ref={triggerRef}
        type="button"
        className={cx(css.chip, readonly && css.chipReadonly)}
        aria-label={t('modelTrigger', { label: triggerLabel })}
        aria-haspopup={readonly ? undefined : 'menu'}
        aria-expanded={readonly ? undefined : open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-disabled={readonly ? true : undefined}
        title={hint === undefined ? triggerLabel : undefined}
        disabled={disabled}
        onClick={() => { if (readonly) return; if (open) close(); else show() }}
      >
        <span className={css.chipLabel}>{modelLabel}</span>
        {effortLabel !== undefined && <span className={css.chipEffort}>{effortLabel}</span>}
        <span className={cx(css.chipChevron, open && css.chipChevronOpen)} aria-hidden>
          <IconChevronDownOutline14 />
        </span>
      </button>

      {open && (
        <div id={`${id}-menu`} className={css.modelMenu} role="menu" aria-label={t('modelMenuLabel')} aria-busy={busy || dir.status === 'loading'}>
          {pane === 'root' && (
            <>
              <button ref={itemRef()} type="button" role="menuitem" className={css.modelCell} onClick={() => { setPane('models') }}>
                <span className={css.modelCellLabel}>{t('modelCellModel')}</span>
                <span className={css.modelCellValue}>{modelLabel}</span>
                <IconChevronRightOutline14 className={css.modelCellChevron} />
              </button>
              {reasoning !== undefined && (
                <button ref={itemRef()} type="button" role="menuitem" className={css.modelCell} onClick={() => { setPane('effort') }}>
                  <span className={css.modelCellLabel}>{t('modelCellEffort')}</span>
                  <span className={css.modelCellValue}>{effortLabel}</span>
                  <IconChevronRightOutline14 className={css.modelCellChevron} />
                </button>
              )}
            </>
          )}

          {pane === 'models' && (
            <>
              {dir.status === 'loading' && <div className={css.modelStatus}>{t('commonLoading')}</div>}
              {dir.error !== null && (
                <div className={css.modelError}>
                  <IconWarningOutline16 />
                  <span>{t('errModelFailed', { detail: dir.error })}</span>
                  <button type="button" className={css.modelRetry} onClick={load}>{t('commonRetry')}</button>
                </div>
              )}
              {dir.failures.map(failure => (
                <div className={css.modelWarn} key={failure.id}>
                  <IconWarningOutline16 />
                  <span>{t('modelFailureDetail', { name: failure.name, message: failure.message ?? t('modelLoadFailed') })}</span>
                  <button type="button" className={css.modelRetry} onClick={load}>{t('commonRetry')}</button>
                </div>
              ))}
              <div className={css.modelGroups}>
                {dir.groups.map((group) => {
                  const headingId = `${id}-${group.id}`
                  return (
                    <section role="group" aria-labelledby={headingId} className={css.modelGroup} key={group.id}>
                      <div className={css.modelGroupTitle} id={headingId}>{group.name}</div>
                      {group.models.map((model) => {
                        const selected = selection?.provider === group.id && selection.model === model.id
                        return (
                          <button
                            ref={itemRef()}
                            type="button"
                            role="menuitemradio"
                            aria-checked={selected}
                            className={cx(css.modelOption, selected && css.modelOptionSelected)}
                            key={model.id}
                            title={model.name}
                            disabled={busy}
                            onClick={() => {
                              // Resolve against the DISPLAYED selection: picking
                              // the drafted route must carry its own effort
                              // forward, not the read session's.
                              const picked = modelSelectionOf({ ...dir, current: selection }, modelChoiceId(group.id, model.id))
                              if (picked !== undefined) choose(picked)
                            }}
                          >
                            <span className={css.modelOptionCopy}>
                              <span className={css.modelName}>{model.name}</span>
                              {model.description !== undefined && model.description !== '' && (
                                <span className={css.modelDesc}>{model.description}</span>
                              )}
                            </span>
                            <span className={css.modelCheck}>
                              {selected ? <IconCheckOutline16 /> : null}
                            </span>
                          </button>
                        )
                      })}
                    </section>
                  )
                })}
              </div>
              {dir.status === 'ready' && choices.length === 0 && (
                <div className={css.modelStatus}>{t('modelEmpty')}</div>
              )}
            </>
          )}

          {pane === 'effort' && (
            <>
              {effortChoices.length === 0
                ? <div className={css.modelStatus}>{t('modelNoEfforts')}</div>
                : effortChoices.map(level => (
                  <button
                    ref={itemRef()}
                    type="button"
                    role="menuitemradio"
                    aria-checked={effectiveEffort === level.effort}
                    className={cx(css.modelOption, effectiveEffort === level.effort && css.modelOptionSelected)}
                    key={level.key}
                    disabled={busy}
                    onClick={() => { chooseEffort(level.effort) }}
                  >
                    <span className={css.modelOptionCopy}>
                      <span className={css.modelName}>{level.label}</span>
                    </span>
                    <span className={css.modelCheck}>
                      {effectiveEffort === level.effort ? <IconCheckOutline16 /> : null}
                    </span>
                  </button>
                ))}
            </>
          )}
        </div>
      )}
    </div>
  )

  // Tooltip clones its anchor (no extra DOM, the div's own ref and onBlur are
  // forwarded), and its `disabled` prop keeps the anchor mounted when there is
  // no hint — so toggling the strategy never remounts the seat.
  return (
    <Tooltip label={hint ?? ''} side="top" delayMs={300} disabled={hint === undefined}>
      {root}
    </Tooltip>
  )
}
