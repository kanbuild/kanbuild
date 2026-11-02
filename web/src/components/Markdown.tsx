import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Markdown with GitHub extensions (tables, task lists) for plans, reviews and reports. */
export function Markdown({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>;
}
