import { Button, Title } from "@mantine/core";
import { Link } from "react-router-dom";
import { StandbySlate } from "../components/Layout";

/** Access denied as a standby slate: the existing message on the plate. */
export const AdminAccessDenied = () => (
  <StandbySlate
    code="Standby"
    actions={
      <Button component={Link} to="/seasons" variant="outline" color="dark.0">
        Back to seasons
      </Button>
    }
  >
    <Title order={1} size="h3">
      You need admin access to view this page.
    </Title>
  </StandbySlate>
);
