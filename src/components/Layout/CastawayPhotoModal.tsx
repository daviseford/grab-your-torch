import { Modal } from "@mantine/core";
import { useState } from "react";
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
  const [source, setSource] = useState(
    (photoSources as Record<string, string>)[img] ?? img,
  );

  return (
    <Modal
      opened
      returnFocus={false}
      onClose={onClose}
      title={name}
      size="auto"
      padding="sm"
      xOffset={12}
      yOffset={12}
      centered
      closeButtonProps={{ "aria-label": "Close photo" }}
    >
      <img
        className={classes.photo}
        src={source}
        alt={imgAlt ?? name}
        onError={() => setSource(img)}
      />
    </Modal>
  );
};
