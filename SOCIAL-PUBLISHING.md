# Social publishing setup

The Social Scheduler can publish to LinkedIn, X, Facebook Pages, Instagram and TikTok. Each platform is optional. A platform is switched on by adding its credentials to the server's environment. Until then its "Connect account" button only saves a placeholder, and posts cannot be published to a placeholder.

How it works:

1. A user connects an account. Buildr sends them to the platform to approve posting, then stores the access token encrypted (AES-256-GCM, using `ENCRYPTION_KEY`).
2. Posts are scheduled as before.
3. Every 5 minutes a GitHub Actions workflow calls `POST /api/cron/publish-scheduled`. That endpoint publishes every post whose time has come and records the result for each platform.

## 1. Publishing trigger (required for any platform)

1. Generate a secret: `openssl rand -hex 32`.
2. Set it as `CRON_SECRET` in the server environment.
3. In the GitHub repository open Settings, Secrets and variables, Actions, and add two repository secrets:
   - `CRON_SECRET`: the same value.
   - `APP_URL`: the public address of the app, for example `https://app.example.com`.
4. The workflow `.github/workflows/publish-scheduled-posts.yml` then runs every 5 minutes. You can also start it by hand from the Actions tab to test.

Good to know:

- GitHub runs scheduled workflows on a best-effort basis. A post can go out a few minutes after its time.
- GitHub pauses schedules on repositories with no activity for 60 days. Re-enable it from the Actions tab if that happens.
- Without `CRON_SECRET` the endpoint refuses to run (it answers 503), so nothing is published.

## 2. Callback URL

Every platform asks for a redirect (callback) URL. Register exactly this, with your real address, in each developer app:

```
<NEXTAUTH_URL>/api/marketing/accounts/oauth/<platform>/callback
```

where `<platform>` is `linkedin`, `x`, `meta`, `instagram` or `tiktok`. Meta needs both `meta` and `instagram` registered because they share one app.

## 3. Platforms

Platform rules change. Check each platform's developer documentation before you rely on the details below.

### LinkedIn

- Create an app at the LinkedIn developer portal and add the products "Share on LinkedIn" and "Sign In with LinkedIn using OpenID Connect".
- Set `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`.
- Posts as the signed-in member (scope `w_member_social`). Posting as a company page needs extra LinkedIn approval and is not supported yet.
- Tokens last about 60 days. Buildr does not receive refresh tokens from the self-serve product, so users reconnect when a token expires and the post's error says so.
- Images are not uploaded. Media links are added to the post text.

### X

- Create a project and app in the X developer portal, enable OAuth 2.0 with "Web App" type, and note the Client ID and Client Secret.
- Set `X_CLIENT_ID` and `X_CLIENT_SECRET`.
- Your X plan must allow creating posts through the API.
- Tokens refresh automatically. Posts are limited to 280 characters (links count as 23). Media links are added to the text.

### Facebook Pages (`meta`) and Instagram (`instagram`)

- Create one Meta app with Facebook Login. Set `META_APP_ID` and `META_APP_SECRET`.
- Facebook Pages needs the permissions `pages_show_list`, `pages_manage_posts` and `pages_read_engagement`. Instagram needs `instagram_basic` and `instagram_content_publish` as well.
- Until the app passes Meta's app review, only people with a role on the app can connect. Review is required before regular users can.
- Connecting creates one account for every Page the user selects. A post to Facebook goes to every connected Page.
- Instagram needs an Instagram business or creator account linked to the Facebook Page. Every Instagram post needs a public JPEG or PNG image URL in the post's media list.
- The Graph API version defaults to `v26.0`. Set `META_GRAPH_VERSION` to change it.
- Facebook posts can carry one image. Video is not supported yet.

### TikTok

- Create an app in TikTok for Developers and add the Content Posting API. Set `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET`.
- Every TikTok post needs a public MP4 or MOV URL in the post's media list. The video's domain must be verified in your TikTok app.
- Until TikTok audits your app, posts can only be private (visible to the creator). Buildr uses the most public option TikTok allows for the account.
- TikTok processes the video after the request, so "Posted" means TikTok accepted it.

## 4. Environment variables

See `.env.example`. All are optional except `CRON_SECRET`:

| Variable | Used for |
| --- | --- |
| `CRON_SECRET` | Authorises the scheduled publish call |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | LinkedIn |
| `X_CLIENT_ID`, `X_CLIENT_SECRET` | X |
| `META_APP_ID`, `META_APP_SECRET`, `META_GRAPH_VERSION` | Facebook Pages and Instagram |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | TikTok |

## 5. Behaviour you should know

- A post to several platforms reports each platform separately. If one fails, the others still go out.
- Retrying a failed post (the "Retry failed platforms" button) skips accounts that already posted, so nothing is posted twice.
- A post found stuck in "posting" for 15 minutes (for example after a server crash) is marked failed and is never sent again automatically, because it may already be live. Retry it by hand after checking the platform.
- Failures create a notification for the owner.
- Accounts added before this feature (name only) show a "not linked" label. Disconnect them and connect them again.
