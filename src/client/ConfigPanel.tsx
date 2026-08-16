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
import { CONFIG_FIELDS, coerceNumberField, type ConfigField } from './config-fields.ts'
import css from './config-panel.module.css'

/** Map one wire failure to an inline message (the conflict gets friendly copy). */
function messageOf(error: unknown): string {
  if (error instanceof Error && 'code' in error && (error as { code?: unknown }).code === 'settings-conflict') {
    return '保存失败：配置已在其他窗口被修改，请重试'
  }
  return `保存失败：${error instanceof Error ? error.message : String(error)}`
}

/** One config row: a controlled input with a local draft committed on blur/Enter. */
function FieldRow(props: {
  field: ConfigField
  value: string
  onCommit: (raw: string) => string
}): ReactElement {
  const { field, value, onCommit } = props
  const [draft, setDraft] = useState(value)
  const number = field.type === 'number'
  const commit = (raw: string): void => { setDraft(onCommit(raw)) }
  return (
    <div className={css.row}>
      <span className={css.rowText}>
        <span className={css.title}>{field.label}</span>
        {field.desc !== undefined && field.desc !== '' && <span className={css.desc}>{field.desc}</span>}
      </span>
      {field.type === 'select' ? (
        <select
          className={css.select}
          value={draft}
          aria-label={field.label}
          onChange={(event) => { commit(event.currentTarget.value) }}
        >
          {field.options?.map((option) => (
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
  const [config, setConfig] = useState<SidebarqaConfigView | null>(null)
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
    commit({ [field.key]: raw })
    return raw
  }

  if (config === null) {
    return <div className={css.loading}>加载配置…</div>
  }

  return (
    <div className={css.root}>
      <div className={css.rows}>
        {CONFIG_FIELDS.map((field) => (
          <FieldRow
            // Keyed by the committed value: a failed commit reverts config, the
            // key changes, and the row remounts with the stored value (typing
            // never changes the key, so mid-edit drafts survive re-renders).
            key={`${field.key}:${String(config[field.key] ?? '')}`}
            field={field}
            value={String(config[field.key] ?? '')}
            onCommit={(raw) => onCommit(field, raw)}
          />
        ))}
      </div>
      {error !== null && <div className={css.error} role="alert">{error}</div>}
    </div>
  )
}
