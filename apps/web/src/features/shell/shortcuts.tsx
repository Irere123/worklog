import * as stylex from "@stylexjs/stylex";

import { Kbd } from "#ui/chip";
import { Dialog } from "#ui/overlay";
import { color, space, text } from "#ui/tokens.stylex";

const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: "General",
    keys: [
      ["⌘ K", "Command menu"],
      ["?", "Keyboard shortcuts"],
      ["C", "New card"],
      ["B", "New board"],
      ["L", "Log work"],
      ["P", "Pinned cards"],
      ["F", "Filter the board"],
      ["Esc", "Close or go back"],
      ["← ↑ → ↓", "Move between cards on a board"],
    ],
  },
  {
    title: "Navigate",
    keys: [
      ["1", "Home"],
      ["2", "Assigned to me"],
      ["3", "Added by me"],
      ["G H", "Home"],
      ["G I", "Inbox"],
      ["G A", "Activity"],
      ["G B", "Boards"],
      ["G C", "Assistant"],
      ["G R", "Briefs"],
      ["G P", "People"],
      ["G S", "Settings"],
    ],
  },
  {
    title: "Inbox",
    keys: [
      ["J K", "Next and previous"],
      ["↵", "Open"],
      ["E", "Done"],
      ["H", "Snooze until tomorrow"],
      ["X", "Dismiss"],
      ["Y", "Allow (approvals)"],
      ["N", "Deny (approvals)"],
      ["Z", "Undo"],
    ],
  },
  {
    title: "Card",
    keys: [
      ["1–9", "Send a Maybe? card to a column"],
      ["E", "Edit the title"],
      ["A", "Choose assignees"],
      ["M", "Assign to me"],
      ["T", "Tag"],
      ["D or ]", "Done"],
      ["[", "Not now"],
      ["⇧ G", "Golden ticket"],
      ["⇧ P", "Pin or unpin"],
      ["⇧ N", "Watch or stop watching"],
      ["⌘ ↵", "Send comment"],
    ],
  },
  {
    title: "Assistant",
    keys: [
      ["↵", "Send"],
      ["⇧ ↵", "New line"],
      ["Esc", "Stop the reply"],
    ],
  },
];

export function Shortcuts({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
        }
      }}
      title="Keyboard shortcuts"
      size="lg"
    >
      <div {...stylex.props(styles.grid)}>
        {GROUPS.map((group) => (
          <section key={group.title} {...stylex.props(styles.group)}>
            <h3 {...stylex.props(styles.title)}>{group.title}</h3>
            <dl>
              {group.keys.map(([keys, label]) => (
                <div key={label} {...stylex.props(styles.row)}>
                  <dt {...stylex.props(styles.label)}>{label}</dt>
                  <dd>
                    <Kbd>{keys}</Kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

const styles = stylex.create({
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: space.x3,
    paddingInline: space.xl,
    paddingBottom: space.xl,
    overflowY: "auto",
  },
  group: { display: "flex", flexDirection: "column", gap: space.sm },
  title: { fontSize: text.caption, fontWeight: 500, color: color.fgFaint },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    height: 28,
  },
  label: { fontSize: text.label, color: color.fg },
});
