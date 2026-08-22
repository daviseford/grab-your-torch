import { Button, Text, Title } from "@mantine/core";
import { Component, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { StandbySlate } from "../Layout/StandbySlate";

type RouteErrorFallbackProps = {
  onReload: () => void;
};

const RouteErrorFallback = ({ onReload }: RouteErrorFallbackProps) => (
  <StandbySlate
    role="alert"
    code="Off air"
    actions={
      <>
        <Button size="md" onClick={onReload}>
          Reload page
        </Button>
        <Button
          component={Link}
          to="/"
          variant="outline"
          size="md"
          color="dark.0"
        >
          Go home
        </Button>
      </>
    }
  >
    <Title order={1}>This page could not be loaded</Title>
    <Text c="dimmed" maw={420}>
      A new version of Grab Your Torch may have just been released. Reloading
      the page usually fixes this.
    </Text>
  </StandbySlate>
);

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

// Error boundaries still have no hook equivalent, so this is the one class
// component in the app. Keep it minimal and put any UI in the fallback above.
class RouteErrorBoundaryImpl extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return <RouteErrorFallback onReload={this.handleReload} />;
    }
    return this.props.children;
  }
}

type RouteErrorBoundaryProps = {
  children: ReactNode;
};

/**
 * Catches render errors from the routed page (most often a lazy route chunk
 * that failed to load) so the app shell stays up instead of going blank.
 * Keyed by pathname so navigating to another page gets a clean attempt.
 */
export const RouteErrorBoundary = ({ children }: RouteErrorBoundaryProps) => {
  const { pathname } = useLocation();
  return (
    <RouteErrorBoundaryImpl key={pathname}>{children}</RouteErrorBoundaryImpl>
  );
};
