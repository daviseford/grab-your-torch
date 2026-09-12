import { Badge, Button } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { CastawayCard, StatusBadge } from "../components/Layout";
import type { DraftPick, Player } from "../types";
import classes from "./Draft.module.css";

type DraftCastGridProps = {
  players: Player[];
  picks: DraftPick[];
  viewerUid?: string;
  /** True only on the viewer's turn: the Draft slates are enabled. */
  canDraft: boolean;
  /** The pick just made carries the Ember mark. */
  freshOrder?: number;
  onDraft: (player: Player) => void;
  seasonName: string;
};

const castMeta = (player: Player) => {
  if (!player.age && !player.profession && !player.hometown) return null;
  return (
    <>
      {player.age && <>{player.age}</>}
      {player.age && player.profession && " · "}
      {player.profession && <>{player.profession}</>}
      {(player.age || player.profession) && player.hometown && <br />}
      {player.hometown && <>{player.hometown}</>}
    </>
  );
};

/**
 * The cast as castaway slates. Taken castaways are desaturated and carry
 * their pick number and "Drafted by"; yours keep the League Blue outline;
 * the pick just made is outlined in Ember. The Draft slate is enabled only
 * on the viewer's turn.
 */
export const DraftCastGrid = ({
  players,
  picks,
  viewerUid,
  canDraft,
  freshOrder,
  onDraft,
  seasonName,
}: DraftCastGridProps) => {
  const pickByCastaway = new Map(picks.map((pick) => [pick.castaway_id, pick]));
  // Two columns at 375 px: square portraits keep the first row's Draft slate
  // inside the first screen under the board spine.
  const compact = useMediaQuery("(max-width: 36em)") ?? false;
  const draftAction = (player: Player, inModal = false) => {
    const pick = pickByCastaway.get(player.castaway_id);
    return pick ? (
      <div className={classes.draftedBy}>
        <span className={classes.label}>Drafted by</span>
        <span className={classes.draftedByName}>{pick.user_name}</span>
      </div>
    ) : (
      <Button
        fullWidth
        size={inModal ? "sm" : "xs"}
        variant={canDraft ? "filled" : "default"}
        onClick={() => onDraft(player)}
        disabled={!canDraft}
        aria-label={`Draft ${player.full_name}`}
      >
        Draft
      </Button>
    );
  };
  const photoGallery = players.flatMap((player) =>
    player.img
      ? [
          {
            id: player.castaway_id,
            name: player.full_name,
            img: player.img,
            meta: castMeta(player),
            action: draftAction(player, true),
            status:
              !pickByCastaway.has(player.castaway_id) && !canDraft
                ? "You can draft when it is your turn."
                : undefined,
          },
        ]
      : [],
  );
  return (
    <ul className={classes.castGrid} aria-label={`${seasonName} cast`}>
      {players.map((player) => {
        const pick = pickByCastaway.get(player.castaway_id);
        const isMine = pick?.user_uid === viewerUid;
        const isFresh = pick !== undefined && pick.order === freshOrder;
        return (
          <li key={player.castaway_id}>
            <CastawayCard
              name={player.full_name}
              img={player.img}
              meta={castMeta(player)}
              picked={isMine}
              compact={compact}
              photoGallery={photoGallery}
              className={[pick && classes.taken, isFresh && classes.fresh]
                .filter(Boolean)
                .join(" ")}
              tag={
                pick ? (
                  isFresh ? (
                    <Badge size="sm" radius="xs" color="ember" variant="filled">
                      Pick {pick.order}
                    </Badge>
                  ) : (
                    <StatusBadge kind="season" size="sm">
                      Pick {pick.order}
                    </StatusBadge>
                  )
                ) : undefined
              }
              actions={
                <div className={classes.castActions}>{draftAction(player)}</div>
              }
            />
          </li>
        );
      })}
    </ul>
  );
};
