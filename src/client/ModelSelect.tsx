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
  IconCheckOutline16, IconChevronDownOutline14, IconChevronRightOutline14, IconWarningOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context } from '../context-types.ts'
import type {
  SidebarqaModelCatalogFailure,
  SidebarqaModelProviderGroup,
  SidebarqaModelSelection,
} from '../context-types.ts'
import { modelChoiceId, modelChoicesOf, modelSelectionOf } from './model-menu.ts'
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
  /** The session whose model this selector reads and writes. */
  sessionId: string
  disabled?: boolean
  /**
   * Called with the accepted selection after a switch lands. Lets the owner
   * record "the model the next ask should use" when the seat is bound to the
   * parent session in new-ask mode.
   */
  onChange?: (selection: SidebarqaModelSelection) => void
}

/**
 * The compact model seat for the side panel. `ctx.connection.api.sessions`
 * carries both verbs; the RPC surface mirrors the host's `session.models` /
 * `session.selectModel` exactly, so no plugin-to-plugin import is involved.
 */
export function ModelSelect({ ctx, sessionId, disabled = false, onChange }: ModelSelectProps) {
  const [dir, setDir] = useState<DirState>(IDLE)
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<Pane>('root')
  const generation = useRef(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()

  const choices = useMemo(() => modelChoicesOf(dir), [dir])
  const selectedIndex = dir.current === null
    ? -1
    : choices.findIndex(c => c.provider === dir.current?.provider && c.model === dir.current.model)
  const currentChoice = choices[selectedIndex]
  const reasoning = currentChoice?.reasoning
  const effectiveEffort = dir.current?.reasoningEffort ?? reasoning?.defaultEffort
  const effortLabel = reasoning === undefined
    ? undefined
    : effectiveEffort === undefined
      ? '默认'
      : reasoning.efforts.find(level => level.id === effectiveEffort)?.name ?? effectiveEffort
  const effortChoices = useMemo<readonly EffortChoice[]>(() => reasoning === undefined
    ? []
    : [
      ...reasoning.defaultEffort === undefined
        ? [{ key: 'provider-default', effort: undefined as string | undefined, label: '跟随提供方默认' }]
        : [],
      ...reasoning.efforts.map((effort) => ({
        key: `effort:${effort.id}`,
        effort: effort.id,
        label: effort.name,
      })),
    ], [reasoning])
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

  const choose = (selection: SidebarqaModelSelection): void => {
    if (dir.current?.provider === selection.provider && dir.current.model === selection.model) {
      close(true)
      return
    }
    const gen = ++generation.current
    setDir(prev => ({ ...prev, status: 'selecting', error: null }))
    void ctx.connection.api.sessions.selectModel({
      sessionId,
      provider: selection.provider,
      model: selection.model,
      ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort },
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

  const chooseEffort = (effort: string | undefined): void => {
    if (dir.current === null) return
    if (effectiveEffort === effort) {
      close(true)
      return
    }
    choose({
      provider: dir.current.provider,
      model: dir.current.model,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    })
  }

  const modelLabel = currentChoice?.name ?? '模型'
  const triggerLabel = effortLabel === undefined ? modelLabel : `${modelLabel} · ${effortLabel}`
  itemRefs.current = []
  let itemIndex = 0
  const itemRef = () => {
    const at = itemIndex++
    return (node: HTMLButtonElement | null) => { itemRefs.current[at] = node }
  }

  return (
    <div ref={rootRef} className={css.modelRoot} onKeyDown={onRootKeyDown} onBlur={onBlur}>
      <button
        ref={triggerRef}
        type="button"
        className={css.chip}
        aria-label={`模型：${triggerLabel}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        title={triggerLabel}
        disabled={disabled}
        onClick={() => { if (open) close(); else show() }}
      >
        <span className={css.chipLabel}>{modelLabel}</span>
        {effortLabel !== undefined && <span className={css.chipEffort}>{effortLabel}</span>}
        <span className={cx(css.chipChevron, open && css.chipChevronOpen)} aria-hidden>
          <IconChevronDownOutline14 />
        </span>
      </button>

      {open && (
        <div id={`${id}-menu`} className={css.modelMenu} role="menu" aria-label="模型选择" aria-busy={busy || dir.status === 'loading'}>
          {pane === 'root' && (
            <>
              <button ref={itemRef()} type="button" role="menuitem" className={css.modelCell} onClick={() => { setPane('models') }}>
                <span className={css.modelCellLabel}>模型</span>
                <span className={css.modelCellValue}>{modelLabel}</span>
                <IconChevronRightOutline14 className={css.modelCellChevron} />
              </button>
              {reasoning !== undefined && (
                <button ref={itemRef()} type="button" role="menuitem" className={css.modelCell} onClick={() => { setPane('effort') }}>
                  <span className={css.modelCellLabel}>推理强度</span>
                  <span className={css.modelCellValue}>{effortLabel}</span>
                  <IconChevronRightOutline14 className={css.modelCellChevron} />
                </button>
              )}
            </>
          )}

          {pane === 'models' && (
            <>
              {dir.status === 'loading' && <div className={css.modelStatus}>加载中…</div>}
              {dir.error !== null && (
                <div className={css.modelError}>
                  <IconWarningOutline16 />
                  <span>{dir.error}</span>
                  <button type="button" className={css.modelRetry} onClick={load}>重试</button>
                </div>
              )}
              {dir.failures.map(failure => (
                <div className={css.modelWarn} key={failure.id}>
                  <IconWarningOutline16 />
                  <span>{`${failure.name}：${failure.message ?? '加载失败'}`}</span>
                  <button type="button" className={css.modelRetry} onClick={load}>重试</button>
                </div>
              ))}
              <div className={css.modelGroups}>
                {dir.groups.map((group) => {
                  const headingId = `${id}-${group.id}`
                  return (
                    <section role="group" aria-labelledby={headingId} className={css.modelGroup} key={group.id}>
                      <div className={css.modelGroupTitle} id={headingId}>{group.name}</div>
                      {group.models.map((model) => {
                        const selected = dir.current?.provider === group.id && dir.current.model === model.id
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
                              const selection = modelSelectionOf(dir, modelChoiceId(group.id, model.id))
                              if (selection !== undefined) choose(selection)
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
                <div className={css.modelStatus}>未加载到可用模型</div>
              )}
            </>
          )}

          {pane === 'effort' && (
            <>
              {effortChoices.length === 0
                ? <div className={css.modelStatus}>当前模型没有可选的推理强度</div>
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
}
