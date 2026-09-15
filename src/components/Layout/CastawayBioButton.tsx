import { Button, Modal } from "@mantine/core";
import { useRef, useState } from "react";
import type { Player } from "../../types";
import { CastawayBioFacts } from "./CastawayBioFacts";

/** Opens the preseason profile in its own dialog. See CastawayBioFacts. */
export const CastawayBioButton = ({ player }: { player: Player }) => {
  const [opened, setOpened] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  return (
    <>
      <Button
        ref={trigger}
        variant="subtle"
        size="compact-xs"
        onClick={() => setOpened(true)}
        aria-label={`View bio for ${player.full_name}`}
        aria-haspopup="dialog"
      >
        Bio
      </Button>
      {opened && (
        <Modal
          opened
          returnFocus={false}
          onClose={() => {
            setOpened(false);
            requestAnimationFrame(() => trigger.current?.focus());
          }}
          title={`About ${player.full_name}`}
          size="md"
          centered
        >
          <CastawayBioFacts player={player} />
        </Modal>
      )}
    </>
  );
};
