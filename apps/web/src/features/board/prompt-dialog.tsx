import * as stylex from "@stylexjs/stylex";
import { useId, useState } from "react";

import { Button } from "#ui/button";
import { Field, Input, Select } from "#ui/field";
import { Dialog } from "#ui/overlay";
import { space } from "#ui/tokens.stylex";

type Option = { value: string; label: string };

export function PromptDialog({
  open,
  onClose,
  title,
  label,
  initial,
  placeholder,
  options,
  submitLabel = "Save",
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  label: string;
  initial: string;
  placeholder?: string;
  options?: Option[];
  submitLabel?: string;
  onSubmit: (value: string) => void;
}) {
  const formId = useId();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <PromptForm
        id={formId}
        label={label}
        initial={initial}
        placeholder={placeholder}
        options={options}
        onSubmit={(value) => {
          onSubmit(value);
          onClose();
        }}
      />
    </Dialog>
  );
}

function PromptForm({
  id,
  label,
  initial,
  placeholder,
  options,
  onSubmit,
}: {
  id: string;
  label: string;
  initial: string;
  placeholder?: string;
  options?: Option[];
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <form
      id={id}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(value);
      }}
      {...stylex.props(styles.body)}
    >
      <Field label={label}>
        {(fieldId) =>
          options ? (
            <Select
              id={fieldId}
              autoFocus
              value={value}
              onValueChange={setValue}
              options={options}
            />
          ) : (
            <Input
              id={fieldId}
              autoFocus
              value={value}
              placeholder={placeholder}
              onChange={(e) => setValue(e.target.value)}
            />
          )
        }
      </Field>
    </form>
  );
}

const styles = stylex.create({
  body: {
    display: "flex",
    flexDirection: "column",
    gap: space.lg,
    paddingInline: space.xl,
    paddingBottom: space.xl,
  },
});
