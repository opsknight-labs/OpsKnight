---
order: 11
title: Postmortems
description: Document incidents, identify root causes, and track improvements with blameless postmortems
---

# Postmortems

Postmortems (also called Post-Incident Reviews or PIRs) document what happened during an incident, why it happened, and what you'll do to prevent recurrence. OpsKnight provides a structured workflow for creating, reviewing, and tracking postmortems.


---

## Why Postmortems Matter

| Without Postmortems         | With Postmortems                 |
| --------------------------- | -------------------------------- |
| Same incidents repeat       | Learn and prevent recurrence     |
| Tribal knowledge            | Documented institutional memory  |
| Blame culture               | Blameless improvement culture    |
| No accountability for fixes | Tracked action items with owners |

---

## Postmortem Workflow

OpsKnight postmortems follow a structured lifecycle:

```
DRAFT → IN_REVIEW → PUBLISHED → ARCHIVED
```

### Workflow States

| Status        | Description                         | Who Can Edit               |
| ------------- | ----------------------------------- | -------------------------- |
| **DRAFT**     | Initial creation, work in progress  | Author, Editors            |
| **IN_REVIEW** | Ready for team review and feedback  | Author, Editors, Reviewers |
| **PUBLISHED** | Finalized, visible to organization  | Admins only                |
| **ARCHIVED**  | Historical record, no longer active | Admins only                |

### State Transitions

```
                    ┌─────────────┐
                    │   DRAFT     │
                    └──────┬──────┘
                           │ Submit for Review
                           ▼
                    ┌─────────────┐
              ┌─────│  IN_REVIEW  │─────┐
              │     └──────┬──────┘     │
    Request   │            │            │ Request
    Changes   │            │ Approve    │ Changes
              │            ▼            │
              │     ┌─────────────┐     │
              └────►│  PUBLISHED  │◄────┘
                    └──────┬──────┘
                           │ Archive
                           ▼
                    ┌─────────────┐
                    │  ARCHIVED   │
                    └─────────────┘
```

---

## When to Write a Postmortem

### Required Triggers

| Condition                          | Rationale                          |
| ---------------------------------- | ---------------------------------- |
| **Any HIGH urgency incident**      | Critical issues need documentation |
| **Customer-impacting outage**      | External impact requires review    |
| **Data loss or security incident** | Compliance and learning            |
| **Incident duration > 1 hour**     | Extended incidents have lessons    |

### Recommended Triggers

| Condition                          | Rationale                  |
| ---------------------------------- | -------------------------- |
| **Recurring incident pattern**     | Break the cycle            |
| **Near-miss (almost critical)**    | Learn before it gets worse |
| **Novel failure mode**             | Document new knowledge     |
| **Cross-team coordination issues** | Process improvements       |

### Skip Postmortem When

- Incident was false positive
- Root cause is already well-documented
- No meaningful learnings possible
- Incident was immediately auto-resolved

---

## Creating a Postmortem

### From an Incident

1. Open a **resolved** incident
2. Click **Create Postmortem**
3. Incident data is automatically populated:
   - Title and description
   - Timeline events
   - Affected services
   - Participants


### From Scratch

1. Go to **Postmortems** in the sidebar
2. Click **Create Postmortem**
3. Link to an incident (optional)
4. Fill in the template

### Postmortem Fields

| Field                    | Required | Description                           |
| ------------------------ | -------- | ------------------------------------- |
| **Title**                | Yes      | Clear, descriptive title              |
| **Incident**             | No       | Linked incident (auto-populates data) |
| **Summary**              | Yes      | Executive summary of what happened    |
| **Timeline**             | Yes      | Chronological event sequence          |
| **Impact**               | Yes      | Business and customer impact          |
| **Root Cause**           | Yes      | Technical explanation of failure      |
| **Resolution**           | Yes      | How the incident was resolved         |
| **Action Items**         | Yes      | Follow-up tasks with owners           |
| **Lessons Learned**      | No       | Key takeaways                         |
| **Contributing Factors** | No       | Additional factors beyond root cause  |
| **Detection**            | No       | How the incident was discovered       |
| **Response**             | No       | Evaluation of incident response       |

---

## Postmortem Sections

### Summary

A brief executive summary (2-3 sentences) answering:

- What happened?
- What was the impact?
- How was it resolved?

**Example**:

> On January 15, 2024, the Payment API experienced a 45-minute outage due to a database connection pool exhaustion. Approximately 2,300 transactions failed during the incident. Service was restored by increasing connection pool limits and restarting affected pods.

### Timeline

Chronological sequence of events with timestamps.

| Time  | Event                                                         |
| ----- | ------------------------------------------------------------- |
| 14:00 | Monitoring alert triggered for elevated API latency           |
| 14:03 | On-call engineer acknowledged alert                           |
| 14:08 | Initial investigation started, high DB connection count noted |
| 14:15 | Root cause identified: connection pool exhausted              |
| 14:22 | Mitigation applied: increased pool size                       |
| 14:30 | Service restored, monitoring confirmed                        |
| 14:45 | Incident resolved, follow-up tasks created                    |

**Timeline Best Practices**:

- Use consistent timezone (UTC recommended)
- Include who performed each action
- Note key decisions and why they were made
- Include any false starts or dead ends

### Impact

Quantify the business and customer impact.

| Impact Type             | Measurement              |
| ----------------------- | ------------------------ |
| **Duration**            | 45 minutes               |
| **Affected Users**      | ~2,300 customers         |
| **Failed Transactions** | 2,347                    |
| **Revenue Impact**      | $12,500 estimated        |
| **SLA Breach**          | Yes, 99.9% target missed |
| **Support Tickets**     | 47 tickets opened        |

### Root Cause

Technical explanation of why the incident occurred.

**Structure**:

1. **What failed**: The specific component or system
2. **Why it failed**: The technical reason
3. **Why wasn't it caught**: Detection gaps

**Example**:

> The database connection pool was configured with a maximum of 50 connections, inherited from initial deployment 2 years ago. Recent traffic growth increased average concurrent connections from 30 to 48. A traffic spike from a marketing campaign pushed connections over the limit, causing new requests to queue and timeout.
>
> The connection pool metrics were not monitored, so the gradual increase went unnoticed until the hard failure.

### Resolution

Steps taken to restore service.

| Step | Action                           | Result                        |
| ---- | -------------------------------- | ----------------------------- |
| 1    | Increased connection pool to 100 | Pending connections processed |
| 2    | Restarted 3 affected API pods    | Fresh connection pools        |
| 3    | Verified transaction processing  | Normal throughput resumed     |
| 4    | Monitored for 15 minutes         | No recurrence                 |

### Action Items

Tracked tasks to prevent recurrence.

| Action                           | Owner  | Due Date | Priority | Status |
| -------------------------------- | ------ | -------- | -------- | ------ |
| Add connection pool monitoring   | @jane  | Jan 22   | HIGH     | Open   |
| Set up alerts at 80% pool usage  | @jane  | Jan 22   | HIGH     | Open   |
| Review all DB connection configs | @bob   | Jan 29   | MEDIUM   | Open   |
| Document connection pool sizing  | @alice | Feb 5    | LOW      | Open   |

### Lessons Learned

Key takeaways for the team.

**What went well**:

- Alert fired within 3 minutes of issue
- On-call responded quickly
- Root cause identified in 12 minutes

**What could be improved**:

- No monitoring on connection pool utilization
- Initial config was never revisited as traffic grew
- Runbook didn't cover connection pool issues

**Where we got lucky**:

- Traffic spike was moderate; larger spike would have been worse
- Database itself remained healthy

---

## Action Item Tracking

### Action Item Fields

| Field                | Required | Description                                                                                      |
| -------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| **Description**      | Yes      | What needs to be done                                                                            |
| **Owner**            | Yes      | Person responsible                                                                               |
| **Due Date**         | Yes      | Target completion date                                                                           |
| **Priority**         | Yes      | HIGH, MEDIUM, LOW                                                                                |
| **Status**           | Yes      | OPEN, IN_PROGRESS, COMPLETED, WONT_DO                                                            |
| **Jira Integration** | No       | Create Jira issue (`+ Create Jira`) or link existing ticket (`SCRUM-42 ↗`) with live status sync |

### Action Item Statuses

| Status          | Meaning                                    |
| --------------- | ------------------------------------------ |
| **OPEN**        | Not yet started                            |
| **IN_PROGRESS** | Work has begun                             |
| **COMPLETED**   | Task finished                              |
| **WONT_DO**     | Decided not to pursue (with justification) |

### Tracking Progress

View action item status across postmortems:

1. Go to **Postmortems → Action Items**
2. Filter by:
   - Status (open, overdue, completed)
   - Owner
   - Priority
   - Due date range
3. Export for tracking meetings


### Overdue Items

OpsKnight highlights overdue action items:

- Items past due date show warning indicator
- Dashboard shows overdue count
- Optional email reminders to owners

---

## Visibility & Sharing

### Internal Visibility

| Setting          | Who Can View                  |
| ---------------- | ----------------------------- |
| **Private**      | Only participants and editors |
| **Team**         | Members of associated team(s) |
| **Organization** | All organization members      |

### External Sharing

For customer communication:

| Option             | Description                            |
| ------------------ | -------------------------------------- |
| **Public Summary** | Sanitized version for status page      |
| **Customer Email** | Share directly with affected customers |
| **Public Link**    | Generate shareable read-only link      |

### What to Share Externally

**Include**:

- What happened (high level)
- Impact duration
- Resolution confirmation
- Preventive measures (general)

**Exclude**:

- Internal tooling details
- Specific infrastructure info
- Individual names
- Security-sensitive details

---

## Collaboration Features

### Editors

Add collaborators who can edit the postmortem:

1. Open postmortem
2. Click **Editors**
3. Add team members
4. Set permission level (Edit, Comment)

### Comments & Discussion

- Add comments to specific sections
- @mention team members
- Resolve comment threads
- Track unresolved comments before publishing

### Review Requests

Request formal review before publishing:

1. Change status to **IN_REVIEW**
2. Add reviewers
3. Reviewers receive notification
4. Reviewers can approve or request changes
5. All approvals required before publishing

---

## Templates

### Default Template

OpsKnight provides a default template with all standard sections.

### Custom Templates

Create organization-specific templates:

1. Go to **Settings → Postmortems → Templates**
2. Click **Create Template**
3. Define:
   - Template name
   - Required sections
   - Default content/prompts
   - Custom fields
4. Save template

### Template Sections

| Section           | Customizable |
| ----------------- | ------------ |
| Required/Optional | Yes          |
| Default text      | Yes          |
| Helper prompts    | Yes          |
| Section order     | Yes          |
| Custom sections   | Yes          |

---

## Linking to Incidents

### Auto-Population

When creating a postmortem from an incident:

| Auto-Populated    | Source                   |
| ----------------- | ------------------------ |
| Title             | Incident title           |
| Summary           | Incident description     |
| Timeline          | Incident timeline events |
| Affected Services | Incident services        |
| Duration          | Incident timestamps      |
| Participants      | Incident responders      |

### Multiple Incidents

Link multiple related incidents to one postmortem:

- Common root cause affecting multiple services
- Cascading failures
- Related concurrent incidents

---

## Postmortem Meetings

### Scheduling

Schedule a postmortem review meeting:

1. Open postmortem
2. Click **Schedule Meeting**
3. Select attendees (auto-suggests incident participants)
4. Choose date/time
5. Generate calendar invite

### Meeting Integration

| Platform        | Support                 |
| --------------- | ----------------------- |
| Google Calendar | Direct integration      |
| Outlook/O365    | ICS file download       |
| Zoom            | Meeting link generation |
| Google Meet     | Meeting link generation |

### Meeting Agenda

Auto-generated agenda includes:

1. Incident summary review
2. Timeline walkthrough
3. Root cause discussion
4. Action item assignment
5. Lessons learned

---

## Reporting & Analytics

### Postmortem Metrics

| Metric                       | Description                     |
| ---------------------------- | ------------------------------- |
| **Postmortems Created**      | Count per period                |
| **Completion Rate**          | Draft → Published conversion    |
| **Average Time to Complete** | Days from incident to published |
| **Action Item Completion**   | % of items completed on time    |
| **Overdue Items**            | Count of past-due actions       |

### Trends

Track patterns across postmortems:

- Most common root causes
- Frequently affected services
- Recurring action item types
- Team completion rates

---

## Best Practices

### Blameless Culture

| Do                             | Don't                        |
| ------------------------------ | ---------------------------- |
| Focus on systems and processes | Blame individuals            |
| Ask "what" and "how"           | Ask "who"                    |
| Assume good intentions         | Assume negligence            |
| Treat failures as learning     | Treat failures as punishment |

### Writing Quality

- **Be specific**: Include exact times, metrics, commands
- **Be factual**: Document what happened, not opinions
- **Be complete**: Don't skip uncomfortable details
- **Be constructive**: Every problem needs an action item

### Timing

| Phase            | Target                        |
| ---------------- | ----------------------------- |
| Draft started    | Within 24 hours of resolution |
| Draft completed  | Within 48 hours               |
| Review completed | Within 1 week                 |
| Published        | Within 2 weeks                |

### Action Items

- Make them **specific** and **measurable**
- Assign **one owner** (not a team)
- Set **realistic due dates**
- **Track to completion** (don't let items rot)
- **Link to tickets** in your issue tracker

---

## API Access

### Endpoints

| Endpoint                            | Method | Description            |
| ----------------------------------- | ------ | ---------------------- |
| `/api/postmortems`                  | GET    | List postmortems       |
| `/api/postmortems`                  | POST   | Create postmortem      |
| `/api/postmortems/:id`              | GET    | Get postmortem details |
| `/api/postmortems/:id`              | PATCH  | Update postmortem      |
| `/api/postmortems/:id/action-items` | GET    | List action items      |
| `/api/postmortems/:id/action-items` | POST   | Add action item        |

### Example: Create Postmortem

```bash
curl -X POST "https://your-opsknight.com/api/postmortems" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Payment API Outage - Jan 15",
    "incidentId": "inc_abc123",
    "summary": "Database connection pool exhaustion caused 45-minute outage",
    "status": "DRAFT"
  }'
```

### Example: Add Action Item

```bash
curl -X POST "https://your-opsknight.com/api/postmortems/pm_xyz/action-items" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Add connection pool monitoring",
    "ownerId": "user_jane",
    "dueDate": "2024-01-22",
    "priority": "HIGH"
  }'
```

---

## Integrations

### Slack

- Notify channel when postmortem is published
- Share postmortem link with formatted preview
- Receive action item reminders

### Issue Trackers

| Platform          | Features                                     |
| ----------------- | -------------------------------------------- |
| **Jira**          | Create issues from action items, sync status |
| **GitHub Issues** | Create issues, link PRs                      |
| **Linear**        | Create issues, track status                  |
| **Asana**         | Create tasks from action items               |

### Document Export

| Format       | Use Case                         |
| ------------ | -------------------------------- |
| **PDF**      | Formal documentation, compliance |
| **Markdown** | Wiki, documentation sites        |
| **HTML**     | Email, web publishing            |
| **JSON**     | Programmatic access              |

---

## Troubleshooting

### Can't Create Postmortem

1. Verify incident is **resolved**
2. Check you have permission (incident participant or team member)
3. Verify postmortem feature is enabled

### Can't Publish

1. Check all required sections are completed
2. Verify all reviewers have approved (if reviews required)
3. Check you have publish permission

### Action Items Not Syncing

1. Verify integration is connected
2. Check issue tracker permissions
3. Review sync logs in integration settings

---

## Related Topics

- [Incidents](./incidents) — Incident lifecycle
- [Analytics](./analytics) — Performance metrics
- [Teams](./teams) — Team management
- [Status Page](./status-page) — Public communication
