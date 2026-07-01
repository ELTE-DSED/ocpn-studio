# Architecture Overview

This page gives a documentation-friendly, slide-style overview of how OCPN Studio is structured and how it integrates with `cpnsim`.

## Big Picture

```mermaid
flowchart LR
    classDef app fill:#f4f7fb,stroke:#58708a,color:#0f1720,stroke-width:1.2px;
    classDef runtime fill:#e9f7ef,stroke:#2f7d57,color:#0f1720,stroke-width:1.2px;
    classDef wasm fill:#fff1db,stroke:#b7791f,color:#0f1720,stroke-width:1.2px;
    classDef data fill:#f8e8ef,stroke:#a64d79,color:#0f1720,stroke-width:1.2px;

    User([Modeler / Analyst])

    subgraph Studio[OCPN Studio Browser Application]
      direction LR

      subgraph Experience[Authoring Experience]
        Canvas[Canvas Editor\nReact Flow]
        Sidebar[Sidebar Panels\nModel • Simulation • Analysis]
        Dialogs[Dialogs & Tools\nOpen/Save • Layout • Assistants]
      end

      subgraph FrontendCore[Frontend Core]
        Store[Zustand Store\nPetri nets • declarations • selection • UI state]
        Controller[Simulation Controller\ninitialize WASM • run steps • sync results]
        IO[Import / Export\n.ocpn • .cpn • .json • PNML]
        Validation[Validation\nmodel checks before / during use]
      end

      Experience --> FrontendCore
      Canvas <--> Store
      Sidebar <--> Store
      Dialogs <--> Store
      Store --> Validation
      Store <--> IO
      Sidebar --> Controller
      Canvas --> Controller
      Controller <--> Store
    end

    subgraph PackageCpnsim[cpnsim npm Package]
      direction TB
      Loader[JS Loader + Type Definitions]
      Binary[WebAssembly Binary]
      Loader --> Binary
    end

    subgraph Engine[cpnsim Rust Engine]
      direction LR
      API[WASM API\nWasmSimulator]
      Core[Simulation Core\nstep execution • bindings • markings • time]
      Rhai[Rhai Evaluation\nguards • arc inscriptions • code segments]
      Monitor[Monitors\ncounters • breakpoints • collectors]
      StateSpace[State Space Analysis\nreachability graph • SCCs • bounds]
      Model[Net Schema\nplaces • transitions • arcs • declarations]

      API --> Core
      Core --> Rhai
      Core --> Monitor
      Core --> StateSpace
      Core --> Model
    end

    User --> Canvas
    User --> Sidebar
    User --> Dialogs

    IO -->|serialize active OCPN as JSON| Controller
    Controller -->|init + create simulator| Loader
    Loader --> API
    API -->|events • markings • enabled transitions • analysis results| Loader
    Loader --> Controller
    Controller -->|write back simulation state| Store

    class Canvas,Sidebar,Dialogs,Store,Controller,IO,Validation app;
    class Loader,Binary wasm;
    class API,Core,Rhai,Monitor,StateSpace,Model runtime;
    class User data;
```

## Reading The Diagram

- The left side is the browser app: React UI, the editor canvas, sidebar panels, and import/export flows.
- The center is the runtime boundary: the simulation controller serializes the current model and talks to the npm package.
- The right side is `cpnsim`: a Rust simulator compiled to WebAssembly and exposed through a thin JS/WASM bridge.

## Core Ideas

- OCPN Studio keeps the editable model in a single Zustand store, including Petri net pages, declarations, selection state, monitors, and analysis results.
- The React UI reads and updates that store through the canvas, property editors, dialogs, and analysis panels.
- When simulation starts, the frontend converts the active in-memory model into the JSON schema expected by `cpnsim`.
- `@rwth-pads/cpnsim` loads the generated JS wrapper plus the `.wasm` binary, then instantiates `WasmSimulator`.
- Inside `cpnsim`, the Rust simulation engine evaluates guards and inscriptions with Rhai, computes enabled bindings, fires transitions, tracks time, and exposes monitor and state-space analysis APIs.
- Results flow back into the frontend as markings, events, enabled transitions, monitor outputs, and reachability/state-space data.

## Typical Runtime Flow

1. The user edits a model on the canvas or in sidebar panels.
2. The Zustand store becomes the current source of truth for the model.
3. The simulation controller serializes that model into the `cpnsim` JSON format.
4. The WebAssembly simulator runs steps and analyses inside the browser.
5. The frontend synchronizes returned markings, time, events, and analysis results back into the store.
6. The UI re-renders the canvas, event log, monitor views, and analysis panels from updated store state.