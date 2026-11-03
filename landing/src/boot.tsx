import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';

/** Shared entry: same dark-mode rule as the dashboard (follow the OS, checked once). */
export function mount(node: ReactNode) {
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) document.documentElement.classList.add('dark');
  createRoot(document.getElementById('root')!).render(<StrictMode>{node}</StrictMode>);
}
