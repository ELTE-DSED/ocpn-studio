## Introduction

Welcome to OCPN Studio! This tool allows you to create, edit, and simulate Object-Centric Petri Nets (OCPNs). This guide will help you understand how to use the various features of the editor.

## Basic Navigation

- **Toolbar**: Contains tools for creating places, transitions, and arcs
- **Sidebar**: Provides access to properties and declarations
- **Canvas**: The main editing area where you build your Petri Net

## Creating Elements

### Places
- Click the circle icon in the toolbar and drag it onto the canvas
- Configure properties in the sidebar:
  - Label: Name of the place
  - Color Set: Type of tokens the place can hold
  - Initial Marking: Initial tokens in the place. This can contain code expressions like "5+2".

### Transitions
- Click the square icon in the toolbar and drag it onto the canvas
- Configure properties in the sidebar:
  - Label: Name of the transition
  - Guard: Condition that must be true for the transition to fire
  - Time: Time delay for the transition
  - Priority: Execution priority
  - Code Segment: Rhai code to execute when the transition fires

### Arcs
- Click on a source node, then click on a target node to create an arc
- Configure the arc inscription in the sidebar

You can use the following notation for multisets:
```
✅ [x,x] --> consume the same token twice
❌ [x,y] --> not supported to bind two tokens
✅ [x,x,x,x,x] --> consume five tokens with the same value
```

For legacy reasons, we also support the Standard ML notation used in CPN Tools:
```
✅ 2`x --> consume the same token twice
```

### Batch Editing

Select multiple places or multiple transitions at once (click-drag a selection box, or `Shift`/`Ctrl`/`Cmd`-click individual nodes) to edit properties shared across all of them in a single step. The sidebar shows a "Places Selected" / "Transitions Selected" panel where changing a field (e.g. color set, priority, or override color) applies it to every selected node at once. A field only shows a value when all selected nodes currently share it; otherwise it appears blank until you set one explicitly.

## Declarations

### Color Sets
Define the types of tokens that can be used in your Petri Net:
- **Basic types**: `UNIT`, `INT`, `BOOL`, `STRING`
- **Record types**: Structured objects with named fields
- **Product types**: Tuples of values

#### UNIT Color Set
The `UNIT` color set represents anonymous tokens (like classical Petri Nets). These are displayed as bullets (•) in places. Use UNIT for resources that don't need individual identity, like generic capacity tokens.

#### Record Color Sets for Object Types
For object-centric process mining, define record types with an `id` field:

```
colset Aircraft = record id: INT * typeCode: STRING * airline: STRING * carrierType: STRING;
colset Gate = record id: INT;
colset FuelTruck = record id: INT;
```

**Important**: The `id` field is used to uniquely identify objects in OCEL 2.0 exports. Without an `id` field, objects cannot be properly tracked across events.

### Variables
Define variables that can be used in arc inscriptions and guards.

```
ac : Aircraft
gate : Gate
ft : FuelTruck
```

### Functions
Define Rhai functions that can be used in your Petri Net.

## Declare Constraints

Declare constraints let you express declarative, LTL-based behavioral rules ("if A happens, B must eventually happen too") without redesigning the net's control flow — the same idea as CPN Tools' Declare plugin. Unlike a [Monitor](#monitors) breakpoint, which stops the simulation *after* a violation, Declare constraints are enforced **proactively**: a transition firing that would break a constraint is simply excluded from the enabled set, so the constraint can never actually be violated during a run.

### Binary Constraints (between two transitions)

1. Click the **Declare Constraint** tool in the canvas toolbar (next to Arc Mode) and pick a template from the dropdown — the template determines the constraint arc's color family.
2. Drag from the source transition to the target transition, just like drawing a normal arc.
3. Select the arc to open **Declare Constraint Properties**, where you can change the template, enable/disable the constraint, and see its live acceptance state once a simulation is running.

| Family | Template | Meaning |
|--------|----------|---------|
| Ordering (green) | Response | If A fires, B must eventually fire afterward |
| | Precedence | B may only fire if A has fired at least once before |
| | Succession | Response + Precedence combined |
| | Alternate Response | Like Response, but A cannot fire again until B does |
| | Alternate Precedence | Like Precedence, but each B needs a fresh A since the last B |
| | Alternate Succession | Alternate Response + Alternate Precedence combined |
| | Chain Response | B must be the very next transition to fire after A, system-wide |
| | Chain Precedence | A must be the transition that fired immediately before B, system-wide |
| | Chain Succession | Chain Response + Chain Precedence combined |
| Existence (purple) | Responded Existence | If A fires, B must fire too — in either order |
| | Co-Existence | A fires if and only if B fires |
| | Choice | At least one of A or B must fire |
| | Exclusive Choice | Exactly one of A or B must fire, never both |
| Negation (red) | Not Succession | Once A fires, B may never fire afterward |
| | Not Coexistence | A and B must never both fire in the same run |
| | Not Chain Succession | B may never fire as the immediate next event after A (but may fire later) |

Constraint arcs are colored live according to their acceptance state while simulating: grey/neutral before any relevant activity, amber once activated but not yet resolved (e.g. Response after A has fired, before B), green once satisfied, and red (with a pulsing animation) on the transition that is currently blocked from firing because of that constraint.

### Unary Constraints (on a single transition)

Some rules only concern one transition's firing count or position in the run, not a relationship between two transitions. Select a transition and use the **Declare Constraint** section in its Properties panel to add one:

| Template | Meaning |
|----------|---------|
| Existence(n) | Must fire at least `n` times |
| Absence(n) | Must fire at most `n − 1` times |
| Exactly(n) | Must fire exactly `n` times |
| Init | Must be the first transition to fire, system-wide |
| Last | Must be the last transition to fire, system-wide |

A transition can carry only one unary constraint at a time (shown as a small "roof" tag above the node on the canvas), matching CPN Tools' convention.

### Managing Constraints

The **Constraints** section in the Model sidebar lists every Declare constraint (unary and binary) across the whole net. Click one to jump to its location on the canvas. Toggle the **Declare Constraint Layer** button in the toolbar to show or hide all constraint arcs and roof tags without deleting them.

## Rhai Scripting Language

OCPN Studio uses [Rhai](https://rhai.rs/) as its scripting language for guards, arc inscriptions, and functions.

### Basic Syntax

```rhai
// Variables and arithmetic
let x = 5;
let y = x + 10;

// Conditionals
if x > 3 { "big" } else { "small" }

// Functions
fn double(n) { n * 2 }
```

### Record Access (Dot Syntax)

Access record fields using dot notation:

```rhai
// Given: ac is an Aircraft with fields id, typeCode, airline, carrierType

ac.id           // Access the id field
ac.airline      // Access the airline field
ac.carrierType  // Access the carrierType field

// Use in guards:
ac.carrierType == "full"    // Check if carrier is full-service
ac.airline == "LH"          // Check if airline is Lufthansa
```

### Guards

Guards are boolean expressions that control when a transition can fire:

```rhai
// Simple comparison
ac.carrierType == "full"

// Multiple conditions with AND
ac.carrierType == "full" && ac.airline == "LH"

// Multiple conditions with OR
ac.carrierType == "low" || ac.airline == "FR"

// Numeric comparisons
order.quantity > 10
```

### Arc Inscriptions

Arc inscriptions define which tokens are consumed or produced:

```rhai
// Simple variable (consume/produce a token bound to ac)
ac

// UNIT token literal
()

// Conditional expression
if order.priority == "high" { fastTrack } else { normalQueue }
```

## Code Expressions

Code expressions can be used for arc inscriptions, guards, and initial markings.

Here are some examples of valid code expressions for arc inscriptions:

```
✅ 1
✅ var1
✅ "test"
```
OCPN Studio will always try to bind a variable, therefore, a simple string like this will not work (except if "test" is a declared variable):
```
❌ test
```
You can even use a ternary expression like this:
```
✅ if y < 2 { 5 } else { 10 }
```

## Code Segments

Code segments let you run Rhai statements when a transition fires. They execute **after** input arc bindings are established but **before** output arc inscriptions are evaluated, so you can compute new values and use them in output arcs.

### How They Work

1. All variables bound by input arcs are available in the code segment
2. Any variables you define in the code segment can be referenced by output arc inscriptions
3. Code is written as bare Rhai statements (no `fn` wrapper needed)

### Example: Spawning Dynamic Records

Suppose you have an `Aircraft` record color set:

```
colset Aircraft = record flightNr: STRING * airline: STRING;
```

A transition's code segment can dynamically create aircraft tokens with random attributes:

```rhai
let airlines = ["SkyWing", "BlueTail", "NordJet", "SunHorizon"];
let flight_nr = "FL" + to_string(discrete(100, 999));
let idx = discrete(0, 3);
let aircraft = #{flightNr: flight_nr, airline: airlines[idx]};
```

The output arc inscription then simply references `aircraft` to place the new token.

### Example: Computing Derived Values

```rhai
// Input arc binds `order` from an Order place
let total = order.quantity * order.price;
let priority = if total > 1000 { "high" } else { "normal" };
```

Output arcs can then use `total` and `priority` as variables.

### Tips

- Use `#{key: value}` syntax to create record (object map) tokens
- Use `to_string()` to convert numbers to strings
- Random values are available via distribution functions like `discrete(a, b)` — see [Random Distribution Functions](#random-distribution-functions)
- Code segments are compiled once and executed on every firing, so they are efficient for repeated use

## Simulation

### Running Simulations

1. Switch to the **Simulation** tab
2. Click **Step** to execute one transition at a time
3. Click **Run** to execute multiple steps automatically
4. Use **Reset** to return to the initial marking

### Keyboard Shortcuts

Control simulation with keyboard shortcuts (similar to media players):

| Shortcut | Action |
|----------|--------|
| `Space` | Play/Stop animated simulation |
| `Ctrl/Cmd + →` | Execute one step |
| `Ctrl/Cmd + Shift + →` | Fast forward (run multiple steps without animation) |
| `Ctrl/Cmd + ←` | Reset simulation |
| `Escape` | Stop running simulation |

### Enabled Transitions

The **Enabled Transitions** panel in the Simulation sidebar lists every transition that could fire right now — or, marked with a clock icon, the next transition(s) that would become enabled if simulated time were advanced. Click a transition's name to select and zoom to it on the canvas without leaving Simulation mode; click the ▶ button next to it to fire that specific transition immediately.

### Fire Mode

Toggle **Fire Mode** (the cursor icon next to the Enabled Transitions heading) to click transitions directly on the canvas instead of using the panel list. Clicking an enabled transition fires it right away; if the transition is only enabled at a future point in time, firing it eagerly advances the simulation clock to that time and shows a toast confirming how far time moved.

### Live Marking Editing

While a simulation is running, a selected place's Properties panel shows both its **Initial Marking** (fixed, only takes effect on the next reset) and its **Current Marking (live)** — the place's actual token content right now. Use the **Edit** button next to Current Marking to open the same structured table editor used for initial markings, add or remove individual tokens, and apply the change immediately without restarting the run. This is useful for testing edge cases or nudging a stuck simulation without losing your progress.

### Event Log

The simulation records all transition firings in the Event Log:
- Each event shows consumed and produced tokens
- UNIT tokens are displayed as bullets (•)
- Expand an event to see full token details

## Monitors

Monitors observe a running simulation and collect statistics without affecting how the net fires — useful for performance analysis and debugging. Add one from the **Analysis** tab.

| Type | What it does |
|------|--------------|
| Marking Size | Tracks the token count on selected places over the course of the run |
| Transition Count | Counts firings of selected transitions |
| Place Breakpoint | Stops the simulation when a chosen place meets a condition (e.g. becomes empty) |
| Transition Breakpoint | Stops the simulation when a chosen transition fires |
| Duration | Measures the time between a start transition and a matching end transition, correlated by a shared token attribute (e.g. an object `id`) — useful for cycle-time or lead-time metrics |
| Data Collector | Runs a custom Rhai script after every step to observe and record arbitrary values |

Each monitor computes running statistics (count, sum, average, min, max, standard deviation) that you can inspect in the **Performance Report**, and Breakpoint monitors additionally pause the simulation the moment their condition is met so you can inspect the exact marking that triggered it.

## OCEL 2.0 Export

Export your simulation as an Object-Centric Event Log (OCEL 2.0) for process mining analysis.

### How It Works

1. Run a simulation to generate events
2. Click **Export as OCEL 2.0**
3. Choose JSON format

### Object Types and IDs

**Critical**: For proper OCEL 2.0 export, your record color sets should have an `id` field:

```
colset Order = record id: INT * customer: STRING * amount: INT;
```

- The `id` field becomes the unique object identifier
- Other fields become object attributes
- Objects are tracked across events automatically

### Object Type Prefixes

To avoid ID collisions between different object types, exported object IDs are prefixed with the type name:

| Color Set | Token | OCEL Object ID |
|-----------|-------|----------------|
| Aircraft  | `{id: 1, ...}` | `aircraft_1` |
| Gate      | `{id: 2}` | `gate_2` |
| FuelTruck | `{id: 1}` | `fueltruck_1` |

### Event Relationships with Qualifiers

Each event records which objects were involved, with qualifiers indicating the object type:

```json
{
  "id": "e5",
  "type": "Fueling Start",
  "relationships": [
    { "objectId": "aircraft_3", "qualifier": "aircraft" },
    { "objectId": "fueltruck_1", "qualifier": "fueltruck" }
  ]
}
```

### What Gets Exported

| OCPN Element | OCEL 2.0 Element |
|--------------|------------------|
| Record Color Sets | Object Types |
| Record tokens with `id` | Objects |
| Transitions | Event Types |
| Transition firings | Events |
| Record fields (except id) | Object Attributes |

**Note**: UNIT color sets and basic types (INT, STRING, BOOL) are not exported as object types since they don't represent trackable objects.

## Tips and Tricks

- Use the layout tools to automatically arrange your Petri Net
- Save your work frequently using the save button
- Use the AI Assistant for help with specific modeling questions
- For object-centric modeling, always include an `id` field in your record types
- Use meaningful names for transitions—they become event types in OCEL exports

## Calendar & Time Functions

OCPN Studio provides calendar-aware functions for modeling time-dependent behavior. These require a **Simulation Epoch** to be set (in Simulation Settings), which defines the real-world start time of the simulation.

### Current Time

| Function | Returns | Description |
|----------|---------|-------------|
| `current_time()` | `INT` (ms) | Current simulation time in milliseconds since simulation start |

### Calendar Decomposition

These functions take a simulation time (e.g., from `current_time()`) and return calendar information based on the simulation epoch.

| Function | Returns | Description |
|----------|---------|-------------|
| `hour_of_day(t)` | 0–23 | Hour of the day |
| `minute_of_hour(t)` | 0–59 | Minute of the hour |
| `second_of_minute(t)` | 0–59 | Second of the minute |
| `day_of_week(t)` | 0–6 | Day of week (0=Sunday, 1=Monday, ..., 6=Saturday) |
| `day_of_month(t)` | 1–31 | Day of the month |
| `month(t)` | 1–12 | Month of the year |
| `year(t)` | e.g., 2026 | Year |
| `is_weekend(t)` | `BOOL` | True if Saturday or Sunday |
| `is_workday(t)` | `BOOL` | True if Monday through Friday |

### Scheduling Functions

These return absolute simulation times (in ms) for scheduling future events.

#### Specific Weekday Scheduling

| Function | Returns | Description |
|----------|---------|-------------|
| `next_weekday(dow)` | `INT` (ms) | Next occurrence of weekday `dow` at midnight |
| `next_weekday_at(dow, h, m)` | `INT` (ms) | Next occurrence of weekday `dow` at `h:m` |
| `next_monday()` … `next_sunday()` | `INT` (ms) | Next occurrence of that day at midnight |
| `next_monday_at(h, m)` … `next_sunday_at(h, m)` | `INT` (ms) | Next occurrence of that day at `h:m` |
| `next_hour(h)` | `INT` (ms) | Next occurrence of hour `h:00` |

#### High-Level Scheduling

These functions provide a more natural, composable API for scheduling.

| Function | Returns | Description |
|----------|---------|-------------|
| `at(h)` | `INT` (ms) | Time-of-day value for hour `h` (shorthand for `at(h, 0)`) |
| `at(h, m)` | `INT` (ms) | Time-of-day value for `h:m` |
| `at(h, m, s)` | `INT` (ms) | Time-of-day value for `h:m:s` |
| `next_day_at(h, m)` | `INT` (ms) | Next occurrence of `h:m` on any day |
| `next_workday_at(h, m)` | `INT` (ms) | Next Mon–Fri at `h:m` |
| `next_weekend_at(h, m)` | `INT` (ms) | Next Sat/Sun at `h:m` |
| `next_workday_between(from, to)` | `INT` (ms) | Next Mon–Fri moment in daily window `[from, to)` |
| `next_day_between(from, to)` | `INT` (ms) | Next moment in daily window `[from, to)` on any day |
| `next_weekend_between(from, to)` | `INT` (ms) | Next Sat/Sun moment in daily window `[from, to)` |
| `earliest(a, b, ...)` | `INT` (ms) | Minimum of 2–4 timestamps, or an array |
| `latest(a, b, ...)` | `INT` (ms) | Maximum of 2–3 timestamps, or an array |

> **Note:** The `from` and `to` parameters for `*_between` functions are time-of-day values produced by `at()`.
> If the current simulation time already falls inside the window on a matching day, the current time is returned (i.e., no delay).

#### Utility

| Function | Returns | Description |
|----------|---------|-------------|
| `time_until(t)` | `INT` (ms) | Milliseconds between current simulation time and absolute time `t` |

### Examples

**Guard: only fire during business hours (Mon–Fri, 8:00–17:00)**
```rhai
let t = current_time();
is_workday(t) && hour_of_day(t) >= 8 && hour_of_day(t) < 17
```

**Time delay: wait until next Monday at 8am**
```rhai
time_until(next_monday_at(8, 0))
```

**Time delay: wait until next morning**
```rhai
time_until(next_hour(8))
```

**Guard: only fire on weekends**
```rhai
is_weekend(current_time())
```

**Time delay: wait until the next available work slot (9–12 or 13–17, Mon–Fri)**
```rhai
time_until(earliest(
  next_workday_between(at(9), at(12)),
  next_workday_between(at(13), at(17))
))
```

**Time delay: wait until the next workday at 9:00**
```rhai
time_until(next_workday_at(9, 0))
```

**Time delay: wait until the next weekend morning at 10:30**
```rhai
time_until(next_weekend_at(10, 30))
```

**Time delay: wait until 8am tomorrow (any day)**
```rhai
time_until(next_day_at(8, 0))
```

**Time delay: pick the earliest of two options**
```rhai
time_until(earliest(
  next_workday_at(9, 0),
  next_weekend_at(12, 0)
))
```

## Random Distribution Functions

OCPN Studio supports all 14 random distribution functions from CPN Tools for stochastic simulations. These can be used in time delay inscriptions, arc inscriptions, and guards.

### Available Distributions

| Function | Parameters | Description |
|----------|------------|-------------|
| `bernoulli(p)` | p: probability (0-1) | Returns 1 with probability p, 0 otherwise |
| `beta(a, b)` | a, b: shape parameters (> 0) | Beta distribution on (0, 1) |
| `binomial(n, p)` | n: trials (≥ 1), p: probability | Number of successes in n independent trials |
| `chisq(n)` | n: degrees of freedom (≥ 1) | Chi-squared distribution |
| `discrete(a, b)` | a, b: integers (a ≤ b) | Random integer uniformly in [a, b] |
| `erlang(n, r)` | n: shape (≥ 1), r: rate (> 0) | Erlang distribution (sum of n exponentials) |
| `exponential(r)` | r: rate (> 0) | Exponential distribution with mean 1/r |
| `gamma(l, k)` | l: scale (> 0), k: shape (> 0) | Gamma distribution |
| `normal(m, v)` | m: mean, v: variance (≥ 0) | Gaussian/normal distribution |
| `poisson(m)` | m: mean (> 0) | Poisson distribution |
| `rayleigh(s)` | s: scale (≥ 0) | Rayleigh distribution |
| `student(n)` | n: degrees of freedom (≥ 1) | Student's t-distribution |
| `uniform(a, b)` | a, b: bounds (a ≤ b) | Continuous uniform on [a, b] |
| `weibull(lambda, k)` | lambda: scale (> 0), k: shape (> 0) | Weibull distribution |

### Using Distributions in Time Delays

Time delays can use random distributions for realistic process modeling. Combine delay functions with distributions:

```rhai
// Exponential service time with mean 10 minutes (rate = 1/10 = 0.1)
delay_min(exponential(0.1))

// Normal processing time: mean 30 min, variance 25 (std dev = 5 min)
delay_min(normal(30.0, 25.0))

// Uniform delay between 5 and 15 seconds
delay_sec(uniform(5.0, 15.0))

// Erlang distribution for multi-phase service (k=3 phases, rate=0.2)
delay_min(erlang(3, 0.2))
```

### Practical Examples

**Airport Ground Handling:**

```rhai
// Landing takes 4-6 minutes (uniform)
delay_min(uniform(4.0, 6.0))

// Fueling time: exponential with mean 20 min (rate = 0.05)
delay_min(exponential(0.05))

// Passenger boarding: normal, mean 25 min, variance 25
delay_min(normal(25.0, 25.0))
```

**Manufacturing Process:**

```rhai
// Machine processing with Weibull distribution
delay_min(weibull(100.0, 2.5))

// Random batch size between 1 and 10
discrete(1, 10)
```

### Using Distributions in Arc Inscriptions

```rhai
// Produce a token with random quantity
{ id: nextId(), quantity: discrete(1, 10) }

// Random sensor reading
{ sensor: s.id, value: normal(20.0, 4.0) }
```

### Using Distributions in Guards

```rhai
// 80% chance of taking this path
bernoulli(0.8) == 1

// Only process if random value exceeds threshold
uniform(0.0, 1.0) > 0.3
```

## Migration Guide

### Importing PNML files

OCPN Studio provides partial support for the **PNML** format (Petri Net Markup Language, ISO/IEC 15909-2). You can open `.pnml` files via the **Open** dialog or import them as subpages.

**What is imported automatically:**
- Places, transitions, and arcs with their names and positions
- Place types from `<type>` elements (e.g., `SITE`, `MESSAGE`) — corresponding color sets are created automatically
- Arc inscriptions from both `<inscription>` (P/T nets) and `<hlinscription>` (high-level nets), e.g., `1\`x`
- Initial markings from `<initialMarking>` and `<hlinitialMarking>`, e.g., `U()`
- Sort declarations (`<arbitrarysort>`, `<namedsort>` including product sorts) → color sets
- Variable declarations (`<variabledecl>`) → variables with correct sort references
- Standard built-in sorts are mapped: `DOT`→unit, `BOOL`→bool, `INT`/`INTEGER`/`NAT`/`POS`→int, `STRING`→string

**Manual work typically needed after import:**
- Abstract sorts (like `SITE`) are imported as `unit` — you may need to change their definition to match your domain (e.g., an enumeration or record type)
- Operator declarations (`U()`, `S(x)`, `R(x)`) from the PNML are not imported as functions — you'll need to define these manually
- Complex arc inscription structures (the XML `<structure>` trees) are not interpreted; only the `<text>` representation is used
- Guards and conditions need to be added manually if the original model used them
- The `<toolspecific>` data from other tools (e.g., ePNK diagram info) is ignored

You can also **save** OCPN models as `.pnml` files. OCPN-specific data (color sets, guards, time inscriptions, etc.) is preserved in `<toolspecific tool="ocpn-studio">` elements for round-trip compatibility.

### Importing CPN Tools files

After importing a CPN in the `.cpn` format of CPN Tools, some manual adjustments are necessary. Here are the most common ones:

- Guards like `[items = doSomething(order)]` need to be changed to `items = doSomething(order)` (remove the square brackets)
- Functions need to be translated from Standard ML to Rhai (a scripting language embeddable to Rust). We recommend either doing that manually or with the help of an LLM like ChatGPT. The recommended prompt is `Please turn this Standard ML into Rhai script (Rust embedded): fun doo(x: INT): INT = x+1;`. The outcome can be pasted into the function editor of OCPN Studio.

### Standard ML to Rhai Conversion Examples

| Standard ML | Rhai |
|-------------|------|
| `fun f(x) = x + 1` | `fn f(x) { x + 1 }` |
| `if x > 0 then a else b` | `if x > 0 { a } else { b }` |
| `#field record` | `record.field` |
| `hd list` | `list[0]` |
| `tl list` | `list.split(1).1` |
| `length list` | `list.len()` |
