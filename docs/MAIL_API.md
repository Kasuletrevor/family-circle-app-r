# Family Circle HTTP mail transport

Family Circle sends locally generated recovery-code and password-changed emails from the Electron **main process** through the Kin-Keepers mail API.

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

Authentication uses HTTP Basic auth constructed only in the main process. Credentials are not part of the preload API, renderer state, packaged assets, or committed source.

`SEND_EMAILS` remains opt-in. When it is not exactly `true`, the recovery mailer is a no-op and the public recovery flow keeps its neutral response behavior.

Non-success HTTP responses, connection failures, and request timeouts are normalized to a generic `Failed to send email` error so upstream response details and transport internals are not exposed.

Do not commit mail credentials to this repository or a renderer-accessible `.env` file. Supply them through the deployment/runtime environment. Rotate credentials if they have been shared outside the intended secret-management channel.

Circle invitations are not sent through this desktop mailer: invitation delivery remains owned by the existing Circle service compatibility endpoint.
