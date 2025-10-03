# Zoom Meeting SDK configuration

The Zoom Meeting SDK only serves assets to origins that match the "Allow lists" configured for your SDK application in the Zoom App Marketplace. When the Electron renderer tries to download the SDK from `https://source.zoom.us`, the CDN validates the `Origin` and `Referer` headers. If those headers do not match one of the domains that you registered, Zoom responds with **403 Forbidden**, and the browser refuses to execute the script because it is returned as plain text.

To prevent these 403 responses you must send the correct domain information with every request. The application now reads the domain from the `ZOOM_SDK_ALLOWED_DOMAIN` (or `ZOOM_SDK_DOMAIN` / `ZOOM_MEETING_SDK_DOMAIN`) environment variable at startup and rewrites the request headers automatically. This domain must match the value that you configured in the Zoom App Marketplace allow list.

## Steps

1. Open the Zoom App Marketplace and edit your Meeting SDK app. In the **Allow lists** section add the domain you want to use (for local development this is usually `https://localhost`).
2. In this project create a `.env` file (or update your deployment configuration) and set:
   ```env
   ZOOM_SDK_ALLOWED_DOMAIN=https://localhost
   ```
   Replace `https://localhost` with any domain that you registered in the allow list.
3. Restart the Electron application so the new header configuration is picked up.

With the domain configured correctly the Zoom CDN serves the SDK script, the loader can initialize `ZoomMtgEmbedded`, and the Meeting screen no longer fails with `net::ERR_ABORTED 403 (Forbidden)`.
