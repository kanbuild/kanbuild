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
      <div className="mx-auto max-w-2xl space-y-3 p-10">
        <h1 className="text-lg font-semibold">The dashboard hit an error</h1>
        <p className="text-sm text-muted-foreground">
          Your agents keep running in the background; nothing was lost. Reload the page. If it happens again, stop the backend, run{' '}
          <code className="font-mono">npm start</code> (it rebuilds the dashboard) and reload.
        </p>
        <pre className="overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{this.state.error.stack || this.state.error.message}</pre>
        <button className="rounded-md border px-3 py-1.5 text-sm" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
