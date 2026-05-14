# Module prefix → domain

oh-admin organizes 15+ domain groups under `routes/<prefix>-<feature>/`. The prefix is required for new features — never create a route without one (unless `defaultDomainPrefix` is explicitly unset).

| Prefix | Domain | Examples |
|---|---|---|
| `fl-` | Flight | `fl-promotion`, `fl-ticketing-list`, `fl-airline-master` |
| `ho-` | Hotel | `ho-reservation-list-ota`, `ho-chain-code`, `ho-room-master` |
| `av-` | Activity | `av-activity-contents`, `av-meeting-point` |
| `car-` | Car rental | `car-master`, `car-promotion` |
| `bs-` | Basis / shared | `bs-event`, `bs-system-code`, `bs-region`, `bs-role` |
| `us-` | User | `us-trader`, `us-client-crm`, `us-consulting` |
| `co-` | Content | `co-faq`, `co-notice`, `co-board` |
| `vd-` | Vendor | `vd-room-message`, `vd-gds-setup` |
| `sm-` | Settlement | `sm-seller-billing`, `sm-vendor-billing`, `sm-invoice` |
| `pm-` | Payment | `pm-cash-receipt` |
| `ps-` | Profit share | `ps-report`, `ps-invoice` |
| `ac-` | Account | `ac-payment-in`, `ac-payment-out` |
| `it-` | Itinerary | `it-planner` |
| `cp-` | Corporate | `cp-position`, `cp-staff`, `cp-department` |
| `ad-` | Admin dashboard | `ad-dashboard`, `ad-dashboard-hotel`, `ad-hardblock-allotments` |

## partners-specific

Partners uses scopes (`routes/seller/<feature>` and `routes/vendor/<feature>`) instead of pure prefixes. When generating for partners, place the feature under the correct scope from config.

## How to derive the prefix from a spec

1. Look at the title and body for domain words. "hotel reservation" → `ho-`, "vendor billing" → `sm-`, "booking cancel" → could be `ho-` or generic `bs-`.
2. Cross-check `catalog.features[*]` — if the spec touches the same domain as an existing module, use the same prefix.
3. When unsure, ask the user. Don't guess `ad-` (admin dashboard) for anything that isn't a dashboard.

## What NOT to do

- ❌ Create a route without a prefix (`routes/booking-cancel/`). Breaks discoverability.
- ❌ Invent a new prefix not in this list. If you truly need one (a brand new domain), ask the user and update this doc.
- ❌ Reuse a prefix incorrectly — e.g. don't put a flight feature under `ho-` because "they're similar."
