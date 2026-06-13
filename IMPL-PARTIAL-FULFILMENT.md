# IMPL-PARTIAL-FULFILMENT.md — Saarlekha (Stores & Purchase)

> Answers: *what happens to items no supplier quoted, and does the indent close
> partially or as a whole?* Completes `IMPL-PURCHASE-FLOW.md` and
> `IMPL-QUOTE-COMPARISON-SPLIT-AWARD.md` by defining **line-level status, header
> rollup, and the routing for uncovered lines.** Principle: **fulfilment is tracked
> per line; a header never auto-closes while any line is still open.**

## 1. Quantities tracked at every level

Partial status needs quantities, not just flags. Each line carries what's been
fulfilled vs what's still open:

```prisma
model IndentLine {
  // ...qty, purchaseQty, issuedQty (from stock)...
  orderedQty     Float @default(0)   // qty that reached a PO
  shortClosedQty Float @default(0)   // qty deliberately dropped, with reason
  status         LineStatus @default(OPEN)
  // openQty = purchaseQty - orderedQty - shortClosedQty
}
model PrLine  { orderedQty Float @default(0)  shortClosedQty Float @default(0)  status LineStatus @default(OPEN) }
model RfqLine { awardedQty Float @default(0)  status RfqLineStatus @default(OPEN) }
```

```prisma
enum LineStatus    { OPEN  PARTIALLY_ORDERED  ORDERED  ISSUED  SHORT_CLOSED  CANCELLED }
enum RfqLineStatus { OPEN  QUOTED  AWARDED  PARTIALLY_AWARDED  UNCOVERED  SHORT  CLOSED }
```

`UNCOVERED` = no supplier quoted it. `SHORT` = suppliers together can't cover the
full qty. Both keep `openQty > 0`.

## 2. How a line moves (the propagation)

When POs are generated from awards (`raisePoFromAward`), quantities bubble **back
up** the trace chain `PoLine → AwardAllocation → RfqLine → PrLine → IndentLine`:

```
on PO line created for qty q:
  rfqLine.awardedQty += q
  prLine.orderedQty  += q     (via rfqLine.prLineId)
  indentLine.orderedQty += q  (via prLine ← indentLine.prLineId)
recompute each line's status from its quantities (§3)
```

So awarding item 1 to Vendor A and item 2 to Vendor B marks *those* indent lines
ordered, while an item nobody quoted stays `OPEN` with its full qty unsourced.

## 3. Line status from quantities (deterministic)

```
open = need - orderedQty - issuedQty - shortClosedQty
if open <= 0 and shortClosedQty == 0      → ORDERED (or ISSUED if from stock)
elif orderedQty > 0 and open > 0          → PARTIALLY_ORDERED
elif open > 0                             → OPEN          (incl. UNCOVERED/SHORT at RFQ level)
if open == 0 and shortClosedQty > 0       → ORDERED/SHORT_CLOSED mix → terminal
if shortClosedQty == need                 → SHORT_CLOSED
```

## 4. Header rollup (partial vs closed)

Header status is **derived from its lines** — it is never set to CLOSED while any
line has `openQty > 0`:

```
INDENT / PR header:
  all lines terminal (ORDERED | ISSUED | SHORT_CLOSED | CANCELLED) → CLOSED
  some lines ORDERED/ISSUED, others still OPEN                     → PARTIALLY_ORDERED
  none ordered yet                                                → (prior state: APPROVED / CONVERTED_TO_PR / RFQ_ISSUED)
```

Add `PARTIALLY_ORDERED` to `IndentStatus` and `PrStatus`, and `SHORT_CLOSED` to
both (for the case where remaining open qty is all deliberately dropped). RFQ
moves to `CLOSED` only when every line is `AWARDED` or terminally
`SHORT_CLOSED`/`UNCOVERED`-resolved.

## 5. Where uncovered / short lines go (off-ramps)

An `OPEN` remainder (UNCOVERED or SHORT) is **actionable**, not dead. It returns
to a **sourcing backlog** (the set of PR lines with `openQty > 0`) and the buyer
picks one route:

1. **Re-RFQ** — `POST /api/rfqs` from the open PR lines to additional/other
   vendors. The new RFQ covers only the open qty; the trace chain continues.
2. **Direct / rate-contract PO** — for items on a blanket/rate contract or a known
   sole supplier, raise a PO for the open qty directly (IMPL-PURCHASE-FLOW §5),
   bypassing a fresh RFQ.
3. **Substitute item** — link an alternate item: short-close the original line for
   the substituted qty (reason `SUBSTITUTED`) and add a new indent/PR line for the
   alternate, which sources normally.
4. **Short-close (terminal)** — the deliberate off-ramp: the buyer closes the open
   qty with a mandatory reason (`NOT_AVAILABLE`, `RESCHEDULED`, `DROPPED`, …).
   This is what lets the header eventually reach CLOSED instead of hanging open
   forever.

```
POST /api/<indent|pr>/lines/:id/short-close   body: { qty, reason, note }
  → shortClosedQty += qty; recompute line + header status; AuditLog
  (permission: indent.approve / pr.approve — short-closing is an approval act)
```

## 6. Don't let open lines get forgotten — reminders

Open sourcing items surface as action items (`IMPL-NOTIFICATIONS.md`) so they
can't silently rot:

- **"Items pending sourcing — no quotes"** (UNCOVERED RfqLines) → owning buyer.
- **"Short supply — partial quotes"** (SHORT RfqLines) → owning buyer.
- **"Indents partially ordered, lines still open"** → store/purchase managers.

## 7. Worked example (continuing the 4-item RFQ)

```
Item 1  100 → Vendor A   ORDERED
Item 2   40 → Vendor B   ORDERED
Item 3   10 → only Vendor B quoted 6   → 6 ORDERED + 4 SHORT  → PARTIALLY_ORDERED (4 open)
Item 4  200 → no quotes  → UNCOVERED (200 open)
```
Result: POs raised to A and B for items 1, 2 and 6 of item 3. The **indent is
`PARTIALLY_ORDERED`**, not closed. Item 3's open 4 and item 4's 200 sit in the
sourcing backlog → buyer re-RFQs item 4, and either re-RFQs or short-closes the 4.
Only once items 3 & 4 are fully ordered or short-closed does the indent → CLOSED.

## 8. Definition of done

- Generating POs from a partial award marks each line by quantity; covered lines
  become ORDERED, uncovered lines stay OPEN with full qty intact.
- An indent/PR header shows `PARTIALLY_ORDERED` while any line is open and reaches
  `CLOSED` only when every line is ordered, issued, or short-closed.
- Uncovered/short lines are reachable from a sourcing backlog with four routes
  (re-RFQ, direct PO, substitute, short-close); short-close is audited and
  permission-gated.
- Open sourcing lines appear as reminders so nothing is lost.
