# Competitor Analysis: Zorcha Meta Permissions & Architectural Comparison

> Detailed technical reverse-engineering of competitor **Zorcha's** Meta access request, mapping each prompt item to exact Meta Graph API scopes, and evaluating what **dmplease** should adopt vs. skip.

---

## 1. Executive Summary

Zorcha's permission prompt reveals that it is positioned as an **all-in-one omni-channel marketing suite** covering Facebook Pages, Instagram accounts, Paid Ads (`ads_management`), and Meta Business Portfolios (`business_management`). 

In contrast, **dmplease** is architected as a **laser-focused, zero-latency Instagram Comment-to-DM automation engine**. 

While Zorcha gains broader capabilities (such as automated ad triggers and Facebook Page bot chats), their extensive permission footprint introduces **severe onboarding friction, privacy skepticism from creators, and high App Review barriers**.

---

## 2. Line-by-Line Mapping of Zorcha's Permissions

Here is the exact translation of Zorcha's user-facing consent dialogue into Meta Developer permissions:

| Zorcha Consent Prompt Item | Technical Meta Scope | In dmplease? | Necessity for dmplease |
| :--- | :--- | :---: | :--- |
| **Receive your email address** | `email` | ⚠️ *Optional* | **Recommended**: Automatically captures the creator's primary email for account creation in Supabase. |
| **Access your Page and App insights** | `read_insights` | ❌ No | **Skip for now**: Only needed if analyzing Facebook Page engagement or app usage data. |
| **Manage ads for ad accounts that you have access to** | `ads_management` | ❌ No | **Skip**: High risk. Used by Zorcha for Click-to-DM ad campaigns and lead forms. Triggers heavy scrutiny in App Review. |
| **Manage your business** | `business_management` | ⚠️ *Conditional* | **Keep Minimal**: Grants control over Business Portfolios. Used by agencies to manage client assets. |
| **Access profile and posts from selected Instagram account** | `instagram_basic` | ✅ **Yes** | **Mandatory (P0)**: Required to fetch user info and display posts/reels in the campaign picker. |
| **Manage comments for selected Instagram account** | `instagram_manage_comments` | ✅ **Yes** | **Mandatory (P0)**: Required to ingest comment webhooks and publish public auto-replies. |
| **Access insights for the Instagram account** | `instagram_manage_insights` | ❌ No | **High-Value Addition**: Needed if dmplease wants to display post reach, impressions, and story metric conversions. |
| **Manage and access Page conversations on Messenger** | `pages_messaging` | ❌ No | **Skip for now**: Required only if automating Facebook Page Messenger conversations (not Instagram). |
| **Manage and access messages for the Instagram account** | `instagram_manage_messages` | ✅ **Yes** | **Mandatory (P0)**: The core engine for sending automated DMs and private replies to comments. |
| **Manage comments on your Page** | `pages_manage_engagement` | ❌ No | **Skip**: Needed only if automating comment replies on Facebook Page posts. |
| **Read content posted on the Page** | `pages_read_engagement` | ✅ **Yes** | **Mandatory (P0)**: Required to read Page metadata and identify the linked Instagram Business account. |
| **Manage accounts, settings, webhooks... for a Page** | `pages_manage_metadata` | ✅ **Yes** | **Mandatory (P0)**: Installs the webhook subscription (`subscribed_apps`) automatically on account connection. |
| **Read user content on your Page** | `pages_read_user_content` | ❌ No | **Skip**: Reads user-generated posts and check-ins on Facebook Pages. Not needed for Instagram DMs. |
| **Show a list of the Pages you manage** | `pages_show_list` | ✅ **Yes** | **Mandatory (P0)**: Allows `/me/accounts` query to find Facebook Pages linked to Instagram accounts. |

---

## 3. What Zorcha Is Building (Reverse-Engineering Their Product)

From these requested permissions, we can deduce Zorcha's feature set:

1. **Paid Meta Ads Automation (`ads_management`)**:
   - Zorcha creates and optimizes **Click-to-Instagram Direct Ads** or **Click-to-Messenger Ads**.
   - When a prospective lead clicks an ad, Zorcha automatically triggers an automated chat onboarding funnel.
2. **Omni-Channel Messenger + Instagram Inbox (`pages_messaging` + `pages_manage_engagement`)**:
   - Zorcha handles comment-to-DM and chatbots on **Facebook Pages** in addition to Instagram.
3. **Advanced Performance Analytics (`read_insights` + `instagram_manage_insights`)**:
   - Zorcha pulls story view counts, reel reach, account impressions, and profile views to show conversion ROI against baseline organic performance.
4. **Agency / Multi-Client Portfolio Integration (`business_management`)**:
   - Zorcha allows marketing agencies to connect an entire Meta Business Portfolio at once and automate campaigns across multiple client pages and ad accounts.

---

## 4. The Downsides of Zorcha's Strategy (Opportunity for dmplease)

### A. High Drop-Off in OAuth Consent Screen
Look at the warning Meta displays for Zorcha:
> *"This integration enables Zorcha to establish a connection with your business portfolio(s), and manage everything in the portfolio except for sensitive actions... They may be able to use an API to manage the portfolio, including giving access to third parties."*

- **The Problem:** Independent creators, influencers, and small businesses are terrified when they see third-party apps requesting permission to **"Manage ads"** and **"Manage your business"**. 
- **The Advantage for dmplease:** By asking only for the permissions needed for Instagram messaging (`instagram_manage_messages`, `instagram_manage_comments`, `instagram_basic`, and Page bridge scopes), dmplease presents a **clean, transparent, non-threatening permission screen**, resulting in a dramatically higher connection conversion rate.

### B. App Review & Compliance Bottlenecks
- `ads_management` requires submitting your app for **Marketing API Tier approval** and proving ad spend management workflows.
- `business_management` requires intense privacy documentation and business verification.
- Meta frequently revokes or delays apps that bundle unused permissions.

---

## 5. Strategic Recommendations for dmplease

### What dmplease Should Keep (Current Core)
Keep the 6 foundational permissions already implemented:
1. `instagram_manage_messages`
2. `instagram_manage_comments`
3. `instagram_basic`
4. `pages_show_list`
5. `pages_read_engagement`
6. `pages_manage_metadata`

### What dmplease Should Add Next (High Value, Low Friction)
1. **`email`**:
   - **Why:** During Facebook Login, Meta returns the verified email of the creator. This allows dmplease to automatically sync their profile or streamline sign-up without asking them to type an email twice.
2. **`instagram_manage_insights`**:
   - **Why:** Enables dmplease to calculate true conversion rates:
     $$\text{Conversion Rate} = \frac{\text{Automated DMs Sent}}{\text{Total Reel Impressions}}$$
   - Allows showing creators: *"Your reel reached 50,000 accounts and generated 1,200 DM conversations (2.4% conversion)"*.

### What dmplease Should AVOID Right Now
- ❌ **Do NOT request `ads_management`** unless building a dedicated paid advertising suite. Asking creators for ad access when they only want comment automation ruins user trust.
- ❌ **Do NOT request `pages_messaging` or `pages_manage_engagement`** unless expanding from Instagram into Facebook Page chat automation.
