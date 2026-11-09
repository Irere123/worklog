import { PlusIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import type { Schemas } from "#api/client";
import { q } from "#api/queries";
import { AutomationDialog } from "#features/settings/automations";
import { RoutineList } from "#features/settings/routine-list";
import { Button } from "#ui/button";
import { Section } from "#ui/layout";
import { color, leading, radius, space, text } from "#ui/tokens.stylex";

type Automation = Schemas["Automation"];

/**
 * The work the assistant does without being asked, on the page where you'd look for it rather
 * than only in settings.
 */
export function Routines() {
  const automations = useQuery(q.automations());
  const [editing, setEditing] = useState<Automation | "new" | null>(null);
  if (!automations.data) {
    return null;
  }
  return (
    <Section
      title="Routines"
      aside={
        <Button
          size="sm"
          variant="ghost"
          icon={<PlusIcon size={14} />}
          onClick={() => setEditing("new")}
        >
          New routine
        </Button>
      }
    >
      {automations.data.length === 0 ? (
        <p {...stylex.props(styles.none)}>
          Nothing runs on its own yet. Ask for something on a schedule (“every
          Monday, tell me what slipped”) and your assistant will suggest a
          routine for you to allow.
        </p>
      ) : (
        <div {...stylex.props(styles.frame)}>
          <RoutineList routines={automations.data} onEdit={setEditing} />
        </div>
      )}
      {editing !== null && (
        <AutomationDialog
          automation={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Section>
  );
}

const styles = stylex.create({
  frame: {
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: color.line,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  none: {
    margin: 0,
    paddingInline: space.sm,
    fontSize: text.label,
    lineHeight: leading.label,
    color: color.fgMuted,
    textWrap: "pretty",
  },
});
