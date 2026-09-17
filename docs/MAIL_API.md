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

The shared Circle service remains the source of truth for invitation state. The desktop still uses the compatibility invitation operation to create or reuse the pending invitation, then retrieves the temporary invitation password inside the main process and sends the user-facing invitation through this HTTP mail transport. The temporary password and invitation token never cross IPC into the renderer.

The desktop now treats this mail API as authoritative for its `sent` / `delivery-failed` result. The current legacy compatibility operation is still `/api/group/invite-email`; because the repository does not document a create-only or suppress-email variant of that endpoint, the legacy server may still attempt its own delivery until that backend exposes such a mode. The desktop does not trust the legacy `emailSent` result anymore.

Do not commit mail credentials to source or a renderer-accessible `.env` file. After the demo, remove the packaged credential path and rotate/retire the test-server credential.
