# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary users are Survivor fans who want to run a fantasy competition with friends. They may be following the currently airing season together or revisiting an older season at their own pace.

## Product Purpose

Grab Your Torch lets groups choose a US Survivor season, draft castaways in real time, submit predictions, earn points from events in the game, trade players, and compare standings. Success means a group can run the full fantasy competition without spreadsheets, synchronization friction, or spoilers beyond the episodes they have watched.

## Positioning

Grab Your Torch combines live collaborative drafting, fantasy scoring, trades, and spoiler-controlled watch-along progression across all US Survivor seasons. Competition creators determine which episode results are revealed, keeping scores, eliminations, predictions, and standings aligned with the group's actual viewing progress.

## Operating Context

Players browse seasons and casts, create or join a competition, gather for a live draft, submit preseason prop bets, follow standings as episodes are revealed, and negotiate trades during the season. The experience must work across desktop and mobile devices and support both current-season play and rewatches of historical seasons.

## Capabilities and Constraints

- The product covers all 50 US Survivor seasons and more than 700 castaways.
- Core flows include season discovery, competition creation and joining, real-time drafting, prop bets, episode progression, scoring and standings, and player trades.
- Spoiler protection is a core product rule. Result-bearing information must never advance beyond a competition's current episode.
- Existing product behavior, scoring rules, data architecture, terminology, and season data remain authoritative during the redesign.
- Public, authenticated, draft, competition, and administrative interfaces are all part of the website.
- The application is a React and TypeScript web app using Mantine and Firebase.

## Brand Commitments

- The product name is “Grab Your Torch.”
- The new Victory Flame identity and its supplied logo system are the visual authority for the redesign.
- The identity combines a blue and cyan product palette with orange and gold flame accents, a torch-and-trophy emblem, Space Grotesk for the wordmark, and Inter for product UI.
- The brand should feel competitive, adventurous, social, clever, energetic, welcoming, and polished.
- The identity must remain visually distinct from official Survivor, CBS, immunity-idol, tribal-council, and culturally insensitive pseudo-tribal branding.
- Factual claims and product behavior must not change as a side effect of visual or UX copy improvements.

## Evidence on Hand

- The generated Victory Flame brand board and coordinated SVG/PNG assets are stored outside the repository under `C:/Users/davis/Documents/Codex/2026-08-22/grab-your-torch-logo-design-prompt/outputs/` and are the source assets to inventory before implementation.
- Existing product copy and feature demonstrations are present in the application, especially the homepage, season browsing, competition, draft, scoring, and administration surfaces.
- The repository contains real season and castaway data that can support realistic interface states without inventing product claims.
- Grab Your Torch is not affiliated with, endorsed by, or connected to CBS or Survivor.

## Product Principles

- Never reveal information beyond the group’s current episode.
- Make draft night and competition with friends feel live, social, and consequential.
- Preserve operational clarity while giving the product a memorable identity.
- Support every season and viewing pace without making the experience feel encyclopedic or overwhelming.
- Use real product data and behavior as proof instead of generic marketing claims.

## Accessibility & Inclusion

The redesign must preserve semantic structure, keyboard access, visible focus, readable contrast, reduced-motion support, responsive behavior, and clear state communication. Cultural references must avoid stereotypes and pseudo-tribal imagery.
