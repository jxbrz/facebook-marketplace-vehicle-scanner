# Kelmar Vehicle Sourcing Platform - Project Roadmap

Last Updated:
2026-07-26

## Vision

The goal is to transform the current Facebook Marketplace vehicle scanner into a complete vehicle sourcing intelligence platform for Kelmar Vehicles Ltd.

The end goal is:

"One website where the dealership can discover, evaluate, manage, and sell vehicles."

The system should eventually replace manual processes involving:
- Facebook Marketplace searching;
- spreadsheets;
- notes;
- saved vehicles;
- stock tracking;
- customer workflow.

---

# Current System

## Components

## 1. Browser Extension

Repository:
facebook-marketplace-vehicle-scanner

Purpose:
- Discover Facebook Marketplace vehicle listings;
- Extract vehicle information;
- Apply buying filters;
- Upload results.

Current capabilities:
- Marketplace scanning;
- Saved searches;
- Filtering;
- Match/reject decisions;
- Diagnostics;
- Upload lifecycle.

---

## 2. Dashboard

Repository:
facebook-web-filter

Purpose:
- View scan results;
- Save vehicles;
- Add notes;
- Track statuses.

Current capabilities:
- Vehicle workflow;
- Saved vehicles;
- Scan history;
- Admin dashboard.

---

# Current Architecture

Current flow:

Facebook Marketplace
        |
        |
Browser Extension
        |
        |
Discovery
        |
        |
Card extraction
        |
        |
Static extraction
        |
        |
Rendered extraction (slow path)
        |
        |
Filtering
        |
        |
Upload
        |
        |
Dashboard


---

# Current Major Problem

## Scanner Performance

The scanner works but is too slow.

Observed:

- ~250-400 listings per 10 minutes.
- Previous versions achieved much higher throughput.

Primary bottleneck:

Rendered extraction.

Current expensive flow:

Listing discovered

↓

Open Facebook advert

↓

Rendered extraction

↓

Gallery extraction

↓

Filtering

↓

Reject

Many rejected vehicles pay the full extraction cost.

---

# Performance Audit Findings

Main bottlenecks:

## 1. Rendered extraction happens too often

Goal:

Make rendered extraction an exception.

Only render when decision-critical information is unavailable.

---

## 2. Gallery extraction happens too early

Current:

Extract gallery before final decision.

Future:

Extract:

1. Decision fields
2. Evaluate
3. Gallery only for matches

---

## 3. Queue architecture

Current:

Workers remain occupied while waiting for rendered extraction.

Future:

Separate:

Fast decision queue

↓

Rendered decision queue

↓

Enrichment queue


---

## 4. Duplicate handling

Important:

Do NOT globally ignore listings.

A vehicle can be rejected in one saved search and accepted in another.

Correct model:

Listing facts:

Global

+

Search-specific decisions


Example:

VW Polo

Low Polo Search:
Rejected - too expensive

High Polo Search:
Matched


Duplicate handling must include:
- saved search ID;
- filter fingerprint;
- scan context.

---

# Current Optimisation Roadmap

## Phase 1 - Reduce rendered extraction

Priority: HIGH

Implement:

- trusted early rejection;
- decision completeness;
- avoid rendering when outcome is already known.

Expected impact:

Major reduction in rendered inspections.

---

## Phase 2 - Decision-first rendered extraction

Priority: HIGH

Change:

Current:

Open advert
→ full extraction
→ gallery
→ decision

Future:

Open advert
→ decision fields
→ evaluate
→ enrichment only if needed


---

## Phase 3 - Queue improvements

Priority: MEDIUM

Split:

- discovery;
- decision;
- enrichment.

Prevent expensive listings blocking fast decisions.

---

## Phase 4 - Search intelligence

Priority: HIGH

Move away from infinite scrolling.

Future:

Saved searches generate multiple queries:

Example:

Volkswagen Polo:

- VW Polo
- Volkswagen Polo
- Polo Match
- Polo SE


Results are combined and deduplicated.

---

## Phase 5 - Context-aware caching

Priority: MEDIUM

Do not restore old global cache.

Instead:

Cache:

Vehicle facts

Example:

- year;
- mileage;
- model;
- images.

Evaluate separately:

- Low Polo search;
- High Polo search.

---

# Long-Term Vision

## Automated sourcing engine

Future architecture:

Cloud scheduler

↓

Saved searches

↓

Marketplace acquisition

↓

Vehicle scoring

↓

Notifications

↓

Dashboard


Example notification:

"Potential vehicle found:

2019 Volkswagen Polo Match

£6,495

42,000 miles

15 miles away

Estimated margin: £1,500"

---

# Server Idea

Eventually:

The server becomes the brain.

The browser extension becomes a data collector.

The server handles:

- scheduling;
- history;
- scoring;
- notifications;
- analytics.

Do not implement until scanner performance is solved.

---

# Important Decisions

## Keep browser-based Marketplace acquisition

Reason:

- Uses normal Facebook session;
- Avoids unreliable unofficial APIs;
- Matches real Marketplace behaviour.

---

## Do not increase concurrency blindly

More tabs does not equal more speed.

Risk:

- Facebook throttling;
- memory issues;
- account restrictions.

---

## Do not build full dealership software yet

Priority:

1. Make scanner excellent.
2. Make sourcing intelligent.
3. Expand dashboard.
4. Add dealership operations.

---

# Current Next Task

Implement:

Performance Phase 1:

"Reduce unnecessary rendered extraction."

Expected changes:

- better early rejection;
- decision completeness;
- diagnostics.

Do not change:
- Marketplace acquisition;
- dashboard;
- permissions;
- database schema.

---

# Future Product Vision

Kelmar Platform:

Sourcing
+
Stock
+
Preparation
+
Sales
+
Customer Management

One system for the dealership.