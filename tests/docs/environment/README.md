# Isolated documentation runtime

This environment uses only synthetic users and data. It must never receive
production credentials, customer records, or access to a production cluster.

The Compose overlay provides the application runtimes, PostgreSQL, and local
mock endpoints for Slack, Microsoft Teams, Jira, SMTP, and generic webhooks.
Use a tested local image through `OPSKNIGHT_IMAGE`, start the environment, apply
migrations, then run `npm run docs:journeys`.

The default browser configuration additionally supports a local development
server backed by a dedicated database whose name contains `opsknight_docs`.
