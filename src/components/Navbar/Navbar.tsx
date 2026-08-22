import {
  ActionIcon,
  Button,
  Text,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconMoon, IconSun } from "@tabler/icons-react";
import { Link, useLocation } from "react-router-dom";
import { auth } from "../../firebase";
import { useUser } from "../../hooks/useUser";
import { clearAuthIntents } from "../Auth/authIntent";
import classes from "./Navbar.module.css";

type NavItem = {
  link: string;
  label: string;
  adminOnly?: boolean;
};

const data: NavItem[] = [
  { link: "/", label: "Home" },
  { link: "/seasons", label: "Seasons" },
  { link: "/competitions", label: "Competitions" },
  { link: "/scoring", label: "Scoring" },
  { link: "/admin", label: "Admin", adminOnly: true },
];

const isItemActive = (pathname: string, link: string) =>
  (pathname.startsWith("/seasons") && link === "/seasons") ||
  (pathname.startsWith("/competitions") && link === "/competitions") ||
  (pathname.startsWith("/admin") && link === "/admin") ||
  (pathname === "/scoring" && link === "/scoring") ||
  link === pathname;

type NavbarProps = {
  /** Id the burger's aria-controls points at. */
  id: string;
  /** Whether the narrow-screen panel is open. Ignored on desktop. */
  opened: boolean;
  /** Close the narrow-screen panel (after navigating, on Escape). */
  onClose: () => void;
};

/**
 * The main navigation: inline links and account controls on desktop, a
 * panel under the header on narrow screens. It is the only navigation
 * landmark in the shell.
 */
export const Navbar = ({ id, opened, onClose }: NavbarProps) => {
  const { pathname } = useLocation();
  const { slimUser } = useUser();
  const { toggleColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme("light");
  const isDark = computedColorScheme === "dark";

  const handleLogout = () => {
    // Drop any abandoned Start/Join intent so a later account can never
    // inherit it (R10 + KTD1).
    clearAuthIntents();
    auth.signOut();
  };

  // The panel stays open behind the auth modal so the other entry point is
  // still one tap away after a dismissal (the auth e2e suite relies on it).
  const openAuth = (initialMode: "login" | "register") => {
    modals.openContextModal({
      modal: "AuthModal",
      innerProps: { initialMode },
    });
  };

  const initial = (slimUser?.displayName ?? "?").trim().charAt(0) || "?";

  return (
    <nav
      id={id}
      className={classes.nav}
      aria-label="Main navigation"
      data-opened={opened}
    >
      <ul className={classes.links}>
        {data.map((item) => {
          if (item.adminOnly && !slimUser?.isAdmin) return null;
          const active = isItemActive(pathname, item.link);
          return (
            <li key={item.label}>
              <Link
                to={item.link}
                className={classes.link}
                aria-current={active ? "page" : undefined}
                onClick={onClose}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className={classes.controls}>
        <Tooltip label={isDark ? "Light mode" : "Dark mode"} withArrow>
          <ActionIcon
            variant="subtle"
            size="lg"
            className={classes.iconButton}
            onClick={toggleColorScheme}
            aria-label="Toggle color scheme"
          >
            {isDark ? (
              <IconSun size={18} stroke={1.75} />
            ) : (
              <IconMoon size={18} stroke={1.75} />
            )}
          </ActionIcon>
        </Tooltip>

        {!slimUser && (
          <>
            <Button
              variant="subtle"
              color="dark.0"
              size="sm"
              onClick={() => openAuth("login")}
            >
              Sign in
            </Button>
            <Button
              variant="outline"
              color="dark.0"
              size="sm"
              onClick={() => openAuth("register")}
            >
              Create account
            </Button>
          </>
        )}

        {slimUser && (
          <>
            <div className={classes.account}>
              <span className={classes.avatar} aria-hidden="true">
                {initial}
              </span>
              <div style={{ minWidth: 0 }}>
                <Text
                  component="div"
                  className={classes.accountName}
                  size="sm"
                  truncate
                >
                  {slimUser.displayName}
                </Text>
                <Text component="div" className={classes.accountEmail} truncate>
                  {slimUser.email}
                </Text>
              </div>
            </div>
            <Button
              variant="subtle"
              color="dark.0"
              size="sm"
              onClick={handleLogout}
            >
              Logout
            </Button>
          </>
        )}
      </div>
    </nav>
  );
};
