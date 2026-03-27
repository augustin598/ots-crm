---
name: ads-reporting
description: >
  Skill for digital marketing campaign analysis, reporting, and budget structuring across Google Ads, Meta (Facebook/Instagram) Ads, and TikTok Ads. Use this skill when the user needs help with: ad campaign performance analysis, objective-to-metric mapping, campaign reporting pages or dashboards, budget package structuring (CHF or any currency), client retainer pricing, Facebook Ads budget packages, Google Ads performance reports, TikTok Ads reporting, SEO backlink analysis, or any digital marketing data interpretation. Also use when building reporting features in OTS CRM or when the user mentions campaign objectives, ROAS, CPL, CTR, CPC, CPM, or other ad metrics. Follows a data-first approach: never project metrics before launch, only report confirmed data.
---

# Digital Marketing Ads Reporting Skill

Skill for campaign analysis, reporting, and budget structuring for a multi-platform digital marketing agency (Google Ads, Meta Ads, TikTok Ads).

## Core Principle: Data-First

**Never project or estimate metrics before a campaign launches.** Only report confirmed, visible, factual data. When structuring budget packages for clients, present investment tiers and deliverables without pre-launch metric projections. Post-launch, report only actual platform data.

## Platform-Specific Metric Mapping

### Meta (Facebook/Instagram) Ads

Campaign objectives map to specific primary and secondary KPIs:

| Objective | Primary KPI | Secondary KPIs |
|-----------|------------|-----------------|
| OUTCOME_SALES | Purchases, ROAS | Add to Cart, Checkout Initiated, CPA |
| OUTCOME_LEADS | Leads, CPL | Form Submissions, Lead Quality Score |
| OUTCOME_AWARENESS | Reach, Frequency | CPM, Brand Recall Lift |
| OUTCOME_ENGAGEMENT | Engagements, CPE | Post Reactions, Shares, Comments |
| OUTCOME_TRAFFIC | Link Clicks, CPC | CTR, Landing Page Views, Bounce Rate |
| OUTCOME_APP_PROMOTION | App Installs, CPI | App Events, In-App Actions |

**Reporting rules for Meta:**
- Always show spend vs. results at the campaign level first, then ad set, then ad
- Attribution window: default 7-day click, 1-day view (note in reports)
- Currency: match the ad account currency (often EUR for RO clients, CHF for Swiss clients)
- Breakdowns available: age, gender, placement, device, region

### Google Ads

| Campaign Type | Primary KPI | Secondary KPIs |
|---------------|------------|-----------------|
| Search | Conversions, CPA | CTR, Impression Share, Quality Score |
| Shopping | ROAS, Revenue | Conv. Value, Product-level metrics |
| Display | Reach, View-through Conv. | CPM, Viewable Impressions |
| Performance Max | Conversions, ROAS | Asset performance ratings |
| Video (YouTube) | Views, CPV | View Rate, Earned Actions |
| Demand Gen | Conversions, CPA | Engaged-view conversions |

**Reporting rules for Google Ads:**
- MCC-level overview first (77 total / 41 active accounts)
- Always note campaign type context for metric interpretation
- Quality Score components: Expected CTR, Ad Relevance, Landing Page Experience
- Search terms report for Search campaigns is mandatory

### TikTok Ads

| Objective | Primary KPI | Secondary KPIs |
|-----------|------------|-----------------|
| Conversions | Conversions, CPA | CVR, Complete Payment |
| Traffic | Clicks, CPC | CTR, Page Browse Time |
| Reach | Reach, CPM | Frequency, Video Views |
| App Install | Installs, CPI | Registration, In-App Events |
| Video Views | Video Views, CPV | 2s/6s View Rate, Completion Rate |
| Lead Generation | Leads, CPL | Form Submit Rate |

## Budget Package Structuring

When creating client budget packages:

1. **Define tiers** (e.g., Basic, Growth, Premium) based on ad spend ranges
2. **List deliverables per tier** (number of campaigns, ad sets, creatives, reporting frequency)
3. **Management fee structure**: either percentage of ad spend or fixed retainer
4. **DO NOT include projected results** (CPL estimates, expected conversions, etc.)
5. **Include**: platforms covered, reporting cadence, optimization frequency, creative iterations

### CHF-Denominated Packages (Swiss Clients)
- Show all amounts in CHF
- Note VAT implications if applicable
- Monthly reporting in English or German as needed
- Account for higher CPC/CPM in Swiss market

## SEO Reporting

For SEO backlink tracking (e.g., glemis.ro):
- Track: total backlinks, referring domains, domain authority/rating
- Monitor: new vs. lost backlinks per period
- Categorize: dofollow vs. nofollow ratio
- Flag: toxic/spammy backlinks for disavow consideration

## Report Format Guidelines

When generating reports or report components:
- Lead with a summary/headline metric section
- Use tables for metric comparisons
- Period-over-period comparison (this month vs. last month, or custom date range)
- Traffic light indicators: green (above target), yellow (within 10%), red (below target)
- Always include date range and attribution model used
- Footer with data source and extraction timestamp
