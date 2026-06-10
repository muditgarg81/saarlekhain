# PO-TERMS-PRESETS.md — Saarlekha (Stores & Purchase)

> Selectable **Terms & Conditions presets** for purchase orders. A user picks a
> preset when raising a PO; the **company's identity (name, address, GSTIN,
> governing place) auto-fills** from `core.Company`, so the same preset reads
> correctly for every tenant with no hard-coded company name. The comprehensive
> preset below is modelled — in coverage and structure — on a full corporate
> GTC supplied as a reference; the clause wording here is **original and
> de-branded**. **Not legal advice — have counsel review before use.**

## 1. How presets work

- **Seeded + customizable.** Saarlekha ships a catalog of system presets (§4).
  A company may clone any preset and edit the text/defaults; the company copy
  overrides the system one.
- **Selection at PO time.** Each preset declares which `PoType`s it suits and
  whether it is the default for them. On PO creation the matching default is
  pre-selected; the user can switch to any active preset.
- **Auto-fill.** Identity tokens resolve from `core.Company` of the **logged-in
  tenant** — this is what makes the company name change automatically. Commercial
  tokens (LD %, warranty, credit days) resolve from the PO, the Vendor, and the
  company `PoTermsConfig`.
- **Freeze on issue.** At PO generation the preset is **rendered to final text**
  and that resolved text is stored on the PO (`resolvedTermsText`) with the
  preset id + version. Later edits to a preset never alter terms a Supplier has
  already accepted on an issued PO.

## 2. Schema (merge into schema `purchase`)

```prisma
enum TermsPresetStatus { ACTIVE  ARCHIVED }

model PoTermsPreset {
  id          String   @id @default(cuid())
  companyId   String?            // null = system/global seed; set = company-owned copy
  key         String             // slug, e.g. "comprehensive-goods-services"
  name        String             // shown in the picker
  description String?
  appliesTo   PoType[]           // REGULAR | CAPITAL | SERVICE | IMPORT | BLANKET
  isDefault   Boolean  @default(false)   // default for its appliesTo types
  bodyMarkdown String            // template text with {{TOKENS}}
  tokenDefaults Json?            // preset-level overrides for commercial tokens
  version     Int      @default(1)
  status      TermsPresetStatus @default(ACTIVE)
  createdAt   DateTime @default(now())

  @@unique([companyId, key])
  @@index([companyId, status])
  @@schema("purchase")
}
```

Add on `PurchaseOrder`:

```prisma
  termsPresetId    String?   // which preset was chosen
  termsVersion     Int?      // preset version at issue
  resolvedTermsText String?  // frozen, fully-merged T&C text stamped on the PO PDF
```

Company-level commercial defaults (one per company) used by every preset:

```prisma
model PoTermsConfig {
  id                 String  @id @default(cuid())
  companyId          String  @unique
  inspectionDays     Int     @default(7)
  replacementDays    Int     @default(15)
  returnCollectionDays Int   @default(30)
  qtyTolerancePct    Float   @default(0)
  warrantyMonths     Int     @default(24)
  sparesYears        Int     @default(10)
  ldPctPerDay        Float   @default(0.5)
  ldCapPct           Float   @default(100)   // cap as % of PO value
  creditDays         Int     @default(45)
  latentDefectDays   Int     @default(90)
  fmTerminationDays  Int     @default(45)
  cureDays           Int     @default(30)
  arbitrationForum   String  @default("Arbitration and Conciliation Act, 1996")
  jurisdictionCity   String?                 // defaults to company city
  @@schema("purchase")
}
```

## 3. Token resolution (precedence: PO → Vendor → PoTermsConfig → preset.tokenDefaults)

| Token | Source — **identity tokens auto-fill from the tenant** |
|-------|--------|
| `{{COMPANY_NAME}}` `{{COMPANY_ADDRESS}}` `{{COMPANY_GSTIN}}` `{{COMPANY_CITY}}` `{{GOVERNING_PLACE}}` | **`core.Company` of the logged-in company** |
| `{{PO_NUMBER}}` `{{PO_DATE}}` `{{DELIVERY_TERMS}}` `{{DELIVERY_LOCATION}}` `{{PAYMENT_MODE}}` | `PurchaseOrder` |
| `{{CREDIT_DAYS}}` `{{INSPECTION_DAYS}}` `{{REPLACEMENT_DAYS}}` `{{RETURN_COLLECTION_DAYS}}` `{{QTY_TOLERANCE_PCT}}` `{{WARRANTY_MONTHS}}` `{{LATENT_DEFECT_DAYS}}` `{{SPARES_YEARS}}` `{{LD_PCT_PER_DAY}}` `{{LD_CAP_PCT}}` `{{FM_TERMINATION_DAYS}}` `{{CURE_DAYS}}` `{{ARBITRATION_FORUM}}` `{{JURISDICTION_CITY}}` | `PoTermsConfig` / Vendor / preset defaults |

Render fails closed: an unresolved token blocks PO issue with a clear error
naming the missing field, so no PO ships with a literal `{{...}}`.

## 4. Seeded preset catalog

| key | name | appliesTo | default for |
|-----|------|-----------|-------------|
| `standard-goods-in` | Standard — Goods (India/GST) | REGULAR, IMPORT | REGULAR | (the earlier `PO-TERMS-AND-CONDITIONS.md`) |
| `comprehensive-goods-services` | Comprehensive — Goods & Services | REGULAR, SERVICE, CAPITAL | — | (full text in §5) |
| `capital-equipment` | Capital Equipment & Machinery | CAPITAL | CAPITAL | (§6 toggles) |
| `services-jobwork` | Services / Job-work | SERVICE | SERVICE | (§6 toggles) |

---

## 5. Comprehensive preset — Goods & Services (full text)

> Stored as `bodyMarkdown`. "**Purchaser**" is defined as `{{COMPANY_NAME}}`, so
> the company name flows from one place into every clause and changes per tenant.

**GENERAL TERMS AND CONDITIONS OF PURCHASE**

These General Terms and Conditions ("**GTC**") apply to Purchase Order
No. `{{PO_NUMBER}}` dated `{{PO_DATE}}` placed by **{{COMPANY_NAME}}**,
`{{COMPANY_ADDRESS}}`, GSTIN `{{COMPANY_GSTIN}}` (the "**Purchaser**") on the
supplier named in the Order (the "**Supplier**").

**1. Definitions.** "**Order**" means the Purchaser's purchase order, including its
appendices, specifications, drawings, and technical documents. "**Confirmation**"
means the Supplier's acceptance of the Order, whether by written acknowledgement
or by commencing supply. "**Goods**" means the goods and/or services described in
the Order together with all documents needed to use them safely (plans, data
sheets, test/safety certificates, certificates of conformity). "**Agreement**"
means the Order, these GTC, and the Confirmation; where a signed contract exists,
that contract and these GTC. "**Delivery Point**" and "**Delivery Date**" are the
place and date stated in the Order. "**Price**" is the price in the Order, exclusive
of GST. "**Force Majeure**" means an event beyond a party's reasonable control,
not foreseeable at the date of the Order and not caused by its fault, that makes
performance impossible (for example, natural disaster, fire, flood, war, riot,
epidemic or pandemic, or binding governmental action). "**Governing Place**" means
the jurisdiction in which the Purchaser is incorporated.

**2. The Agreement.** The Supplier's Confirmation is acceptance of the Order on
these GTC. If terms conflict, this order of precedence applies: (i) a signed
contract, (ii) the Order, (iii) these GTC, (iv) the Confirmation. Any term the
Supplier seeks to add is rejected unless a Purchaser's authorised representative
agrees to it in writing. The Agreement is the entire agreement on its subject
matter. The Supplier may not sub-contract any part without the Purchaser's prior
written consent and remains fully responsible for its sub-contractors.

**3. Delivery & risk.** Delivery shall be made on the Delivery Date at the
Delivery Point; **time is of the essence**. If no Incoterm/Delivery Point is
stated, delivery is DDP to the Purchaser's premises (latest Incoterms). Title and
risk pass to the Purchaser on delivery and acceptance at the Delivery Point. The
Supplier shall notify the Purchaser immediately of anything that may affect
performance or timing, and shall carry sufficient insurance for its liabilities
under the Order, evidenced on request.

**4. Late delivery — liquidated damages.** For delay against the Delivery Date,
liquidated damages accrue at `{{LD_PCT_PER_DAY}}`% of the Price per calendar day,
capped at `{{LD_CAP_PCT}}`% of the Price, and apply equally to partial delivery.
These are a genuine pre-estimate of loss, are without prejudice to the
Purchaser's other rights and remedies (including cancellation and risk purchase),
and do not limit recovery of greater losses the Purchaser can document.

**5. Acceptance & inspection.** Goods are subject to inspection and testing at the
Delivery Point. The Purchaser may reject Goods that do not conform to the Order,
specifications, drawings, data, or the Supplier's warranties, within
`{{INSPECTION_DAYS}}` days of receipt. Payment for, or inspection of, Goods is not
acceptance and does not waive any claim. GST documentation (tax invoice with
GSTIN/HSN and, where applicable, a valid IRN/e-invoice and e-way bill) must
accompany each consignment so the Purchaser can avail input tax credit; the
Purchaser may recover any credit lost through the Supplier's non-compliance.

**6. Replacement & rework.** On any defect, shortage, transit damage, or
non-conformity, the Supplier shall — at the Purchaser's election and the
Supplier's cost — repair, replace, rework, or scrap the Goods, or authorise the
Purchaser to do so at the Supplier's cost. Replacement shall be made within
`{{REPLACEMENT_DAYS}}` days of intimation, with all freight, taxes, and handling
both ways to the Supplier's account; replacement Goods are re-inspected on the
same terms. Rejected Goods remain the Supplier's property at the Supplier's risk
and, if not collected within `{{RETURN_COLLECTION_DAYS}}` days, may be returned
freight-to-pay or disposed of at the Supplier's cost. Replacement does not extend
the Delivery Date, and liquidated damages continue until conforming Goods are
accepted. The Supplier is liable for the Purchaser's resulting costs, including
finished-product, raw-material, packaging, freight, sorting, rework, scrap, and
any damage to the Purchaser's stocks, equipment, or goods.

**7. Warranty.** The Supplier warrants good title and that the Goods are (i) fit
for the intended purpose where known, (ii) of merchantable quality and free from
defects in material and workmanship, and (iii) conforming to all specifications,
samples, quantities, and data. The warranty runs for the longer of the Goods'
shelf life or `{{WARRANTY_MONTHS}}` months from the Delivery Date; for defects not
reasonably discoverable, for `{{LATENT_DEFECT_DAYS}}` days from actual discovery.
A fresh `{{WARRANTY_MONTHS}}`-month warranty applies to repaired or replaced
items. For plant and machinery, the Supplier shall ensure spare-parts
availability for `{{SPARES_YEARS}}` years from delivery; these GTC apply to any
repair or spares supply.

**8. Price & payment.** The Price is firm and includes all customs, duties, and
charges applicable to the Goods, and is exclusive of GST, which the Supplier shall
show separately. Modifications require a written change order; the Supplier shall
make no change without prior written consent. Undisputed invoices are due
`{{CREDIT_DAYS}}` days from invoice date by `{{PAYMENT_MODE}}`. No payment is due
for rejected Goods, and the Purchaser may set off amounts owed by the Supplier
(liquidated damages, rejection costs, debit notes). The Supplier shall declare its
MSME/Udyam status; registered micro and small enterprises are paid per the MSMED
Act, 2006.

**9. Intellectual property.** The Supplier grants the Purchaser a worldwide,
perpetual, non-exclusive, transferable right to use the Goods. The Supplier
warrants that the Goods do not infringe any third-party intellectual property and,
if a claim arises, shall promptly secure the Purchaser's right to use them or
modify/replace them to end the infringement. The Supplier shall not use the
Purchaser's name, trademarks, or logos without prior written consent. Intellectual
property in Purchaser-supplied designs, drawings, and tooling remains the
Purchaser's.

**10. Force Majeure.** A party prevented or delayed by Force Majeure shall notify
the other in writing without delay, stating the cause, expected duration, and
remedial steps; it is not in breach for that delay, and the time for performance
extends until the event ends. During such a period the Purchaser may buy
elsewhere, with those volumes deducted from the Order. If the event continues, or
adequate assurance of resumption is not given, for `{{FM_TERMINATION_DAYS}}`
consecutive days, the Purchaser may terminate without liability.

**11. Suspension & termination.** Without affecting other remedies, the Purchaser
may suspend or terminate the Agreement, in whole or part, immediately if the
Supplier: (a) commits a material breach and, if remediable, fails to cure it
within `{{CURE_DAYS}}` days of notice; (b) becomes insolvent, enters
receivership/liquidation/arrangement, or suffers a material adverse change in
financial standing; or (c) breaches or is reasonably expected to breach the
Compliance clause. Termination does not affect accrued rights or any clause
intended to survive.

**12. Compliance & sanctions.** Both parties shall comply with all applicable
laws, regulations, and the Purchaser's published code of conduct. The Supplier
shall not act or omit in a way that exposes the Purchaser to sanctions, asset
freezes, or investigation by any relevant authority. The Purchaser need not
perform where prevented by trade-control, customs, embargo, or sanctions
impediments.

**13. Indemnity.** The Supplier shall indemnify, defend, and hold the Purchaser
harmless against all liabilities, losses, damages, costs, and reasonable legal
fees arising from (i) actual or alleged third-party IP infringement, (ii) the
Supplier's breach of the Agreement, or (iii) any third-party claim arising from
the sale, delivery, or use of the Goods. The Purchaser's inspection does not
relieve the Supplier of liability.

**14. Governing law & dispute resolution.** The Agreement is governed by the law
of the Governing Place (`{{GOVERNING_PLACE}}`), excluding its conflict-of-laws
rules and the UN Convention on Contracts for the International Sale of Goods.
Where both parties are incorporated in the Governing Place, the competent courts
at `{{JURISDICTION_CITY}}` have jurisdiction. Otherwise, disputes shall be finally
resolved by arbitration under `{{ARBITRATION_FORUM}}`, seat `{{JURISDICTION_CITY}}`,
in English, by a sole arbitrator (or three for higher-value disputes as the rules
provide). The award is final and binding.

**15. Confidentiality.** The Supplier shall keep all Purchaser information
confidential, use it only for the Agreement, and not disclose the relationship or
information to third parties. All disclosed information remains the Purchaser's and
shall be returned on request after performance.

**16. Other provisions.** (a) If any provision is invalid, it is modified or
severed to the minimum extent needed, and the rest stands. (b) The Supplier may
not assign or transfer the Agreement without prior written consent and shall
promptly notify any change of control. (c) For work at the Purchaser's site, the
Supplier ensures its personnel and sub-contractors follow the site's rules and
claims no compensation for doing so. (d) The Supplier shall maintain appropriate
cyber-security measures and incident procedures and notify the Purchaser promptly
of any incident affecting it. (e) Where the Supplier processes personal data
received from the Purchaser, it shall ensure protection consistent with applicable
data-protection law (including the Digital Personal Data Protection Act, 2023,
where it applies). (f) The Agreement may be amended only in writing. (g) No delay
in exercising a right is a waiver. (h) Only the parties may enforce the Agreement.
(i) Notices shall be in writing; email is valid where addresses are stated in the
Order. (j) The Supplier shall give the Purchaser reasonable advance notice of any
change to the Goods (including packaging or materials) and obtain agreement that
the change keeps the Goods fit for the Purchaser's use before implementing it.

---

## 6. Variant toggles (Capital, Services presets)

Rather than separate full texts, the Capital and Services presets are the
Comprehensive body with toggled emphasis (kept as separate `bodyMarkdown` copies
so each reads cleanly):

- **Capital Equipment** — strengthen clause 7 (performance guarantee to stated
  parameters, commissioning acceptance, longer `{{SPARES_YEARS}}`); add a
  retention/performance-bank-guarantee clause and provisional-vs-final acceptance.
- **Services / Job-work** — strengthen clause 16(c) (site safety, labour and
  contract-labour compliance, PPE, statutory dues), add GST job-work challan and
  reconciliation references, and tighten confidentiality and personnel control.

## 7. Implementation notes & DoD

- Seed the four presets at company onboarding (system rows, `companyId = null`);
  "Customize" clones to a company-owned row.
- PO screen: a "Terms" picker defaulting to the `isDefault` preset for the PO's
  type; preview shows the **resolved** text.
- On issue: render → store `resolvedTermsText` + `termsPresetId` + `termsVersion`
  on the PO; the PDF prints the frozen text; reissue/amendment re-renders only on
  an explicit new version.
- **Done when:** a user selects a preset, the Purchaser name and identity fill
  automatically from their own company, all tokens resolve (or issue is blocked
  with a named missing field), and the exact accepted terms are frozen on the PO.
