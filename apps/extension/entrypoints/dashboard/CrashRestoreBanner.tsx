import { Button, Card } from "@tabburrow/ui";

export interface CrashRestoreBannerProps {
  busy: boolean;
  onRestore: () => void;
  onDismiss: () => void;
}

/**
 * Top-of-main banner offering to restore the newest auto snapshot after
 * `background.ts`'s `chrome.runtime.onStartup` handler detected the
 * previous browser session never reached a clean `chrome.windows.onRemoved`
 * shutdown — i.e. Chrome (or the OS) went away without warning. `App.tsx`
 * only ever mounts this when `lib/sessions.ts`'s `shouldOfferCrashRestore`
 * says so (a crash was flagged AND an auto snapshot actually exists to
 * restore); both actions here always clear the "crashDetected" meta flag,
 * win or lose, so the banner never reappears for the same crash.
 */
export function CrashRestoreBanner({ busy, onRestore, onDismiss }: CrashRestoreBannerProps) {
  return (
    <Card
      variant="surface"
      arch={false}
      role="status"
      className="flex items-center justify-between gap-4 p-4"
      style={{ borderLeft: "3px solid var(--accent)" }}
    >
      <p className="text-sm text-[var(--text)]">Looks like Chrome closed unexpectedly. Restore your last session?</p>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" onClick={onRestore} disabled={busy}>
          Restore last session
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss} disabled={busy}>
          Dismiss
        </Button>
      </div>
    </Card>
  );
}
