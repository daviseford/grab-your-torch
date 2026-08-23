import { AppShell, Burger, MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import { useDisclosure } from "@mantine/hooks";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import "@mantine/notifications/styles.css";
import { lazy, Suspense, useEffect, useLayoutEffect } from "react";
import {
  Link,
  Navigate,
  Route,
  BrowserRouter as Router,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";
import classes from "./AppRoutes.module.css";
import { AuthModal } from "./components/Auth/AuthModal";
import { Logout } from "./components/Auth/Logout";
import { BrandEmblem } from "./components/Brand";
import { Footer } from "./components/Footer";
import { Home } from "./components/Home/Home";
import { useBugContextNode } from "./components/Layout/bugContext";
import { BugContextProvider } from "./components/Layout/BugContextProvider";
import { RouteLoading } from "./components/Layout/RouteLoading";
import { Navbar } from "./components/Navbar";
import { NotFound } from "./components/NotFound";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary/RouteErrorBoundary";
import { cssVariablesResolver, theme } from "./theme";
import { trackEvent } from "./utils/analytics";

const Admin = lazy(() =>
  import("./pages/Admin").then((m) => ({ default: m.Admin })),
);
const Competitions = lazy(() =>
  import("./pages/Competitions").then((m) => ({ default: m.Competitions })),
);
const DraftComponent = lazy(() =>
  import("./pages/Draft").then((m) => ({ default: m.DraftComponent })),
);
const SeasonAdmin = lazy(() =>
  import("./pages/SeasonAdmin").then((m) => ({ default: m.SeasonAdmin })),
);
const Seasons = lazy(() =>
  import("./pages/Seasons").then((m) => ({ default: m.Seasons })),
);
const SingleCompetition = lazy(() =>
  import("./pages/SingleCompetition").then((m) => ({
    default: m.SingleCompetition,
  })),
);
const ScoringReference = lazy(() =>
  import("./pages/ScoringReference").then((m) => ({
    default: m.ScoringReference,
  })),
);
const ResetPassword = lazy(() =>
  import("./pages/ResetPassword").then((m) => ({ default: m.ResetPassword })),
);
const SingleSeason = lazy(() =>
  import("./pages/SingleSeason").then((m) => ({ default: m.SingleSeason })),
);

// Legacy redirect: /seasons/:id/manage -> /admin/:id (safe to remove once old links age out)
const RedirectToAdmin = () => {
  const { seasonId } = useParams();
  if (!seasonId) return <Navigate to="/admin" replace />;
  return <Navigate to={`/admin/${seasonId}`} replace />;
};

// Logs a GA4 page_view on every route change (SPA navigation isn't
// tracked automatically). No-ops outside production builds.
const PageTracker = () => {
  const location = useLocation();

  useEffect(() => {
    // The reset route's query string carries the one-time action code and
    // continuation state; only its pathname may reach analytics.
    const pagePath = location.pathname.startsWith("/reset-password")
      ? location.pathname
      : location.pathname + location.search;
    trackEvent("page_view", {
      page_path: pagePath,
      page_title: document.title,
    });
  }, [location]);

  return null;
};

const ScrollToTop = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";

    return () => {
      window.history.scrollRestoration = previousScrollRestoration;
    };
  }, []);

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    document.getElementById("main-content")?.scrollTo(0, 0);
  }, [pathname]);

  return null;
};

const modals = { AuthModal };

declare module "@mantine/modals" {
  export interface MantineModalsOverride {
    modals: typeof modals;
  }
}

const NAV_ID = "main-navigation";

/**
 * The corner bug: the primary lockup on the navy header plate, or the
 * emblem plus a typeset wordmark below the width where the lockup would
 * drop under its 160 px minimum.
 */
const Bug = () => (
  <Link to="/" className={classes.bug} aria-label="Grab Your Torch, home">
    <img
      src="/brand/grab-your-torch-primary-dark.svg"
      alt=""
      width={180}
      height={52}
      className={classes.bugLockup}
      decoding="async"
      draggable={false}
    />
    <span className={classes.bugCompact} aria-hidden="true">
      <BrandEmblem height={40} />
      <span className={classes.bugWordmark}>
        Grab Your <em>Torch</em>
      </span>
    </span>
  </Link>
);

/** The caps context beside the lockup: where the visitor is right now. */
const BugContextSegment = () => {
  const node = useBugContextNode();
  if (!node) return null;
  return <div className={classes.bugContext}>{node}</div>;
};

export const AppRoutes = () => {
  const [opened, { toggle, close }] = useDisclosure();

  return (
    <MantineProvider
      theme={theme}
      cssVariablesResolver={cssVariablesResolver}
      defaultColorScheme="auto"
    >
      <Notifications />
      <Router>
        <ScrollToTop />
        <PageTracker />
        <ModalsProvider modals={modals}>
          <BugContextProvider>
            <AppShell
              header={{
                height: {
                  base: 56,
                  sm: 60,
                },
              }}
              padding={{ base: "md", sm: "lg" }}
            >
              <a className={classes.skipLink} href="#main-content">
                Skip to main content
              </a>
              <AppShell.Header>
                <div className={classes.header}>
                  <Bug />
                  <BugContextSegment />
                  <Navbar id={NAV_ID} opened={opened} onClose={close} />
                  <Burger
                    opened={opened}
                    onClick={toggle}
                    hiddenFrom="md"
                    size="sm"
                    className={classes.burger}
                    aria-label="Toggle navigation"
                    aria-controls={NAV_ID}
                    aria-expanded={opened}
                  />
                </div>
              </AppShell.Header>

              <AppShell.Main id="main-content" className={classes.main}>
                <RouteErrorBoundary>
                  <Suspense fallback={<RouteLoading />}>
                    <Routes>
                      <Route path="/" element={<Home />} />

                      {/* User stuff */}
                      <Route path="/logout" element={<Logout />} />
                      <Route
                        path="/reset-password"
                        element={<ResetPassword />}
                      />

                      {/* Drafting */}
                      <Route
                        path="/seasons/:seasonId/draft/:draftId"
                        element={<DraftComponent />}
                      />

                      {/* Seasons */}
                      <Route
                        path="/seasons/:seasonId/manage"
                        element={<RedirectToAdmin />}
                      />
                      <Route
                        path="/seasons/:seasonId"
                        element={<SingleSeason />}
                      />
                      <Route path="/seasons" element={<Seasons />} />

                      {/* Competitions */}
                      <Route
                        path="/competitions/:competitionId"
                        element={<SingleCompetition />}
                      />
                      <Route path="/competitions" element={<Competitions />} />

                      {/* Scoring */}
                      <Route path="/scoring" element={<ScoringReference />} />

                      {/* Admin */}
                      <Route
                        path="/admin/:seasonId"
                        element={<SeasonAdmin />}
                      />
                      <Route path="/admin" element={<Admin />} />

                      {/* 404 catch-all, must be last */}
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </Suspense>
                </RouteErrorBoundary>
                <Footer />
              </AppShell.Main>
            </AppShell>
          </BugContextProvider>
        </ModalsProvider>
      </Router>
    </MantineProvider>
  );
};
