import { Button, Modal } from "@mantine/core";
import { IconZoomIn, IconZoomOut } from "@tabler/icons-react";
import { useLayoutEffect, useRef, useState } from "react";
import photoSources from "../../data/castawayPhotos.json";
import classes from "./CastawayPhotoModal.module.css";

export const CastawayPhotoModal = ({
  name,
  img,
  imgAlt,
  onClose,
}: {
  name: string;
  img: string;
  imgAlt?: string;
  onClose: () => void;
}) => {
  const [zoomed, setZoomed] = useState(false);
  const [nativeWidth, setNativeWidth] = useState(0);
  const [source, setSource] = useState(
    (photoSources as Record<string, string>)[img] ?? img,
  );
  const viewport = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const region = viewport.current;
    if (!region) return;
    region.scrollTo({
      left: zoomed ? (region.scrollWidth - region.clientWidth) / 2 : 0,
      top: 0,
    });
  }, [zoomed, nativeWidth]);

  return (
    <Modal
      opened
      returnFocus={false}
      onClose={onClose}
      title={name}
      size="min(960px, calc(100vw - 24px))"
      padding="sm"
      yOffset={12}
      centered
      closeButtonProps={{ "aria-label": "Close photo" }}
    >
      <div className={classes.toolbar}>
        <Button
          variant="default"
          size="sm"
          leftSection={
            zoomed ? <IconZoomOut size={18} /> : <IconZoomIn size={18} />
          }
          aria-pressed={zoomed}
          onClick={() => setZoomed(!zoomed)}
        >
          {zoomed ? "Fit photo" : "Zoom in"}
        </Button>
        <span className={classes.hint}>
          {zoomed ? "Scroll to explore the photo." : "Full photo, uncropped."}
        </span>
      </div>
      <div
        ref={viewport}
        className={classes.viewport}
        role="region"
        aria-label={`Photo of ${name}`}
        tabIndex={0}
      >
        <img
          className={[classes.photo, zoomed && classes.zoomed]
            .filter(Boolean)
            .join(" ")}
          src={source}
          alt={imgAlt ?? name}
          style={zoomed ? { width: `max(200%, ${nativeWidth}px)` } : undefined}
          onLoad={(event) => setNativeWidth(event.currentTarget.naturalWidth)}
          onError={() => setSource(img)}
        />
      </div>
    </Modal>
  );
};
