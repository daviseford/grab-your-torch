import { Alert } from "@mantine/core";
import { IconClockExclamation } from "@tabler/icons-react";
import { AwaitingEpisode } from "../../utils/episodeAirDate";
import { SCORING_DELAY_MESSAGE } from "../../utils/scoringStatus";

/**
 * Shown when an episode has aired but its scoring data hasn't been synced
 * yet (data collection lags the broadcast by several hours).
 */
export const AwaitingDataBanner = ({
  episode,
}: {
  episode: AwaitingEpisode;
}) => (
  <Alert
    role="status"
    variant="outline"
    color="orange"
    title={`Episode ${episode.order} scores are on the way`}
    icon={<IconClockExclamation size={20} />}
  >
    {SCORING_DELAY_MESSAGE}
  </Alert>
);
