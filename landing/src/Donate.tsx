import { useEffect, useState } from 'react';
import { ArrowLeft, Download, Github, Heart, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Container, Page } from './Chrome';
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
    <Page home="../">
      <Container className="flex flex-col items-center py-16 text-center sm:py-24">
        {downloading && (
          <div className="metal-inset mb-12 flex w-full max-w-2xl flex-col items-center gap-3 rounded-2xl px-5 py-4 text-sm sm:flex-row sm:justify-between sm:text-left">
            <span className="flex items-center gap-2.5">
              <span className="metal-accent flex h-7 w-7 shrink-0 items-center justify-center rounded-full">
                <Download className="h-3.5 w-3.5" />
              </span>
              Thanks for downloading Kanbuild! Your download should start in a moment.
            </span>
            <Button size="pill" variant="outline" onClick={startDownload} className="shrink-0">
              Retry download
            </Button>
          </div>
        )}

        <Badge variant="gold" className="mb-5">
          Free &amp; open source
        </Badge>
        <h1 className="chrome-text max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">Kanbuild is free. Help keep it that way.</h1>
        <p className="mt-5 max-w-xl text-sm leading-6 text-muted-foreground">
          Kanbuild is MIT licensed and built in the open, with no account, no telemetry and no paywall. If it saves you time, a one-off donation funds new
          features, fixes and the Mac app's signing costs.
        </p>

        <div className="metal-surface mt-10 w-full max-w-md rounded-2xl p-6">
          <div className="metal-gold mx-auto flex h-12 w-12 items-center justify-center rounded-2xl">
            <Heart className="h-5 w-5" />
          </div>
          <h2 className="mt-4 font-semibold">Support development</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">Pay what you like, securely through Stripe.</p>
          {STRIPE_PAYMENT_LINK ? (
            <Button asChild variant="gold" size="lg" className="sheen mt-6 w-full shadow-gold-glow">
              <a href={STRIPE_PAYMENT_LINK} target="_blank" rel="noopener noreferrer">
                <Heart /> Support Kanbuild
              </a>
            </Button>
          ) : (
            <Button variant="gold" size="lg" className="mt-6 w-full" disabled>
              <Heart /> Donations coming soon
            </Button>
          )}
          <p className="mt-3 text-[11px] text-muted-foreground">Donations are optional and don't unlock anything. Kanbuild is the same for everyone.</p>
        </div>

        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Button asChild variant="chrome">
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
    </Page>
  );
}
