/**
 * The plugin's configuration page, as a DSH settings section.
 *
 * This module is only the PAGE. Where it is registered, and why that seat, lives in
 * `settings-slot.ts` — which keeps the registration testable under the `node`
 * environment that this file's CSS import rules out.
 *
 * `ConfigPanel` never knew about the sidebar framework it used to hang off: it writes
 * the host's `sidebarqa` namespace through this plugin's own revision-guarded API. So
 * nothing about it changes here except who renders it.
 */
import { ConfigPanel } from './ConfigPanel.tsx'
import { t } from './locales.ts'
import { useLocaleRevision } from './use-locale.ts'
import css from './config-panel.module.css'

/** The section body. Rendered by DSH's settings shell, so it takes no props. */
export function ConfigSection(): unknown {
  // Follow the DSH language: t() reads at call time, so this root re-render
  // re-localizes the heading and the description; ConfigPanel subscribes for its own
  // rows (and must stay free of React.memo for the same reason).
  useLocaleRevision()
  return (
    <div className={css.section}>
      <h2 className={css.sectionTitle}>{t('cfgSectionTitle')}</h2>
      <p className={css.sectionDesc}>{t('cfgSectionDesc')}</p>
      <ConfigPanel />
    </div>
  )
}
