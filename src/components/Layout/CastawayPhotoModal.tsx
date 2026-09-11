import { ActionIcon, Modal } from "@mantine/core";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import photoSources from "../../data/castawayPhotos.json";
import classes from "./CastawayPhotoModal.module.css";

export type CastawayPhoto = {
  id: string;
  name: string;
  img: string;
  meta?: ReactNode;
  action?: ReactNode;
  status?: string;
};

export const CastawayPhotoModal = ({
  name,
  img,
  imgAlt,
  onClose,
  gallery,
  meta,
}: {
  name: string;
  img: string;
  imgAlt?: string;
  onClose: () => void;
  gallery?: readonly CastawayPhoto[];
  meta?: ReactNode;
}) => {
  const [activeId, setActiveId] = useState(
    gallery?.find((photo) => photo.img === img && photo.name === name)?.id,
  );
  const index = gallery?.findIndex((photo) => photo.id === activeId) ?? -1;
  const current = gallery?.[index];
  const currentName = current?.name ?? name;
  const currentImg = current?.img ?? img;
  const currentMeta = current ? current.meta : meta;
  const nextButton = useRef<HTMLButtonElement>(null);
  const canNavigate = Boolean(gallery && gallery.length > 1);
  useLayoutEffect(() => {
    // A completed draft replaces its focused button with the owner's name.
    // Keep keyboard navigation inside the viewer when that button disappears.
    if (document.activeElement === document.body) nextButton.current?.focus();
  }, [current?.action]);
  const navigate = (direction: number) => {
    if (!gallery?.length) return;
    setActiveId(
      gallery[(index + direction + gallery.length) % gallery.length].id,
    );
  };

  return (
    <Modal
      opened
      returnFocus={false}
      onClose={onClose}
      title={<span aria-live="polite">{currentName}</span>}
      size="auto"
      padding="sm"
      xOffset={12}
      yOffset={12}
      centered
      closeButtonProps={{ "aria-label": "Close photo" }}
      onKeyDown={(event) => {
        if (!canNavigate || event.altKey || event.ctrlKey || event.metaKey)
          return;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          navigate(event.key === "ArrowLeft" ? -1 : 1);
        }
      }}
    >
      <Photo
        key={currentImg}
        img={currentImg}
        alt={current ? currentName : (imgAlt ?? name)}
        hasDetails={Boolean(currentMeta || canNavigate || current?.action)}
      />
      <div className={classes.details}>
        {currentMeta && <div className={classes.bio}>{currentMeta}</div>}
        {(canNavigate || current?.action) && (
          <div className={classes.controls}>
            <ActionIcon
              size={44}
              variant="default"
              aria-label="Previous castaway"
              aria-keyshortcuts="ArrowLeft"
              disabled={!canNavigate}
              onClick={() => navigate(-1)}
            >
              <IconChevronLeft size={22} />
            </ActionIcon>
            <div className={classes.action}>
              {current?.action ?? `${index + 1} of ${gallery?.length}`}
            </div>
            <ActionIcon
              ref={nextButton}
              size={44}
              variant="default"
              aria-label="Next castaway"
              aria-keyshortcuts="ArrowRight"
              disabled={!canNavigate}
              onClick={() => navigate(1)}
            >
              <IconChevronRight size={22} />
            </ActionIcon>
          </div>
        )}
        {current?.status && (
          <p className={classes.status} role="status">
            {current.status}
          </p>
        )}
      </div>
    </Modal>
  );
};

const Photo = ({
  img,
  alt,
  hasDetails,
}: {
  img: string;
  alt: string;
  hasDetails: boolean;
}) => {
  const [source, setSource] = useState(
    (photoSources as Record<string, string>)[img] ?? img,
  );
  return (
    <img
      className={[classes.photo, hasDetails && classes.withDetails]
        .filter(Boolean)
        .join(" ")}
      src={source}
      alt={alt}
      onError={() => setSource(img)}
    />
  );
};
