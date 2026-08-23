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
          <BrandLockup width={150} className={classes.lockup} decorative />
          <span className={classes.divider} aria-hidden="true" />
          <Text c="dimmed" size="sm" className={classes.tagline}>
            Built for draft night chaos by Davis Ford
          </Text>
        </div>
        <nav aria-label="Footer" className={classes.links}>
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
        </nav>
      </Container>
    </footer>
  );
};
