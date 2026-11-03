import { useEffect, useState } from 'react';
import { ArrowLeft, Coffee, Download, Github, Heart, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Container, Footer, Nav } from './Chrome';
import { DOWNLOAD_URL, GITHUB_URL, STRIPE_PAYMENT_LINK } from './config';

function startDownload() {
  // The .dmg is served as an attachment, so the browser downloads it and stays on this page.
  window.location.href = DOWNLOAD_URL;
}

/**
 * `/donate/` — reached after clicking Download (`?download=1` starts the download
 * on load), or directly from the footer / GitHub section.
 */
export function Donate() {
  const [downloading] = useState(() => new URLSearchParams(window.location.search).get('download') === '1');

  useEffect(() => {
    if (!downloading) return;
    const t = window.setTimeout(startDownload, 400);
    return () => window.clearTimeout(t);
  }, [downloading]);

  return (
    <div className="flex min-h-screen flex-col">
      <Nav home="../" />
      <main className="flex-1 border-b">
        <Container className="py-16 sm:py-24">
          {downloading && (
            <div className="mx-auto mb-10 flex max-w-2xl flex-col items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200 sm:flex-row sm:justify-between">
              <span className="flex items-center gap-2">
                <Download className="h-4 w-4 shrink-0" /> Thanks for downloading Kanbuild! Your download should start in a moment.
              </span>
              <Button size="sm" variant="outline" onClick={startDownload} className="shrink-0">
                Retry download
              </Button>
            </div>
          )}

          <div className="mx-auto max-w-2xl text-center">
            <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Heart className="h-5 w-5" />
            </div>
            <Badge variant="violet" className="mb-4">
              Free &amp; open source
            </Badge>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Kanbuild is free. Help keep it that way.</h1>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
              Kanbuild is MIT licensed and built in the open, with no account, no telemetry and no paywall. If it saves you time, a one-off donation
              funds new features, fixes and the Mac app's signing costs.
            </p>
          </div>

          <div className="mx-auto mt-10 max-w-md rounded-lg border bg-card p-6 text-center text-card-foreground shadow-sm">
            <Coffee className="mx-auto h-6 w-6 text-amber-500" />
            <h2 className="mt-3 font-semibold">Support development</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">Pay what you like, securely through Stripe.</p>
            {STRIPE_PAYMENT_LINK ? (
              <Button asChild size="lg" className="mt-6 w-full">
                <a href={STRIPE_PAYMENT_LINK} target="_blank" rel="noopener noreferrer">
                  <Heart /> Donate with Stripe
                </a>
              </Button>
            ) : (
              <Button size="lg" className="mt-6 w-full" disabled>
                <Heart /> Donations coming soon
              </Button>
            )}
            <p className="mt-3 text-[11px] text-muted-foreground">Donations are optional and don't unlock anything. Kanbuild is the same for everyone.</p>
          </div>

          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Button asChild variant="outline">
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                <Star /> Star on GitHub
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={`${GITHUB_URL}/issues`} target="_blank" rel="noopener noreferrer">
                <Github /> Contribute
              </a>
            </Button>
            <Button asChild variant="ghost">
              <a href="../">
                <ArrowLeft /> Back to home
              </a>
            </Button>
          </div>
        </Container>
      </main>
      <Footer home="../" />
    </div>
  );
}
