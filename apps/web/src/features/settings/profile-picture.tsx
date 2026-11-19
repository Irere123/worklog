import { CameraIcon, TrashIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, WheelEvent } from "react";
import { toast } from "sonner";

import type { Schemas } from "#api/client";
import { api, unwrap } from "#api/client";
import { Avatar } from "#ui/avatar";
import { Button } from "#ui/button";
import { Slider } from "#ui/field";
import { Dialog, Menu, MenuItem } from "#ui/overlay";
import { color, media, motion, radius, space } from "#ui/tokens.stylex";

type Member = Schemas["Member"];

const SIZE = 72;
const CROP_SIZE = 280;
const STORED_SIZE = 512;
const MAX_ZOOM = 4;
const JPEG_GROUND = "white";

/**
 * Your picture, which you change by clicking it or dropping a photo on it. A photo is cropped to
 * a square here and uploaded already small, so a 12 MB phone photo never leaves the device whole.
 */
export function ProfilePicture({ member }: { member: Member }) {
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(
    () => () => {
      if (photo) {
        URL.revokeObjectURL(photo.src);
      }
    },
    [photo]
  );

  const save = useMutation({
    mutationFn: async (image: Blob) =>
      await unwrap(
        api.PUT("/v1/me/avatar", {
          body: "",
          bodySerializer: () => image,
          headers: { "content-type": image.type },
        })
      ),
    onSuccess: () => {
      setPhoto(null);
      void client.invalidateQueries({ queryKey: ["me"] });
      void client.invalidateQueries({ queryKey: ["members"] });
      toast.success("Picture updated");
    },
    onError: (error) =>
      toast.error(`Your picture didn't upload. ${error.message}`),
  });

  const remove = useMutation({
    mutationFn: async () =>
      await unwrap(api.PATCH("/v1/me", { body: { avatarUrl: null } })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["me"] });
      void client.invalidateQueries({ queryKey: ["members"] });
      toast.success("Picture removed");
    },
    onError: (error) => toast.error(error.message),
  });

  const open = (file: File | undefined) => {
    if (!file) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error(`${file.name} isn't a picture. Choose a JPG, PNG or WebP.`);
      return;
    }
    void readImage(file).then(setPhoto, () =>
      toast.error(
        `This browser can't open ${file.name}. Try a JPG, PNG or WebP.`
      )
    );
  };
  const choose = () => input.current?.click();
  const busy = save.isPending || remove.isPending;

  const face = (
    <button
      type="button"
      aria-label={member.avatarUrl ? "Change your picture" : "Upload a picture"}
      disabled={busy}
      onClick={member.avatarUrl ? undefined : choose}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        open(e.dataTransfer.files[0]);
      }}
      {...stylex.props(styles.face, dragging && styles.dropping)}
    >
      <Avatar person={member} size={SIZE} />
      <span aria-hidden {...stylex.props(styles.badge)}>
        <CameraIcon size={14} weight="fill" />
      </span>
    </button>
  );

  return (
    <div {...stylex.props(styles.root)}>
      {member.avatarUrl ? (
        <Menu trigger={face}>
          <MenuItem icon={<UploadSimpleIcon size={14} />} onClick={choose}>
            Upload a new picture…
          </MenuItem>
          <MenuItem
            icon={<TrashIcon size={14} />}
            danger
            onClick={() => remove.mutate()}
          >
            Remove picture
          </MenuItem>
        </Menu>
      ) : (
        face
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          open(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <Crop
        key={photo?.src}
        photo={photo}
        busy={save.isPending}
        onCancel={() => setPhoto(null)}
        onSave={(image) => save.mutate(image)}
      />
    </div>
  );
}

type Frame = { zoom: number; x: number; y: number };

function Crop({
  photo,
  busy,
  onCancel,
  onSave,
}: {
  photo: HTMLImageElement | null;
  busy: boolean;
  onCancel: () => void;
  onSave: (image: Blob) => void;
}) {
  const [frame, setFrame] = useState<Frame>({ zoom: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; from: Frame } | null>(null);

  if (!photo) {
    return null;
  }
  const fit = CROP_SIZE / Math.min(photo.naturalWidth, photo.naturalHeight);
  const place = (next: Frame) => {
    const zoom = Math.min(MAX_ZOOM, Math.max(1, next.zoom));
    const spareX = (photo.naturalWidth * fit * zoom - CROP_SIZE) / 2;
    const spareY = (photo.naturalHeight * fit * zoom - CROP_SIZE) / 2;
    return {
      zoom,
      x: Math.min(spareX, Math.max(-spareX, next.x)),
      y: Math.min(spareY, Math.max(-spareY, next.y)),
    };
  };
  const move = (next: Frame) => setFrame(place(next));
  const scale = fit * frame.zoom;

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, from: frame };
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const start = drag.current;
    if (start) {
      move({
        ...start.from,
        x: start.from.x + e.clientX - start.x,
        y: start.from.y + e.clientY - start.y,
      });
    }
  };
  const onWheel = (e: WheelEvent<HTMLButtonElement>) =>
    move({ ...frame, zoom: frame.zoom * Math.exp(-e.deltaY / 400) });
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const by = e.shiftKey ? 40 : 8;
    const nudge: Record<string, Partial<Frame>> = {
      ArrowLeft: { x: frame.x + by },
      ArrowRight: { x: frame.x - by },
      ArrowUp: { y: frame.y + by },
      ArrowDown: { y: frame.y - by },
      "+": { zoom: frame.zoom * 1.1 },
      "=": { zoom: frame.zoom * 1.1 },
      "-": { zoom: frame.zoom / 1.1 },
    };
    const step = nudge[e.key];
    if (step) {
      e.preventDefault();
      move({ ...frame, ...step });
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) {
          onCancel();
        }
      }}
      title="Crop your picture"
      description="Drag to move it and zoom to fit. Teammates see what's inside the circle."
      size="sm"
      footer={
        <>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            busy={busy}
            onClick={() => {
              void render(photo, frame, fit).then(onSave, () =>
                toast.error("That picture couldn't be prepared. Try another.")
              );
            }}
          >
            Save picture
          </Button>
        </>
      }
    >
      <div {...stylex.props(styles.body)}>
        <button
          type="button"
          aria-label="Picture position. Drag, or use the arrow keys to move and + or − to zoom."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onWheel={onWheel}
          onKeyDown={onKeyDown}
          {...stylex.props(styles.stage)}
        >
          <img
            src={photo.src}
            alt=""
            draggable={false}
            {...stylex.props(
              styles.photo(
                photo.naturalWidth * scale,
                photo.naturalHeight * scale,
                frame.x,
                frame.y
              )
            )}
          />
          <span aria-hidden {...stylex.props(styles.circle)} />
        </button>
        <Slider
          label="Zoom"
          value={frame.zoom}
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          onValueChange={(zoom) => move({ ...frame, zoom })}
          sx={styles.zoom}
        />
      </div>
    </Dialog>
  );
}

async function readImage(file: File) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  return image;
}

async function render(photo: HTMLImageElement, frame: Frame, fit: number) {
  const scale = fit * frame.zoom;
  const side = CROP_SIZE / scale;
  const left = photo.naturalWidth / 2 - (CROP_SIZE / 2 + frame.x) / scale;
  const top = photo.naturalHeight / 2 - (CROP_SIZE / 2 + frame.y) / scale;
  const draw = (background: string | null) => {
    const canvas = new OffscreenCanvas(STORED_SIZE, STORED_SIZE);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("No 2D canvas");
    }
    if (background) {
      context.fillStyle = background;
      context.fillRect(0, 0, STORED_SIZE, STORED_SIZE);
    }
    context.imageSmoothingQuality = "high";
    context.drawImage(
      photo,
      left,
      top,
      side,
      side,
      0,
      0,
      STORED_SIZE,
      STORED_SIZE
    );
    return canvas;
  };
  const webp = await draw(null).convertToBlob({
    type: "image/webp",
    quality: 0.9,
  });
  return webp.type === "image/webp"
    ? webp
    : await draw(JPEG_GROUND).convertToBlob({
        type: "image/jpeg",
        quality: 0.9,
      });
}

const styles = stylex.create({
  root: { flexShrink: 0 },
  face: {
    position: "relative",
    display: "grid",
    borderRadius: "50%",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${color.focus}` },
    outlineOffset: 3,
    opacity: { default: 1, ":disabled": 0.6 },
    filter: {
      default: null,
      ":hover": { default: null, [media.hover]: "brightness(0.94)" },
    },
    transitionProperty: "filter",
    transitionDuration: motion.fast,
  },
  dropping: { outline: `2px dashed ${color.accent}`, outlineOffset: 3 },
  badge: {
    position: "absolute",
    insetInlineEnd: -2,
    insetBlockEnd: -2,
    display: "grid",
    placeItems: "center",
    width: 26,
    height: 26,
    borderRadius: "50%",
    color: color.fg,
    backgroundColor: color.surface,
    boxShadow: `0 0 0 1px ${color.lineUi}`,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.lg,
    paddingInline: space.xl,
    paddingBottom: space.lg,
  },
  stage: {
    position: "relative",
    width: CROP_SIZE,
    height: CROP_SIZE,
    overflow: "hidden",
    borderRadius: radius.md,
    backgroundColor: color.ui,
    cursor: { default: "grab", ":active": "grabbing" },
    touchAction: "none",
    userSelect: "none",
    outline: { default: "none", ":focus-visible": `2px solid ${color.focus}` },
    outlineOffset: 2,
  },
  photo: (width: number, height: number, x: number, y: number) => ({
    position: "absolute",
    top: "50%",
    left: "50%",
    width,
    height,
    maxWidth: "none",
    transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
    pointerEvents: "none",
  }),
  circle: {
    position: "absolute",
    inset: 0,
    borderRadius: "50%",
    boxShadow: `0 0 0 ${CROP_SIZE}px ${color.veil}`,
    pointerEvents: "none",
  },
  zoom: { maxWidth: CROP_SIZE },
});
