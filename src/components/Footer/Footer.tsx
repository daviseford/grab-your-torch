import { Anchor, Container, Text, VisuallyHidden } from "@mantine/core";
import { BrandLockup } from "../Brand";
import classes from "./Footer.module.css";

const links = [
  {
    link: "https://github.com/daviseford/grab-your-torch/",
    label: "Github",
  },
  { link: "//daviseford.com", label: "daviseford.com" },
];

export const Footer = () => {
  return (
    <footer className={classes.footer}>
      <Container className={classes.inner}>
        <div className={classes.brand}>
          <BrandLockup width={160} className={classes.lockup} decorative />
          <Text c="dimmed" size="sm">
            Built for draft night chaos by Davis Ford
          </Text>
        </div>
        <div className={classes.links}>
          {links.map((link) => (
            <Anchor
              c="dimmed"
              key={link.label}
              href={link.link}
              className={classes.link}
              target="_blank"
              rel="noopener noreferrer"
            >
              {link.label}
              <VisuallyHidden> (opens in a new tab)</VisuallyHidden>
            </Anchor>
          ))}
        </div>
      </Container>
      <Container className={classes.disclaimer}>
        <Text c="dimmed" size="xs" ta="center">
          Grab Your Torch is not affiliated with, endorsed by, or connected to
          CBS, SEG, or the Survivor TV show. Survivor® is a registered trademark
          of CBS Broadcasting Inc.
        </Text>
      </Container>
    </footer>
  );
};
