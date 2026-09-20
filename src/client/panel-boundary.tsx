/**
 * In-panel containment for this plugin's two tab bodies.
 *
 * DSH's own per-entry boundary does NOT isolate a crashed tab body in place: it
 * ABDICATES the registration (`ui-slots/src/index.ts:1541`, `abdicated.add(entry)`),
 * which retires the tab body for EVERY session until the page reloads. The user
 * sees exactly one thing — the panel goes blank and re-opening the tab cannot
 * bring it back — and there is no message anywhere in the UI explaining why.
 * That is the failure mode this boundary removes: a render (or effect) error
 * inside OUR subtree is caught here, rendered as a readable strip with a 重试
 * button, and the tab stays alive and re-renderable.
 *
 * It is deliberately the OUTERMOST thing this plugin contributes to a tab body
 * (see `sidebar-native.ts`'s `bodyFor`), because everything else in the subtree —
 * including the host-provided hooks the panels call — is a place a future
 * upstream change can break.
 */
import { Component, createElement, type ComponentType, type ErrorInfo, type ReactElement, type ReactNode } from 'react'
import type { SidebarqaTabComponentProps } from '../context-types.ts'
import { t } from './locales.ts'
import { useLocaleRevision } from './use-locale.ts'
import css from './panel-boundary.module.css'

export interface PanelBoundaryProps {
  /**
   * Identity of the panel's scope (the session id). A change re-attempts the
   * render instead of keeping the stale crash face: switching conversations is
   * the user's most natural recovery, and it must not require a reload.
   */
  resetKey: string
  children: ReactNode
}

/**
 * Mount one panel INSIDE the boundary.
 *
 * Takes the component and its props rather than a ready-made element, which makes
 * the mistake this function exists to prevent a TYPE error instead of a silent
 * one: calling the panel (`component(props)`, the shape this plugin used before
 * the boundary existed) runs it in the CALLER's render, where the boundary above
 * it cannot catch anything. Only React may mount the panel.
 * @param resetKey - the panel's scope identity (see {@link PanelBoundaryProps}).
 * @param Panel - the panel component.
 * @param props - the panel's props.
 * @returns the contained element to return from the tab body.
 */
export function containPanel(
  resetKey: string,
  Panel: ComponentType<SidebarqaTabComponentProps>,
  props: SidebarqaTabComponentProps,
): ReactElement {
  return createElement(PanelBoundary, { resetKey, children: createElement(Panel, props) })
}

interface PanelBoundaryState {
  /** The contained failure, or null while the panel renders normally. */
  error: Error | null
  /** The `resetKey` the state above belongs to. */
  resetKey: string
}

/**
 * Contain one panel subtree's failures so the tab body is never retired.
 */
export class PanelBoundary extends Component<PanelBoundaryProps, PanelBoundaryState> {
  override state: PanelBoundaryState = { error: null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error: unknown): Partial<PanelBoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  /**
   * Drop the crash face when the panel moves to another scope.
   * @param props - the incoming props.
   * @param state - the current state.
   * @returns the next state, or null when nothing changes.
   */
  static getDerivedStateFromProps(
    props: PanelBoundaryProps,
    state: PanelBoundaryState,
  ): Partial<PanelBoundaryState> | null {
    if (state.resetKey === props.resetKey) return null
    return { error: null, resetKey: props.resetKey }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // The console is the only place the raw failure can stay verbatim; the strip
    // above it is localized chrome. Kept as one line so a future report can be
    // matched to the panel it came from.
    console.error('[dsh-sidebar-qa] a panel failed to render; contained in place:', error, info.componentStack)
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children
    return <PanelCrashFace error={this.state.error} onRetry={() => { this.setState({ error: null }) }} />
  }
}

/**
 * The crash face. A FUNCTION component on purpose: the class cannot subscribe to
 * the locale revision, and this strip is user-visible copy like any other.
 * @param props.error - the contained failure.
 * @param props.onRetry - clears the boundary and re-renders the panel.
 */
function PanelCrashFace({ error, onRetry }: { error: Error; onRetry: () => void }) {
  useLocaleRevision()
  return (
    <div className={css.root} role="alert">
      <div className={css.title}>{t('errPanelCrashed', { detail: error.message })}</div>
      <div className={css.hint}>{t('panelCrashHint')}</div>
      <button type="button" className={css.retry} onClick={onRetry}>{t('commonRetry')}</button>
    </div>
  )
}
