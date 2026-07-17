# OCPN Studio

**OCPN Studio** is a modern web application for designing **Object-centric Colored Petri Nets (OCPNs)** and generating simulated **OCEL 2.0** event logs — making what used to be a complex, StandardML-heavy workflow super easy and smooth, right in your browser.

**[Launch OCPN Studio](https://elte-dsed.github.io/ocpn-studio)**

<img width="1291" height="750" alt="OCPN Studio screenshot showing the built-in Airport Ground Handling example" src="https://github.com/user-attachments/assets/83fa9c27-d6aa-405e-8490-e061233dc3ef" />

## Features

- **Visual OCPN editor** — Create and edit places, transitions, and arcs on an interactive canvas with drag-and-drop, including multi-select batch editing of shared properties across many places or transitions at once
- **Hierarchical nets** — Model hierarchical object-centric Petri nets with substitution transitions, subpages, and fusion places
- **Declarations** — Define color sets (including record types that directly map to OCEL 2.0 objects), variables, priorities, and functions
- **Declare constraints** — Author declarative, LTL-based behavioral rules (Response, Precedence, Succession, Not-Coexistence, and more) as color-coded arcs between transitions; violations are prevented by blocking non-compliant firings during simulation, matching CPN Tools' Declare plugin
- **Simulation** — Step through or auto-run simulations powered by [cpnsim](https://github.com/rwth-pads/cpnsim), our own CPN simulator written in Rust and cross-compiled to WebAssembly, running entirely in the browser. Click any enabled transition directly on the canvas to fire it (Fire Mode), edit a place's live marking mid-run, or jump to any enabled transition from the sidebar
- **Monitors** — Define marking-size, transition-count, breakpoint, duration, and custom data-collector monitors to observe simulation behavior and collect statistics
- **State space analysis** — Compute the full state space with BFS exploration, SCC decomposition, dead/home markings, place bounds, and transition liveness — with deterministic overrides for models using stochastic distribution functions
- **Reachability graph** — Visualize the state space as an interactive graph with clickable nodes showing full marking details
- **OCEL 2.0 export** — Export simulated event logs in the OCEL 2.0 standard format for process mining
- **File format support** — Open and save `.ocpn` (native JSON), `.cpn` (CPN Tools XML), `.pnml` (PNML, partial support), and `.json` (CPNPy) files
- **Auto-layout** — Arrange nets automatically using Dagre, ELK, or our own Sugiyama-based layouting algorithm developed in our research
- **Built-in examples** — Get started instantly with the Airport Ground Handling process example via the **Open** button
- **AI assistant** — Optional AI-powered sidebar for modeling guidance (OpenAI API key required)

## Getting Started

The easiest way to use OCPN Studio is the hosted version at **[elte-dsed.github.io/ocpn-studio](https://elte-dsed.github.io/ocpn-studio)**.

- Click the **?** (Help) button in the top-right corner for an interactive guide that explains the app's functionality in detail.
- Click **Open** in the top-left corner and select the built-in **Airport Ground Handling** example to explore a complete OCPN model.
- Use the **Feedback** button in the app to share your thoughts — feedback is very much welcome!
- If OCPN Studio has been useful to you, the ☕ button next to Feedback links to [buymeacoffee.com/istvank](https://buymeacoffee.com/istvank) — it helps cover the cost of the AI tooling used to build this project faster.

## Local Development

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- [pnpm](https://pnpm.io/) (v10+)

### Setup

```bash
git clone https://github.com/ELTE-DSED/ocpn-studio.git
cd ocpn-studio
pnpm install
```

### Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start the dev server at `localhost:5173` |
| `pnpm build` | TypeScript check + production build |
| `pnpm lint` | Run ESLint (zero-warning policy) |
| `pnpm preview` | Preview the production build locally |
| `pnpm deploy` | Build and deploy to GitHub Pages |

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) |
| Build | [Vite](https://vite.dev/) |
| Canvas | [React Flow](https://reactflow.dev/) |
| State | [Zustand](https://zustand.docs.pmnd.rs/) + [Zundo](https://github.com/charkour/zundo) (undo/redo) |
| Simulation | [@rwth-pads/cpnsim](https://github.com/rwth-pads/cpnsim) (Rust/WebAssembly) |
| Styling | [Tailwind CSS](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) (Radix primitives) |
| Layout | [Dagre](https://github.com/dagrejs/dagre) + [ELK](https://github.com/kieler/elkjs) |
| Linting | [ESLint 10](https://eslint.org/) + [typescript-eslint](https://typescript-eslint.io/) |

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for a slide-style conceptual overview of the frontend, the WebAssembly integration boundary, and the internal `cpnsim` engine layers.

## Contributing

Contributions are welcome! Feel free to open an issue or submit a pull request — any help is greatly appreciated. The easiest way to reach out is via the **Feedback** button directly in the app.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

Based on the [React Flow starter (Vite + TS)](https://github.com/xyflow/vite-react-flow-template) template by webkid GmbH.
