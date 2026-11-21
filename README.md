# Campus Hub - Adaptive UI using AI

A small student-portal web app whose interface adapts to the user at runtime using three simple, explainable AI techniques. Built for the "AI-Based Adaptive Human-Computer Interaction" assignment (University of the Cumberlands).

## How to run

No install, no build, no server.

1. Open the folder in VS Code.
2. Open `index.html` in a browser (double-click it, or right-click > "Open with Live Server" if you have that extension).
3. Click **Simulate 40 interactions** to watch the interface adapt, or click Assignments, Grades, Messages a few times yourself.

To run the model tests:

- In a browser: open `tests.html`.
- In a terminal (needs Node.js): `node tests.js`

## Files

| File | Purpose |
|---|---|
| `index.html` | Page structure: menu, "Suggested for you", controls, "How the AI sees you" panel |
| `styles.css` | Light/dark theme and 3 density levels via CSS variables; Reduced Motion support |
| `models.js` | The three adaptive models (no dependencies, testable without the UI) |
| `app.js` | Controller: connects UI events to the models, saves state, ARIA announcements |
| `tests.js` / `tests.html` | Automated checks of the models (8 tests) |

## The three adaptations

| Adaptation | AI technique | Signal used |
|---|---|---|
| Suggested menu items | Recency-weighted frequency + first-order Markov chain (Laplace smoothing), blended with alpha = 0.5 | Sequence and timing of menu selections |
| Layout density (compact / comfortable / spacious) | Epsilon-greedy multi-armed bandit (reinforcement learning). Each arm is pulled for 10 clicks; epsilon decays from 0.15 to 0.05 | Click speed and mis-clicks (clicking the gaps between menu buttons) |
| Light / dark theme | Rule-based learner. Dark from 7 pm to 6 am by default; each manual toggle is a vote that the learner then follows | Time of day and manual theme toggles |

## HCI design decisions

- **The main menu is never reordered.** Predictions go into a separate "Suggested for you" section, because unpredictable menus confuse users.
- **Transparency.** The "How the AI sees you" panel shows the probabilities, the bandit statistics and the theme votes.
- **User control.** "Adaptive features" can be switched off, density can be set manually, and "Reset learning" clears everything.
- **Accessibility.** Semantic HTML, keyboard-operable buttons, visible focus, an ARIA live region that announces adaptive changes, and `prefers-reduced-motion` support.
- **Privacy.** All learned data stays in the browser (localStorage). Nothing is sent anywhere.

## Limitations

- Tested with a simulated user (the "Simulate 40 interactions" button) and automated model tests, not with real participants. Real user research would be needed to validate the benefits.
- The density bandit treats mis-clicks and speed as signs of comfort, which may not hold for every user or device.

## AI assistance disclosure

> EDIT THIS BEFORE SUBMITTING. This code was generated with the help of an AI assistant (Claude, by Anthropic). List here which parts you wrote yourself, which parts the AI wrote, and what you changed or tested.
