import { Button, Badge } from "@tabburrow/ui";

export interface SaveBarProps {
  onSaveCurrent: () => void;
  onSaveAll: () => void;
  onSaveSelected: () => void;
  /** Total http(s) tab count in the current window, shown as a badge on "Save all tabs". */
  allCount: number;
  /** "Save selected" only renders when 2+ tabs are highlighted. */
  showSelected: boolean;
  disabled?: boolean;
}

/**
 * The popup's three save actions: primary "Save this tab", secondary
 * "Save all tabs" (with a count badge), and a ghost "Save selected" that
 * only appears once 2+ tabs are highlighted in the tab strip.
 */
export function SaveBar({
  onSaveCurrent,
  onSaveAll,
  onSaveSelected,
  allCount,
  showSelected,
  disabled,
}: SaveBarProps) {
  return (
    <div className="flex flex-col gap-2">
      <Button variant="primary" onClick={onSaveCurrent} disabled={disabled} className="w-full">
        Save this tab
      </Button>
      <Button variant="ghost" onClick={onSaveAll} disabled={disabled} className="w-full">
        {/* A nested flex row (rather than overriding Button's own justify-center)
            keeps this deterministic regardless of Tailwind's utility ordering. */}
        <span className="flex w-full items-center justify-between">
          <span>Save all tabs</span>
          <Badge variant="muted">{allCount}</Badge>
        </span>
      </Button>
      {showSelected ? (
        <Button variant="ghost" onClick={onSaveSelected} disabled={disabled} className="w-full">
          Save selected
        </Button>
      ) : null}
    </div>
  );
}
