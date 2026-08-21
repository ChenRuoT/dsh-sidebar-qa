/**
 * The AskPanel's history-strategy selector: a chip trigger + anchored dropdown
 * in the exact chrome of the host composer's access-mode control
 * (PermissionSelect) — same trigger geometry, hover fill, chevron rotation and
 * menu material, driven by the primitives Menu. Replaces the plain <select>
 * so the composer row reads as one DSH-style control set.
 */
import { useState, type ReactNode } from 'react'
import { IconChevronDownOutline14, Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarqaHistoryStrategy } from '../config.ts'
import { historyStrategyOptions } from './config-fields.ts'
import { t } from './locales.ts'
import css from './ask-panel.module.css'

/** Join truthy class names (no clsx dependency in this package). */
function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ')
}

/* Strategy glyphs (16 viewBox, currentColor; drawn to match the permission
   shield set's stroke weight so the chips read as the same family). */

/** inherit: a fork — the side thread splits off the main lineage. */
function InheritGlyph(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 13.5V8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M8 8.5C8 6 5.5 5.5 4 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M8 8.5C8 6 10.5 5.5 12 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="8" cy="13.5" r="1.1" fill="currentColor" />
      <circle cx="4" cy="4.5" r="1.1" fill="currentColor" />
      <circle cx="12" cy="4.5" r="1.1" fill="currentColor" />
    </svg>
  )
}

/** compressed: stacked bars narrowing upward. */
function CompressedGlyph(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="3" y="10.5" width="10" height="2" rx="1" fill="currentColor" />
      <rect x="4.5" y="7" width="7" height="2" rx="1" fill="currentColor" />
      <rect x="6" y="3.5" width="4" height="2" rx="1" fill="currentColor" />
    </svg>
  )
}

/** trim: a strip with a scissor cut. */
function TrimGlyph(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2.5" y="6.75" width="11" height="2.5" rx="1.25" fill="currentColor" />
      <path d="M9 9.25L11 7.25" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="11.8" cy="11.5" r="1.1" fill="currentColor" />
    </svg>
  )
}

/** Glyph for one strategy value (the chips' leading icon). */
function strategyGlyph(value: SidebarqaHistoryStrategy): ReactNode {
  if (value === 'inherit') return <InheritGlyph />
  if (value === 'trim') return <TrimGlyph />
  return <CompressedGlyph />
}

export interface StrategySelectProps {
  value: SidebarqaHistoryStrategy
  onChange: (value: SidebarqaHistoryStrategy) => void
  disabled?: boolean
}

/**
 * The strategy chip: current strategy glyph + label + chevron, opening an
 * anchored dropdown (side top — the composer row sits at the panel bottom).
 */
export function StrategySelect({ value, onChange, disabled = false }: StrategySelectProps) {
  const [open, setOpen] = useState(false)
  // Resolved per render: the labels follow the active DSH language.
  const options = historyStrategyOptions()
  const current = options.find(option => option.value === value) ?? options[1]!

  const items: MenuEntry[] = options.map(option => ({
    id: option.value,
    label: option.label,
    ...{ icon: strategyGlyph(option.value as SidebarqaHistoryStrategy) },
  }))

  return (
    <Menu
      open={open}
      items={items}
      selectedId={value}
      onSelect={(id) => {
        setOpen(false)
        onChange(id as SidebarqaHistoryStrategy)
      }}
      onClose={() => { setOpen(false) }}
      side="top"
      align="start"
      anchor={
        <button
          type="button"
          className={css.chip}
          aria-label={t('strategyAria', { label: current.label })}
          title={current.label}
          disabled={disabled}
          onClick={() => { setOpen(!open) }}
        >
          <span className={css.chipIcon} aria-hidden>{strategyGlyph(value)}</span>
          <span className={css.chipLabel}>{current.label}</span>
          <span className={cx(css.chipChevron, open && css.chipChevronOpen)} aria-hidden>
            <IconChevronDownOutline14 />
          </span>
        </button>
      }
    />
  )
}
