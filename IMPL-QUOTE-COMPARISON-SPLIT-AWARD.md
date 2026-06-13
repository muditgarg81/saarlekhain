# IMPL-QUOTE-COMPARISON-SPLIT-AWARD.md — Saarlekha (Stores & Purchase)

> Solves: **one indent/RFQ covering many items, where no single supplier supplies
> everything and the cheapest price differs per item.** This is the detailed
> expansion of `IMPL-PURCHASE-FLOW.md` §4.3–4.4 (the RFQ → award → PO step). The
> answer is **per-line award + automatic split into one PO per vendor**. Read with
> `IMPL-PURCHASE-FLOW.md` and `GUARDRAILS.md`.

## 1. The model in one picture

```
RFQ-00007  (4 items, sent to 3 vendors)
                     Vendor A      Vendor B      Vendor C        →  Award (L1)      →  POs generated
Item 1  (100 pcs)    ₹50  ◀L1      ₹52           — can't supply     Vendor A 100        PO→A: Item1, Item4
Item 2  (40 pcs)     ₹120          ₹110 ◀L1      ₹118               Vendor B 40         PO→B: Item2, Item3
Item 3  (10 pcs)     — can't        ₹900 ◀L1      ₹950              Vendor B 10
Item 4  (200 pcs)    ₹8  ◀L1       ₹9            ₹8.5               Vendor A 200
```

One RFQ → a comparison matrix → lowest landed price marked per **row** → award
per row → group awarded rows by vendor → **one PO per vendor**, each containing
only that vendor's winning lines. A vendor that can't supply a row simply isn't
ranked for it; a row no one can supply is flagged as an uncovered gap.

## 2. Schema additions (schema `purchase`)

Extend `QuotationLine` so a vendor can decline a line or quote a partial quantity,
and so landed cost + rank are stored for the matrix:

```prisma
model QuotationLine {
  // ...existing: quotationId, rfqLineId, itemId, rate, discount, gstRate...
  canSupply   Boolean @default(true)   // false = "cannot supply this item"
  quotedQty   Float?                   // qty this vendor can supply (null = full RfqLine.qty)
  freight     Float   @default(0)      // per-line freight, if any
  leadDays    Int?
  landedUnit  Float?                   // computed landed unit cost (cached for ranking)
  rank        Int?                     // 1 = L1 (lowest landed) for its RfqLine
  @@schema("purchase")
}
```

Replace the single `RfqLine.awardedQuotationLineId` with an **allocation** table
so a line can be awarded to one vendor (the common case) **or split** across
vendors by quantity:

```prisma
enum AwardReason { L1  LEAD_TIME  APPROVED_VENDOR  CAPACITY_SPLIT  SOLE_SUPPLIER  PARTIAL_AVAILABILITY  OTHER }

model AwardAllocation {
  id              String      @id @default(cuid())
  companyId       String
  rfqLineId       String
  quotationLineId String      // the winning quote (→ vendor, rate)
  vendorId        String
  qty             Float       // qty awarded to this vendor for this line
  reason          AwardReason @default(L1)
  note            String?     // required when reason != L1 (justify non-lowest)
  poLineId        String?     // set when the PO is generated (trace)
  @@index([companyId, rfqLineId])
  @@index([companyId, vendorId])
  @@schema("purchase")
}
```

Each `AwardAllocation` becomes exactly one PO line. The common "Item 1 → Vendor 1"
case is a single allocation for the full qty; a split is two+ allocations.

## 3. Landed cost & L1 (per item, not per RFQ)

For each `QuotationLine` where `canSupply = true`:

```
landedUnit = rate × (1 − discount%) × (1 + gst%) + (freight ÷ effectiveQty)
```

Per `RfqLine`, rank the supplying quotes by `landedUnit` ascending; **rank 1 = L1**.
Lead time and vendor rating are shown as columns but do **not** change the price
ranking — they inform overrides. Ranking compares **landed** cost, not bare rate,
so taxes/discount/freight don't distort the "cheapest" pick.

## 4. Auto-proposed award (then human confirms)

`proposeAward(rfqId)` builds the default allocations:

```
for each RfqLine L (qty = need):
  candidates = quotes with canSupply, ordered by landedUnit (L1, L2, …)
  remaining = need
  for q in candidates while remaining > 0:
     take = min(remaining, q.quotedQty ?? need)
     add AwardAllocation{ rfqLine=L, quote=q, vendor=q.vendor, qty=take,
                          reason = (q.rank==1 ? L1 : PARTIAL_AVAILABILITY) }
     remaining -= take
  if remaining > 0: flag L as SHORT (Σ available < need)
  if no candidates: flag L as UNCOVERED (no vendor can supply)
```

So:
- **Whole-line, different vendors** (your main case): each item's full qty goes to
  its own L1 → items naturally land on different vendors.
- **Partial availability**: if the L1 vendor can only supply part of the qty, the
  remainder rolls to L2 automatically (a quantity split), flagged so the buyer
  sees it.
- **Uncovered / short** lines are surfaced, not silently dropped.

The buyer reviews the matrix and can **override** any cell: pick a non-L1 vendor,
or split a line across vendors manually. Overriding away from L1 **requires an
`AwardReason` + note** (governance: justify not taking the lowest price). Then
`awardRfq` commits the allocations and moves the RFQ to `AWARDED`.

## 5. Generate the POs (split by vendor)

`raisePoFromAward(rfqId)` (extends IMPL-PURCHASE-FLOW §4.4):

```
group AwardAllocations by vendorId
for each vendor group → create ONE PurchaseOrder (DRAFT):
  for each allocation:
     PoLine{ itemId, qty = allocation.qty, rate = quote.rate, discount, gstRate,
             quotationLineId, rfqLineId, prLineId }   // full trace preserved
     allocation.poLineId = poLine.id
  run MOQ / min-order check (below)
  PO → PENDING_APPROVAL
mark covered RfqLines done; SHORT/UNCOVERED lines stay open for re-RFQ
```

One RFQ thus yields N POs — one per winning vendor — each independently approved
by value tier and sent. Every PO line still traces back to its quote → RFQ line →
PR line → indent line.

## 6. Guards & edge cases (the real-world ones you hit)

- **A vendor supplies only some items** — handled by `canSupply=false` / no quote
  on those lines; that vendor is simply absent from those rows.
- **Cheapest differs per item** — L1 is computed per row, so the award naturally
  spreads across vendors. No "award the whole RFQ to one vendor" assumption.
- **No vendor can supply a line** (`UNCOVERED`) — block silent omission; offer
  "re-RFQ to more vendors", "substitute item", or "short-close that line".
- **Total available < required** (`SHORT`) — allocate what exists, flag the
  shortfall, keep the line open for a follow-up RFQ.
- **MOQ / minimum order value** — a split can produce a tiny PO below a vendor's
  MOQ or min-order-value. Check at PO generation; **warn** (don't hard-block) and
  let the buyer consolidate (award more lines to that vendor) or accept. Store MOQ
  on `Vendor`/`Item` as needed.
- **Ties** on landed cost — tie-break by lead time, then vendor rating, then leave
  for manual pick.
- **Non-L1 award** — always allowed, but the reason + note is mandatory and
  audited, so "why didn't we take the lowest?" is answerable later.
- **Rate-contract items** — may skip RFQ entirely (IMPL-PURCHASE-FLOW §5); they
  don't enter the comparison.

## 7. Comparison-matrix UI

- Rows = items (RfqLines), columns = vendors; cell = landed unit price (or "—"
  for can't-supply); **L1 highlighted** per row; lead time / rating shown on hover.
- A live "**award split**" summary panel shows the resulting POs per vendor and
  their values as the buyer edits cells.
- Per-row controls: accept L1, choose another vendor, or "split…" (enter qty per
  vendor). UNCOVERED/SHORT rows badged in red.
- "Generate POs" produces the per-vendor POs in one action.

## 8. Endpoints

| Action | Method · Path |
|---|---|
| comparison matrix (landed + L1) | GET `/api/rfqs/:id/comparison` |
| propose default award | POST `/api/rfqs/:id/propose-award` |
| commit award (allocations) | POST `/api/rfqs/:id/award` |
| generate POs (split by vendor) | POST `/api/rfqs/:id/raise-po` |

## 9. Definition of done

- One RFQ with many items, quoted by several vendors with gaps, yields a
  comparison matrix with the lowest landed price marked per item.
- Accepting the proposal generates one PO per winning vendor, each holding only
  that vendor's lines, fully approved and traceable to the originating indent.
- A vendor unable to supply an item is excluded from that item only; an item no
  one can supply is flagged, never dropped.
- A single item's quantity can be split across vendors when availability requires
  it; any non-lowest award carries a recorded reason.
