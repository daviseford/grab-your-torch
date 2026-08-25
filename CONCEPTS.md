# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Relationships

- A **Season** owns its **Castaways** and **Episodes**. Every **Challenge win**, **Elimination**, **Game event**, **Tribal council vote**, and **Tribe** is scoped to exactly one season.
- A **Draft** produces exactly one **Competition**, once, at completion. The competition holds a forward copy of the **Draft picks** and prop-bet answers rather than reading live draft state.
- A **Draft pick** binds a **Castaway** to the **Participant** who drafted them, permanently; a **Trade** moves ownership afterwards. A **Roster** is the set of castaways a participant owns _now_, which is the picks they made only until their first accepted trade.
- **Scores are never stored.** Standings are derived on demand: challenge wins, eliminations, and game events produce a per-castaway per-episode **Episode score**, summed across a roster and added to separately-derived **Prop bet** points.
- The three **Player action** families map onto three different record collections. Choosing the wrong collection scores nothing, silently.
- The **Current episode** boundary sits between every result collection and every consumer. The only sanctioned bypass is an **Unfiltered read**.
- **Tribe** membership is episode-scoped — a snapshot per episode, not a property of a castaway.
- Pipeline direction is one-way: **survivoR** → generated season data → **Season registration** → published copy. Nothing flows back upstream, and the local data wins any disagreement with the published copy.
- Live **Drafts** are held in realtime storage; everything else is document storage. The split is by write pattern — fast collaborative turn-taking versus read-heavy persistence — not by subject.

## Fantasy competition

### Competition

One group's instance of the fantasy game for a single season: a fixed set of human participants, the rosters their draft produced and their trades have since reshaped, their prop-bet answers, and the episode boundary governing what they may see.

A competition comes into existence only when its draft completes, and carries a forward copy of the picks rather than reading them back from the draft. It reaches a terminal state once the season's winner has been recorded _and_ the group's own episode boundary has reached the finale — a group still behind the finale stays open even though the season is over.

### Participant

A human playing in a competition, as distinct from the **Castaway** contestants they own.
_Avoid:_ player (in this sense — see Flagged ambiguities).

### Draft

The live, turn-taking session in which participants divide a season's castaways among themselves; its completion is what creates the **Competition**.

Every castaway in the season is drafted, with turns cycling in order until the cast is exhausted. Only the creator promotes a finished draft into a competition. Older drafts can carry legacy shapes, so reads normalize both current and historical representations.

### Draft pick

The single record binding one castaway to the participant who drafted them — the starting point every ownership question is answered from.

A pick never changes. A castaway being voted out does not reassign or clear their pick; it only stops them accruing points. A **Trade** does not rewrite it either: the pick keeps saying who drafted the castaway, while current ownership is derived by replaying accepted trades on top of it. "Drafted by" and "on this roster" are therefore different claims once a trade has happened, and naming a participant beside a castaway asserts one of them.

### Trade

An exchange of castaways between two participants of one competition, proposed by one and accepted by the other, which moves ownership without touching the draft.

Trades live beside the competition rather than in it, so ownership is derived rather than stored. Each accepted trade takes effect from a cutoff episode: points already on the board stay with the previous owner, and only later episodes score for the new one. Trading closes for the episode a group is about to reveal, so nobody can trade on what they have already watched.

### Roster

The set of castaways one participant owns in one competition right now — the group of contestants whose combined points are that participant's score.

After a **Trade** a roster is no longer the same thing as a participant's draft picks: a castaway sits on the roster of whoever owns them today, while the pick still records who drafted them.
_Avoid:_ team (which means a **Tribe** here).

### Prop bet

A season-long side prediction each participant answers once, before play, resolving independently of the roster and adding to their competition total.

Answers are submitted during the draft and frozen into the competition. Only questions at least one participant actually answered are active and scoreable.

### Prop bet status

The resolution state of one participant's answer, distinguishing settled outcomes from a provisional front-runner and from not-yet-decidable.

Single-event bets settle when the event occurs, and can settle negatively early once the picked castaway is definitively out of contention. Cumulative "who does it most" bets stay provisional until the finale: a leading pick is marked as leading, not correct, and a trailing pick becomes wrong only once it can no longer catch up. Only definitively-correct answers award points.

## Survivor game model

### Castaway

A contestant in a Survivor season — the thing that is drafted and that earns points, as distinct from the **Participant** who owns them.

Identity comes from an identifier borrowed from **survivoR** and stable across seasons, so a returning contestant keeps one identity across appearances. That identifier, never a name, is the canonical key: the authoritative source and the fan wiki disagree on contestant names, so each season also ships a mapping from identifier to both formal and on-screen name, and display code resolves through it rather than trusting any name stored on a record.

### Season

One televised run of the show, and the unit that owns the cast, the episode list, and all result data — every gameplay record is scoped to exactly one.

A season becomes playable only once registered; the local registry is the source of truth for which seasons exist, even though the same data is mirrored to the backend for the app to read.

### Episode

The ordered unit of a season and the universal time axis of the system — every result, score, and spoiler boundary is expressed as an episode number.

An episode separately records whether the merge happens in it, whether it falls after the merge, and whether it is the finale. Merge-occurs and post-merge are distinct because the source data marks tribes as merged starting the episode after the event.

### Merge

The point where tribes dissolve into one and challenges become individual, changing both what scores and which statistics are meaningful.

Several derived measures restrict themselves to post-merge castaways, falling back to the full field when too few have merged, because pre-merge samples make them meaningless.

### Finale

The episode in which the season's winner is crowned — not merely the last episode present in the data.

An episode is the finale only once a winner has actually been declared upstream. A season still airing has no finale even though it has a highest-numbered episode. Downstream, whether the finale has occurred is what flips still-open predictions to definitively wrong, and it gates competitions closing.

### Elimination

A record that a castaway left the game in a given episode, tagged with the manner of departure, which determines whether it scores and whether it actually ends their run.

Not every elimination record is a real exit: one variant records a tribe switch and is skipped by scoring entirely, and another records reaching the final tribal council without ending the castaway's run. A castaway with a later game event or challenge win is not considered out — returns from redemption-style twists are detected exactly this way, not by a status flag.

Every elimination carries a season-wide order, unique by convention (imported seasons number them sequentially; admin entry rejects a duplicate). Elimination points grow with the episode number, and in a **multi-elimination episode** the order ranks the boots so each later boot earns slightly more than the one before it. Final-tribal-council records take the last ranks of the finale, so runners-up finish above the castaway eliminated just before them. Should two records ever share an order, scoring still assigns them distinct ranks rather than dropping the bonus for both.

### Tribe

An in-show group of castaways within a season — the thing that wins tribal challenges.
_Avoid:_ team (see Flagged ambiguities).

Membership is episode-scoped, because tribes swap and dissolve as a season progresses. Tribe attribution on a challenge is display and audit metadata only: the winning castaway list, not the tribe, is what scores.

### Tribal council vote

One vote cast at one tribal council, retained as raw history for statistics rather than for scoring.

Only formal tribal votes are kept; other vote-time mechanics present upstream are filtered out. A vote may be marked nullified by an idol, or part of a tie. Vote history never awards points directly.

### Idol and advantage

The two families of in-game power objects the scoring model treats separately — hidden immunity idols on one side, all other one-off powers on the other.

Each power scores at several lifecycle points: finding it, playing it, and — negatively — being voted out still holding it. A "beware" power adds a staged lifecycle of found, accepted, then obligations fulfilled, each stage scoring separately. Powers won on a **Journey** are recorded distinctly from powers found at camp.

### Journey

An off-camp excursion a castaway is sent on in later seasons, scoring for participation and then separately for the outcome — winning the game played there, or risking and losing a vote.

## Scoring

### Player action

The vocabulary of scoreable things a castaway can do or have happen to them — the closed set of names that scoring rules attach point values to.

Partitioned into three families that are **not interchangeable** and are read from three different record collections. Every action name belongs to exactly one family, and which family it belongs to determines where its data must live.

### Challenge win

A scoreable action recorded on a _challenge_ — one challenge, one list of winning castaways — covering individual immunity, tribal immunity, individual reward, team reward, and duel wins.

A challenge names many winners at once, and scoring credits every castaway in its winner list. Challenge wins can only be expressed this way: recording one as a **Game event** does not score, and the reverse is equally broken. When the show grants immunity through some non-challenge twist, the pipeline must still synthesize a challenge entry — attaching the castaway to that episode's immunity challenge, or emitting a standalone one — precisely because immunity is not expressible as an event. Challenges that award both a team and an individual outcome are split so each winner receives the variant that actually applies to them.

### Game event

A scoreable action recorded per castaway — one castaway, one thing that happened — covering idols and advantages, journeys, reaching the merge or the final tribal council, and winning the season.

Exactly one castaway per record, unlike a **Challenge win**. An event may carry a count that multiplies its base value where an action's worth scales with how many times it applied; absent a count, the base value is awarded once.

### Game progress action

The third action family — the scoreable consequences of leaving the game — which is never stored directly but derived from an **Elimination**'s manner of departure.

These names exist only as scoring outputs; nothing writes them. The base departure award scales with how deep into the season the castaway got, and the manner of departure adds a further bonus or penalty.

### Scoring rule

The central binding of each action name to a point value, an explanation, and a display category — the single place the game's economy is defined.

A rule is either a fixed award or a per-occurrence award scaled by a count on the record, and values are negative for penalties. An action with no matching rule silently scores nothing, so an unrecognized action name is a silent zero rather than an error. Display categories from this table are reused elsewhere to define which actions count as idol-and-advantage work, so re-categorizing a rule also changes derived statistics.

### Episode score

What a single castaway earned in a single episode, itemized by action — and, summed, a castaway's season total and a participant's competition total.

Always computed on demand from spoiler-filtered records; nothing is persisted. A participant's headline total is their roster's points plus their **Prop bet** points, which are scored on an entirely separate path.

## Spoiler control

### Watch-along mode

The competition setting in which a group is deliberately behind the broadcast and the app hides everything past the episode they have collectively reached — the product's defining feature.

Only the competition creator advances the boundary; everyone else sees it read-only. Moving it backwards re-hides results people may already have seen, and is confirmed as such. Leaving watch-along is irreversible in effect, because it reveals the whole season at once.

### Live mode

The opposite setting — no episode boundary at all, every result visible as it lands, for groups watching along with broadcast.

Represented as the _absence_ of a boundary rather than a boundary at the last episode, so "no boundary" and "boundary at zero" mean opposite things: no boundary reveals everything, a boundary of zero reveals nothing.

### Current episode

The competition-scoped watermark naming the furthest episode whose results the group may see.

Every result-bearing collection — challenges, eliminations, events, votes, and the episode list itself — is filtered against it before anything is computed or rendered, so scores, standings, statistics, and status reflect only revealed episodes. New result-bearing UI is expected to consume already-filtered data, never the raw collections.

### Unfiltered read

The narrow, deliberate exception where code reads results past the spoiler boundary — currently only to detect that a season has ended so a competition can close.

Safe only because it produces no user-visible result beyond a state flag, and still gated so a group behind the finale is not closed out early. Anything that would render past-boundary information is not eligible.

## Data pipeline

### survivoR

The external, community-maintained Survivor dataset that is the single source of truth for cast, episodes, challenge results, votes, advantages, and journeys.

When it disagrees with any other source, it wins, and its identifiers are adopted as the app's own castaway identity. It has known gaps the project fills by derivation or manual entry, and it uses preferred or stage names where the fan wiki uses legal ones.

### Wiki supplement

The residual, non-authoritative scrape of the fan wiki, retained only for castaway images and biographical colour.

Never a source for results. Because it names contestants differently from the authoritative source, matching between the two can fail, which is tracked explicitly rather than silently.

### Season registration

Adding a season to the local registry so the app knows it exists — distinct from generating its data and from publishing that data to the backend.

The three steps are separable: a season can be generated without being registered, and registered without being pushed. The automated sync reads the registry to work out which season is active and whether a brand-new one has appeared upstream.

### Season sync

The automated cycle that re-derives an in-progress season from the authoritative source as new episodes air, validates it, and publishes it — how an active season stays current without hand editing.

Regeneration is wholesale rather than incremental: the season is rebuilt, compared against what is already on disk, and published only if it actually differs. A no-op run makes no commit and no write.

### Season data validation

The gate regenerated season data must pass before reaching the backend, aimed at catching upstream regressions rather than formatting problems.

Its central invariant is monotonicity: a regenerated season may never contain fewer episodes than the one it replaces, because that signals upstream data loss rather than a correction. It also enforces that castaway references resolve and that records are not duplicated.

## Flagged ambiguities

- **"Team"** means an in-show **Tribe** as an entity, but "your team" in product copy means a participant's **Roster**. Two unrelated things, one word — prefer _tribe_ and _roster_.
- **"Player"** means a **Castaway** in the data layer and on the Players page, but the Player Scores view filters by **Participant**. Prefer _castaway_ for contestants and _participant_ for people.
- **"Event"** is overloaded: a **Game event** is a specific scoring record family, but prose also says "event" for anything that happens in an episode, including challenge wins. Given the challenge-versus-event scoring split, this one is actively dangerous.
- **"Finished"** exists on both a **Draft** and a **Competition** with different meanings — all picks made, versus season concluded and revealed.
- **"Current episode"** carries three distinguishable states: absent (**Live mode**, everything visible), zero (**Watch-along mode**, nothing revealed), and positive. "No episodes revealed" is easily confused with "no boundary set".
- **"Drafted"** had been used for both senses of ownership — who made the pick, and whose roster a castaway is on. Since **Trades** exist these are distinct: _drafted by_ is fixed history, _on this roster_ is current ownership.
- **"Eliminated"** has two senses: an **Elimination** record exists, versus the castaway is actually out — a later event or challenge win overrides an earlier elimination for returnee twists.
