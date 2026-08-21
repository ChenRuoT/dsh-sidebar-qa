/**
 * The webview config panel for dsh-sidebar-qa, rendered inside better-sidebar's
 * settings gear popup (the "功能配置" entry on the 追问 tab card in the DSH
 * Settings → 侧边卡片 page). It edits the host's own `sidebarqa` settings
 * namespace through the revision-guarded /sidebarqa/api config routes — NOT
 * better-sidebar's pluginSettings blob — so the host summarize/title routes keep
 * reading the same live values the panel just wrote.
 *
 * Persistence mirrors the Side card settings rows: text rows commit on
 * blur/Enter; number rows parse + clamp to their declared range and revert to
 * the stored value on invalid input. Writes are serialized and revision-guarded;
 * a stale write reverts the optimistic row and shows an inline conflict message.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { sidebarqaApi, type SidebarqaConfigView } from './api.ts'
import type { SidebarqaCatalog } from '../context-types.ts'
import {
  CATALOG_INHERIT_VALUE,
  coerceNumberField,
  configFields,
  modelOptionsOf,
  providerOptionsOf,
  type ConfigField,
  type ConfigFieldOption,
} from './config-fields.ts'
import { t } from './locales.ts'
import { useLocaleRevision } from './use-locale.ts'
import css from './config-panel.module.css'

/** Map one wire failure to an inline message (the conflict gets friendly copy). */
function messageOf(error: unknown): string {
  if (error instanceof Error && 'code' in error && (error as { code?: unknown }).code === 'settings-conflict') {
    return t('errSaveConflict')
  }
  // Localized frame + the raw (English) host detail.
  return t('errSaveFailed', { detail: error instanceof Error ? error.message : String(error) })
}

/** One config row: a controlled input with a local draft committed on blur/Enter. */
function FieldRow(props: {
  field: ConfigField
  value: string
  options?: readonly ConfigFieldOption[]
  onCommit: (raw: string) => string
}): ReactElement {
  const { field, value, options, onCommit } = props
  const [draft, setDraft] = useState(value)
  const number = field.type === 'number'
  const select = field.type === 'select' || field.type === 'catalog'
  const commit = (raw: string): void => { setDraft(onCommit(raw)) }
  return (
    <div className={css.row}>
      <span className={css.rowText}>
        <span className={css.title}>{field.label}</span>
        {field.desc !== undefined && field.desc !== '' && <span className={css.desc}>{field.desc}</span>}
      </span>
      {select ? (
        <select
          className={css.select}
          value={draft}
          aria-label={field.label}
          onChange={(event) => { commit(event.currentTarget.value) }}
        >
          {options?.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      ) : (
        <input
          type={number ? 'number' : 'text'}
          className={number ? css.numberInput : css.textInput}
          value={draft}
          min={field.min}
          max={field.max}
          step={1}
          placeholder={field.placeholder}
          aria-label={field.label}
          onChange={(event) => { setDraft(event.currentTarget.value) }}
          onBlur={() => { commit(draft) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
        />
      )}
    </div>
  )
}

/**
 * The config panel body. Mounted only while the gear popup is open, so it
 * re-reads the live config on every open and commits each row on blur/Enter.
 */
export function ConfigPanel(): ReactElement {
  // Follow the DSH language (this root is rendered by the settings shell).
  useLocaleRevision()
  const [config, setConfig] = useState<SidebarqaConfigView | null>(null)
  const [catalog, setCatalog] = useState<SidebarqaCatalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The LATEST optimistic config: nested updates build from this ref, not the
  // render-time `config`, so two same-tick commits never drop each other.
  const configRef = useRef<SidebarqaConfigView | null>(null)
  const revisionRef = useRef<number | undefined>(undefined)
  // Whether the user already wrote since mount: the mount read must not clobber
  // a newer optimistic edit.
  const dirtyRef = useRef(false)
  // Serialize commits so each queued write observes the previous write's revision.
  const inFlightRef = useRef<Promise<unknown>>(Promise.resolve())

  const update = (next: SidebarqaConfigView | null): void => {
    configRef.current = next
    setConfig(next)
  }

  useEffect(() => {
    let cancelled = false
    void sidebarqaApi.configGet().then((view) => {
      if (cancelled) return
      revisionRef.current = view.revision
      if (dirtyRef.current) return
      update(view.value ?? null)
    }).catch(() => { /* keep the loading state; the store defaults stay unreachable from a broken wire */ })
    // The catalog is advisory (never persisted here): a failure just leaves
    // the answer provider/model rows as empty selects, not a broken panel.
    void sidebarqaApi.catalog().then((next) => { if (!cancelled) setCatalog(next) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  /** Persist one patch (serialized, revision-guarded); revert on failure. */
  const commit = (patch: Record<string, unknown>): void => {
    const previous = configRef.current
    dirtyRef.current = true
    const optimistic = { ...(previous ?? ({} as SidebarqaConfigView)), ...patch } as SidebarqaConfigView
    update(optimistic)
    setError(null)
    const run = inFlightRef.current.then(async () => {
      const view = await sidebarqaApi.configUpdate(patch, revisionRef.current)
      revisionRef.current = view.revision
      const settled = view.value ?? optimistic
      update(settled)
      return settled
    })
    // A failed commit must not poison the queue: later writes still run.
    inFlightRef.current = run.then(() => undefined, () => undefined)
    void run.catch((caught) => {
      update(previous)
      setError(messageOf(caught))
    })
  }

  /** Commit one row; return the canonical value the row should display. */
  const onCommit = (field: ConfigField, raw: string): string => {
    const current = configRef.current
    const fallback = String(current?.[field.key] ?? '')
    if (field.type === 'number') {
      const clamped = coerceNumberField(raw, field.min, field.max)
      if (clamped === null) return fallback
      commit({ [field.key]: clamped })
      return String(clamped)
    }
    if (field.type === 'catalog' && field.source === 'answerProvider') {
      // The answer channel changed: re-anchor the model to the new channel's
      // first model (or the previous model when the new channel still serves
      // it), so a channel switch never leaves a stale model routed elsewhere.
      const providers = catalog?.providers ?? []
      const chosen = providers.find(provider => provider.provider === raw)
      const previousModel = String(current?.answerModel ?? '')
      const stillServed = chosen?.models.some(model => model.id === previousModel) ?? false
      const nextModel = stillServed || chosen === undefined
        ? previousModel
        : chosen.models[0]?.id ?? previousModel
      commit({ answerProvider: raw, ...(nextModel === previousModel ? {} : { answerModel: nextModel }) })
      return raw
    }
    if (field.type === 'catalog' && field.source === 'summarizeProvider') {
      // The summary channel changed: re-anchor the summary model. Switching to
      // "inherit" (empty) keeps the current model (it is always used on the
      // inherited channel); a concrete channel re-anchors like the answer row.
      const providers = catalog?.providers ?? []
      const previousModel = String(current?.summarizeModel ?? '')
      if (raw === CATALOG_INHERIT_VALUE) {
        commit({ summarizeProvider: raw })
        return raw
      }
      const chosen = providers.find(provider => provider.provider === raw)
      const stillServed = chosen?.models.some(model => model.id === previousModel) ?? false
      const nextModel = stillServed || chosen === undefined
        ? previousModel
        : chosen.models[0]?.id ?? previousModel
      commit({ summarizeProvider: raw, ...(nextModel === previousModel ? {} : { summarizeModel: nextModel }) })
      return raw
    }
    commit({ [field.key]: raw })
    return raw
  }

  if (config === null) {
    return <div className={css.loading}>{t('cfgLoading')}</div>
  }
  const currentConfig = config

  // Resolve each row's render options: catalog rows draw from the live model
  // catalog. A provider row lists configured channels; a model row lists the
  // models of its channel's currently chosen value (the row's `source` names
  // the model key, whose channel is the `…Provider` with the same prefix). A
  // stored value the catalog has not caught up with stays listed so the select
  // never renders blank for a saved route.
  const optionsOf = (field: ConfigField): readonly ConfigFieldOption[] | undefined => {
    if (field.type !== 'catalog') return field.options
    const providers = catalog?.providers ?? []
    const stored = String(currentConfig[field.key] ?? '')
    const source = field.source
    const scoping = source === 'answerModel'
      ? currentConfig.answerProvider
      : source === 'summarizeModel'
        ? currentConfig.summarizeProvider
        : null
    const base = scoping === null
      ? providerOptionsOf(providers, source ?? '')
      : source === 'answerModel' && scoping === ''
        ? []
        : modelOptionsOf(providers, scoping)
    return stored !== '' && !base.some(option => option.value === stored)
      ? [...base, { value: stored, label: stored }]
      : base
  }

  return (
    <div className={css.root}>
      <div className={css.rows}>
        {configFields().map((field) => (
          <FieldRow
            // Keyed by the committed value: a failed commit reverts config, the
            // key changes, and the row remounts with the stored value (typing
            // never changes the key, so mid-edit drafts survive re-renders).
            key={`${field.key}:${String(currentConfig[field.key] ?? '')}`}
            field={field}
            value={String(currentConfig[field.key] ?? '')}
            options={optionsOf(field)}
            onCommit={(raw) => onCommit(field, raw)}
          />
        ))}
      </div>
      {error !== null && <div className={css.error} role="alert">{error}</div>}
    </div>
  )
}
