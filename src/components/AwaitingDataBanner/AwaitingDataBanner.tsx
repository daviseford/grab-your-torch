import { Alert } from "@mantine/core";
import { IconClockExclamation } from "@tabler/icons-react";
import { Episode } from "../../types";

const formatAirDate = (airDate: string): string =>
  new Date(`${airDate}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

/**
 * Shown when an episode has aired but its scoring data hasn't been synced
 * yet (data collection lags the broadcast by several hours).
 */
export const AwaitingDataBanner = ({ episode }: { episode: Episode }) => (
  <Alert
    variant="outline"
    color="orange"
    title={`Awaiting data for Episode ${episode.order}`}
    icon={<IconClockExclamation size={20} />}
  >
    This episode aired
    {episode.air_date ? ` on ${formatAirDate(episode.air_date)}` : ""}. We're
    still awaiting scoring data. Check back later.
  </Alert>
);
