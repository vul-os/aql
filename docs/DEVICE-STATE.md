# Machine-readable device state

**Status: the catalogue half is built; the driver mapping is not.** §3's
declaration is code — `StateSpec` on `Capability`, declared for lighting and
jobs, read by `devices.ActiveFrom` with UNKNOWN as a first-class answer. What is
not built is §5's first open question: how a driver says "my configured metric
IS that state". Until it does, a device whose driver emits an undeclared metric
name resolves to unknown, which §3.3 requires to be excluded from any count and
said — so the missing half fails in the safe direction rather than silently.

This document exists because the question came up as a blocker on a shipped
feature, and answering it in a commit message would have decided a contract
every driver participates in, in a place nobody re-reads.

The blocker: `docs/CHAT-COMMANDS.md` §4.2 wants "which lights are on" answered,
and the hub cannot answer it honestly. That is not plumbing — the machinery to
carry the answer exists and is tested. It is that **nothing in the product knows
what "on" means for a given device.**

---

## 1. What exists today

Two representations of a device's state, and neither is usable for this.

**`Device.Summary`** is free text a driver wrote for a human: `"62% · warm"`,
`"docked"`, `"21.5°C"`. `devices/model.go` documents it as *"presentational;
never parsed"*, the console honours that (`summaryLine` renders it verbatim),
and `devices/summarycontract_test.go` now denies parsing it in Go. Counting
lights from it would mean guessing at each driver's wording and reporting the
guess as a fact about someone's home.

**`Reading{Metric, Value, Text}`** from `Registry.Read` is structured, and is
the right shape. `Reading.Metric`'s own comment says it uses *"the capability's
own vocabulary ('level', 'celsius', 'kw', 'percent')"*.

**That vocabulary is not declared anywhere.** The catalogue declares argument
names for verbs — `{Verb: VerbSet, Arg: "level", Min: 0, Max: 100}` — and
declares nothing about reads. So the vocabulary is a convention in a comment,
and a consumer wanting "is this light on" has no contract to consult.

## 2. Why the catalogue cannot simply own the vocabulary

This is the part that makes the problem interesting rather than clerical, and it
is why the fix is not "add a `Reads []string` to each capability".

**Three of the five in-tree drivers let the OPERATOR name the metric.** MQTT,
Modbus and the generic HTTP driver all take the metric name from configuration
(`st.Metric`, `m.Metric`); what the drivers emit in practice today is:

| Driver | Metrics seen |
|---|---|
| mqtt | `celsius`, `level`, `state`, plus whatever config names |
| modbus | `celsius`, `kw`, `kwh`, `volts`, plus config |
| httpdev | `battery`, `level`, `percent`, `state`, plus config |
| camera | `media_flowing`, `media_lost`, `media_packets`, `profile`, `reachable` |
| accessdev | none — it declares `CapAccessStatus` and reads nothing |

So a hub seeing `level` on an MQTT topic does **not** know it means a light's
brightness. The operator chose that word. It might be a water tank. Inferring
otherwise is the same class of guess as parsing `Summary`, one layer down.

## 3. The decision

**A capability declares a SEMANTIC state, and a driver MAPS its metric onto it.
The mapping is configuration an operator states, never inference.**

Concretely, the catalogue gains, per capability, an optional declaration of what
its state means:

```go
// StateSpec declares the reading that answers "what is this device doing".
type StateSpec struct {
    Metric string // the semantic name, e.g. "level" for light.dimmable
    // ActiveAbove makes a NUMERIC state answerable: a reading strictly above
    // it is active. nil means the state is carried in Reading.Text instead,
    // and ActiveText lists the values that mean active.
    ActiveAbove *float64
    ActiveText  []string
}

// Absent entirely for capabilities where "active" is not a meaningful
// question: a thermostat setpoint is not on or off.

// The AS-BUILT shape dropped the separate `Numeric bool` the first draft
// carried. Two fields that must disagree with each other are two chances for a
// capability to declare a state nothing can resolve; ActiveAbove being nil
// carries the same information and cannot contradict itself.
// TestEveryDeclaredStateIsUsable holds that: exactly one of the two must be set.
```

and a driver's configuration gains a way to say *this topic is that semantic
state*. A driver that says nothing reports readings exactly as it does now, and
its devices simply have no machine-readable state — which is the honest answer
for a device nobody has told the hub about.

### 3.1 Why a declaration rather than a heuristic

A heuristic ("a metric called level between 0 and 100 is probably brightness")
is right often enough to be trusted and wrong often enough to matter. The
failure is silent and lands in a sentence about somebody's home. A declaration
is wrong only when an operator states something wrong, which is a different
thing: it is visible, correctable, and theirs.

### 3.2 Why "active" and not "on"

`on` is a verb in the catalogue. Reusing the word for a state invites code that
assumes `Active == true` implies the `on` verb succeeded, or that sending `on`
makes `Active` true — neither of which is knowable without reading the device
again. **Active is an observation. On is a command.** They are related by
physics, not by identity, and this product has already spent a section of
`CHAT-COMMANDS.md` on the difference between a command that was acknowledged
and a barrier that moved.

### 3.3 Unmapped devices are excluded and SAID to be

A fleet where three lights have a declared state and seven do not cannot be
summarised as "2 of 10 are on". Any count must be over the devices whose state
the hub actually knows, and must say how many it left out — the same rule
`CHAT-COMMANDS.md` §4.4 rule 2 imposes on truncated pickers, for the same
reason: a partial answer that reads as complete is worse than a smaller one that
admits its edges.

### 3.4 State is read, not cached

`Registry.Read` polls the driver. This design does not add a cached state field
to `Device`, because a cached value has an age and nothing in the model carries
one — and a stale "off" reported as current is exactly the failure §4.1 refuses
for the gate sensor. A consumer that wants state pays for a read, or does
without.

## 4. What this unblocks, and what it does not

Unblocks: `CHAT-COMMANDS.md` §4.2's "which lights are on", behind §4.4 rule 6's
per-location consent, which is already built.

Does not unblock, and worth saying so: **automations that trigger on state.** A
rule like "when the porch light has been on for an hour" needs state HISTORY,
which is a store and a retention question of its own — closer to
`CAMERA-RETENTION.md` than to this. Nothing here should be read as designing it.

## 5. Open questions this document does not settle

- **Where the mapping lives.** Driver config is the obvious home, but a device
  claimed from discovery has no config file entry. It may want to be a hub-side
  per-device setting instead, which is a table and a migration.
- **Whether `Active` belongs on the capability or the device.** A dimmable light
  and a switch have different notions of it; a driver that exposes both on one
  device would need per-capability states, which the shape above does not carry.
- **Multi-metric states.** A colour bulb's "on" may be brightness OR a scene
  being set. One metric is enough for every in-tree case today and may not stay
  that way.
