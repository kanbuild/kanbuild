import { Component, type ReactNode } from 'react';

/** Shows the error instead of a blank page when the dashboard crashes. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[dashboard] crashed:', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="app-backdrop min-h-screen p-10">
        <div className="metal-surface mx-auto max-w-2xl space-y-3 rounded-2xl p-6">
        <h1 className="text-lg font-semibold">The dashboard hit an error</h1>
        <p className="text-sm text-muted-foreground">
          Your agents keep running in the background; nothing was lost. Reload the page. If it happens again, stop the backend, run{' '}
          <code className="font-mono">npm start</code> (it rebuilds the dashboard) and reload.
        </p>
        <pre className="metal-inset overflow-auto whitespace-pre-wrap rounded-xl p-3 text-xs">{this.state.error.stack || this.state.error.message}</pre>
        <button className="metal-accent rounded-lg px-3 py-1.5 text-sm font-medium" onClick={() => location.reload()}>
          Reload
        </button>
        </div>
      </div>
    );
  }
}
