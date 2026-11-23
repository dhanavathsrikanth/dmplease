# Essential Meta Permissions for dmplease

> Comprehensive guide to the Meta Graph API permissions, webhook configurations, and App Review requirements necessary to run **dmplease** in production.

---

## 1. Quick Reference: Permissions Matrix

| Permission | API Category | Access Level | Purpose in dmplease |
| :--- | :--- | :--- | :--- |
| **`instagram_manage_messages`** | Instagram Graph API | **Advanced Access** (Mandatory) | Sends private replies to comments, delivers 1-to-1 DMs, and listens to incoming message webhooks. |
| **`instagram_manage_comments`** | Instagram Graph API | **Advanced Access** (Mandatory) | Ingests real-time comment webhook events and executes public comment replies. |
| **`instagram_basic`** | Instagram Graph API | **Advanced Access** (Mandatory) | Fetches user profile data (username, follower count) and loads posts/reels for the campaign picker. |
| **`pages_show_list`** | Facebook Pages API | **Advanced Access** (Mandatory) | Queries `/me/accounts` to find Facebook Pages and their linked Instagram Professional Accounts. |
| **`pages_read_engagement`** | Facebook Pages API | **Advanced Access** (Mandatory) | Reads Page metadata and linked Instagram account details during OAuth onboarding. |
| **`pages_manage_metadata`** | Facebook Pages API | **Advanced Access** (Mandatory) | Automatically subscribes the Instagram account or Facebook Page to webhooks (`subscribed_apps`). |
| **`business_management`** | Business Manager API | **Advanced Access** (Conditional) | Recommended when using Facebook Login for Business Configurations (`META_CONFIG_ID`) across business portfolios. |

---

## 2. In-Depth Permission Breakdown

### 1. `instagram_manage_messages` *(P0 — Critical)*
- **Why it is required:** 
  This permission unlocks the Messenger API for Instagram. It is the primary engine behind dmplease's automated direct messaging functionality.
- **Where it is used in the codebase:**
  - **Comment-to-DM Private Replies:** [`sendPrivateReply()`](file:///c:/Users/ratho/Desktop/dmplease%201/lib/meta/client.ts#L415-L444) calls `POST /{instagramAccountId}/messages` with `{ recipient: { comment_id: ... }, message: { text: ... } }`.
  - **Interactive Button Templates:** [`sendPrivateReplyWithButton()`](file:///c:/Users/ratho/Desktop/dmplease%201/lib/meta/client.ts#L449-L503) sends structured button and web URL CTA cards.
  - **Direct Messages:** [`sendDirectMessage()`](file:///c:/Users/ratho/Desktop/dmplease%201/lib/meta/client.ts#L508-L528) sends 1-to-1 DMs using the user's Instagram-Scoped ID (`IGSID`).
- **If missing:**
  The platform will throw API error `(#10) Application does not have permission for this action` whenever attempting to send a DM.

---

### 2. `instagram_manage_comments` *(P0 — Critical)*
- **Why it is required:** 
  Enables the application to monitor comments on posts, reels, and live videos, as well as post public replies beneath comments.
- **Where it is used in the codebase:**
  - **Comment Webhook Delivery:** Meta checks this permission before dispatching `comments` webhook events to [`/api/webhook`](file:///c:/Users/ratho/Desktop/dmplease%201/app/api/webhook/route.ts#L95-L100).
  - **Public Auto-Replies:** When a creator toggles "Public Reply" in [`app/dashboard/campaigns/actions.ts`](file:///c:/Users/ratho/Desktop/dmplease%201/app/dashboard/campaigns/actions.ts#L78-L79), this permission is required to post the response back under the comment.
- **If missing:**
  Meta will not emit real-time comment webhook events for media, rendering keyword triggers completely inactive.

---

### 3. `instagram_basic` *(P0 — Critical)*
- **Why it is required:** 
  Allows dmplease to read profile metadata (Instagram username, account ID, profile picture) and list media published on the connected account.
- **Where it is used in the codebase:**
  - **User Profile Fetching:** [`getUserInfo()`](file:///c:/Users/ratho/Desktop/dmplease%201/lib/meta/client.ts#L234-L252) reads `id,user_id,username,name,profile_picture_url,followers_count`.
  - **Visual Reel & Post Picker:** [`getUserMedia()`](file:///c:/Users/ratho/Desktop/dmplease%201/lib/meta/client.ts#L390-L410) queries `GET /me/media` so creators can link automations to specific Reels or posts.
- **If missing:**
  The account onboarding flow fails, and the Campaign Builder cannot display the user's posts or Reels.

---

### 4. `pages_show_list` & `pages_read_engagement` *(P0 — Critical)*
- **Why they are required:** 
  Meta links Instagram Professional accounts to Facebook Pages. To retrieve the `instagram_business_account` object through Facebook Login, dmplease must inspect the creator's Pages.
- **Where they are used in the codebase:**
  - [`fetchInstagramAccountsForToken()`](file:///c:/Users/ratho/Desktop/dmplease%201/lib/meta/client.ts#L257-L291) calls:
    ```http
    GET /me/accounts?fields=id,name,access_token,instagram_business_account{id,username,name,profile_picture_url,followers_count}
    ```
- **If missing:**
  `GET /me/accounts` returns an empty array, and the OAuth callback redirects to `/dashboard/settings?error=No+Instagram+Professional+or+Creator+account+was+found`.

---

### 5. `pages_manage_metadata` *(P0 — Critical)*
- **Why it is required:** 
  Required to programmatically install the webhook subscription on the creator's connected Page or Instagram Business account.
- **Where it is used in the codebase:**
  - [`subscribeInstagramAccountToWebhooks()`](file:///c:/Users/ratho/Desktop/dmplease%201/lib/meta/client.ts#L318-L365) calls:
    ```http
    POST /{instagramAccountId}/subscribed_apps
    subscribed_fields=["comments", "messages", "messaging_postbacks"]
    ```
- **If missing:**
  Subscribing to webhooks fails with HTTP 403 Forbidden, requiring manual webhook subscriptions in the Meta Dashboard for every individual user account.

---

### 6. `business_management` *(Recommended)*
- **Why it is required:** 
  Required if your Meta App uses **Facebook Login for Business** configurations (`META_CONFIG_ID`) that touch assets managed under Meta Business Portfolios.

---

## 3. Required Webhook Subscriptions

In your **Meta App Dashboard** &rarr; **Webhooks**, configure the following:

### Instagram Webhook Object
- **Callback URL:** `https://your-domain.com/api/webhook`
- **Verify Token:** Matching `META_VERIFY_TOKEN` in `.env.local`
- **Subscribed Fields:**
  - `comments` — *Required for comment-to-DM triggers*
  - `messages` — *Required for inbox & story replies*
  - `messaging_postbacks` — *Required for CTA button template interactions*
  - `mentions` — *Required for Story mentions and tags*

### Page Webhook Object *(Fallback)*
- **Subscribed Fields:**
  - `feed`
  - `messages`
  - `messaging_postbacks`

---

## 4. End-User Account Prerequisites

Even with all permissions granted, Meta requires creators to meet the following conditions on their personal accounts:

1. **Professional Account Type:**
   - The Instagram account **must** be a **Creator** or **Business** account (Personal accounts do not have access to the Graph API).
2. **Connected Facebook Page:**
   - The Instagram account must be linked to a Facebook Page managed by the same Meta identity.
3. **"Allow Access to Messages" Toggle (Mobile App):**
   - The creator **must** enable message permissions in the Instagram mobile app:
     1. Open **Instagram** &rarr; go to **Settings & Privacy**.
     2. Tap **Messages and story replies** &rarr; **Connected tools**.
     3. Toggle **"Allow access to messages"** to **ON**.
   > *Note: If this toggle is disabled, Meta returns error code `2534074` ("Instagram user has not allowed access to messages") whenever dmplease tries to send a DM.*

---

## 5. Meta App Review & Going Live Checklist

1. [ ] **Meta Business Verification:** Complete business identity verification in Meta Business Manager.
2. [ ] **Facebook Login for Business Configuration:** Create a configuration in Meta Developer Portal and assign the `META_CONFIG_ID`.
3. [ ] **Screen Recording Submission:** Record a walkthrough demonstrating:
   - User logging into dmplease and granting permissions via Facebook Login.
   - Creator selecting a reel and setting a comment trigger keyword (e.g. `GUIDE`).
   - A secondary test user commenting the keyword on the reel.
   - dmplease delivering the automated DM to the test user instantly.
4. [ ] **Request Advanced Access:** Request Advanced Access for all 6 core permissions in **App Review** &rarr; **Permissions and Features**.
