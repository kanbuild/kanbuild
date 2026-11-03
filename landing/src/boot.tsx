import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@/index.css';
import { applyTheme } from '@/theme';

/** Shared entry: same font, tokens and theme handling (system / light / dark, `orch:theme`) as the dashboard. */
export function mount(node: ReactNode) {
  applyTheme();
  createRoot(document.getElementById('root')!).render(<StrictMode>{node}</StrictMode>);
}
