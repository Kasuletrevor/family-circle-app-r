# Family Circle HTTP mail transport

Family Circle sends desktop-generated email from the Electron **main process** through the Kin-Keepers mail API. This currently covers:

- password recovery codes;
- password-changed notifications;
- Circle invitations;
- Circle invitation resends.

Default endpoint:

```text
https://elderchatgpt.com/memorytest/api/send-mail/
```

Configure the runtime environment with:

```text
SEND_EMAILS=true
MAIL_API_USER=<mail-api-username>
MAIL_API_PASSWORD=<mail-api-password>
MAIL_API_TIMEOUT_MS=45000      # optional; defaults to 45 seconds
MAIL_API_URL=<override-url>    # optional; defaults to the endpoint above
```

The main process POSTs JSON shaped as:

```json
{
  "to": "recipient@example.com",
  "subject": "Message subject",
  "body": "Plain-text content",
  "html": "<p>HTML content</p>"
}
```

Authentication uses HTTP Basic auth constructed only in the main process. Credentials are never exposed through preload or renderer APIs.

For the temporary demo build, GitHub Actions materializes the repository mail secrets into `build/demo-mail-config.json` only inside the Windows build workspace and electron-builder packages that file as `resources/demo-mail-config.json`. This deliberately makes the test credential recoverable from the demo installer and must be removed/rotated when the demo server is retired. Runtime environment values take precedence over the packaged demo configuration.

When neither runtime mail configuration nor the temporary packaged demo configuration enables mail, the mailer is a no-op. Non-success HTTP responses, connection failures, and request timeouts are normalized to a generic `Failed to send email` error so provider details and transport internals are not exposed.

## Circle invitation delivery

The shared Circle service remains the source of truth for invitation state. Its `/api/group/invite-email` compatibility operation creates or reuses the pending invitation and generates the one-time temporary password.

The shared Circle server supports `EMAIL_DELIVERY_MODE=client`. In that mode it does **not** send the invitation itself. Instead it returns `emailDeliveryRequired: true` with a protected `emailPayload`. The Electron main process normalizes that payload to the invitee email, Circle name, role, and temporary password, strips the invitation token, and sends the user-facing invitation through this HTTP mail transport. None of those protected delivery values cross IPC into the renderer.

For older compatibility servers that do not return the client-delivery payload, the desktop can retrieve the pending temporary password through the protected invitation-check path and still send through this mail API. For a deployment where the Kin-Keepers mail API must be the **only** invitation sender, configure the shared Circle server with:

```text
EMAIL_DELIVERY_MODE=client
```

The desktop mail API is authoritative for the UI's `sent` / `delivery-failed` result; the legacy `emailSent` flag is not used to decide desktop delivery success.

Do not commit mail credentials to source or a renderer-accessible `.env` file. After the demo, remove the packaged credential path and rotate/retire the test-server credential.
