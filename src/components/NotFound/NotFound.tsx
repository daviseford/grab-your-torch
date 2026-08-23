import { Button, Text, Title } from "@mantine/core";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { StandbySlate } from "../Layout/StandbySlate";

export const NotFound = () => {
  const navigate = useNavigate();

  // Prevent search engines from indexing soft-404 pages (SPA always returns HTTP 200)
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  return (
    <StandbySlate
      code="404"
      actions={
        <Button size="md" onClick={() => navigate("/", { replace: true })}>
          Go home
        </Button>
      }
    >
      <Title order={1}>Page not found</Title>
      <Text c="dimmed" maw={400}>
        The page you're looking for doesn't exist or has been moved.
      </Text>
    </StandbySlate>
  );
};
