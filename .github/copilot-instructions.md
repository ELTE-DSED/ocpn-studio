# OCPN Studio - AI Coding Instructions

## Project Overview

OCPN Studio is a React/TypeScript web app for designing Object-centric Colored Petri Nets (OCPNs), aiming to replicate CPN Tools functionality in a modern web interface. It uses React Flow for the visual canvas, Zustand for state management, and integrates with `@rwth-pads/cpnsim` (a WASM-based CPN simulator).

## Architecture

### Core Data Flow
```
Zustand Store (store.ts) ←→ React Components ←→ React Flow Canvas
                ↓
        SimulationContext ←→ WASM Simulator (cpnsim)
```

- **State Management**: Single Zustand store at [src/stores/store.ts](src/stores/store.ts) holds all Petri nets, declarations (colorSets, variables, priorities, functions), and selection state
- **Multi-net support**: `petriNetsById` (Record<string, PetriNet>) + `petriNetOrder` (string[]) + `activePetriNetId`
- **Simulation**: `SimulationContext` wraps the WASM simulator; see [src/hooks/useSimulationController.ts](src/hooks/useSimulationController.ts)

### Key Domain Types
- **Nodes**: `PlaceNode` (ellipse, has colorSet/marking), `TransitionNode` (rectangle, has guard/time/priority), `AuxTextNode` (label text)
- **Edges**: `ArcEdge` - connects places to transitions or vice versa, labeled with variables; supports bidirectional arcs
- **Declarations**: ColorSet, Variable, Priority, Function, Use - defined in [src/declarations/index.ts](src/declarations/index.ts)

## Project Conventions

### Import Aliases
Use `@/` path alias for all src imports:
```typescript
import useStore from '@/stores/store';
import { PlaceNodeData } from '@/nodes/PlaceNode';
import type { ColorSet } from '@/declarations';
```

### Component Patterns
- **Node components** ([src/nodes/](src/nodes/)): Export both interface (e.g., `PlaceNodeData`) and component
- **Property panels** ([src/components/](src/components/)): Named `*Properties.tsx` (PlaceProperties, TransitionProperties, ArcProperties)
- **Dialogs**: Located in [src/components/dialogs/](src/components/dialogs/)
- **UI primitives**: Radix-based components in [src/components/ui/](src/components/ui/) (shadcn/ui pattern)

### Store Access Patterns
```typescript
// Read state with selector
const colorSets = useStore((state) => state.colorSets);

// Read multiple values (use useShallow for objects)
import { useShallow } from 'zustand/react/shallow';
const { nodes, edges } = useStore(useShallow((state) => ({
  nodes: state.petriNetsById[id]?.nodes,
  edges: state.petriNetsById[id]?.edges,
})));

// Access state outside React
const currentState = useStore.getState();
```

### React Flow Integration
- Custom node types registered in [src/nodes/index.ts](src/nodes/index.ts)
- Custom edge types in [src/edges/index.ts](src/edges/index.ts)
- Use `usePetriNetHandlers` hook for node/edge change callbacks
- Wrap canvas components with `ReactFlowProvider` and `DnDProvider`

## Developer Commands
```bash
npm run dev          # Start dev server at localhost:5173
npm run build        # TypeScript check + Vite build
npm run lint         # ESLint with zero-warning policy
npm run deploy       # Build and deploy to GitHub Pages
```

## CPN Tools XML Parsing
[src/utils/FileOperations.ts](src/utils/FileOperations.ts) parses CPN Tools XML (`.cpn` files):
- **ColorSets**: Supports basic types (`int`, `bool`, `string`), `product` types, `int with range`
- **Variables**: Parsed from `<var>` elements; multiple variable names can exist in one tag
- **Places/Transitions**: Include width/height from `<ellipse w="..." h="..."/>` and `<box w="..." h="..."/>`
- **Arcs**: Handle `BOTHDIR` orientation by creating two separate edges; parse `<bendpoint>` elements
- **Aux elements**: Parse `<Aux>` as `auxText` nodes for labels like "Sender", "Network", etc.
- **Y-coordinate inversion**: CPN Tools uses inverted Y-axis; apply `-parseFloat(y)` when parsing

## File Format Support
- `.ocpn` - Native JSON format (full fidelity)
- `.cpn` - CPN Tools XML export
- `.json` - CPNPy JSON format

## Critical Implementation Notes

1. **Node data must include `isArcMode`**: All PlaceNode/TransitionNode data requires this boolean for connection mode
2. **Markings are arrays**: Store node markings as `(string | number)[]`, not strings
3. **WASM initialization is async**: Check `isInitialized` before calling simulator methods
4. **Color sets have colors**: Each ColorSet has a `color` property used for visual styling of nodes/edges
5. **UUID generation**: Use `uuid` package's `v4()` for all IDs (nodes, edges, declarations)
