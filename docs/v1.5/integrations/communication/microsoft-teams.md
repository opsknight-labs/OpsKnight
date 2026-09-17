---
order: 4
title: Microsoft Teams
description: Connect Microsoft Teams for real-time incident notifications, interactive Adaptive Cards, and channel routing.
---

# Microsoft Teams Integration

The Microsoft Teams integration brings incident operations directly into your organization's Teams channels. Receive structured, interactive Adaptive Cards for triggered incidents, acknowledge or resolve incidents directly from Teams, spawn Online Meeting war rooms, and keep your engineering teams aligned without context switching.

---

## Architecture & Endpoints

OpsKnight integrates with Microsoft Teams via the **Microsoft Bot Framework Connector** and **Microsoft Graph API**.

- **Bot Messaging Endpoint**: `https://<your-opsknight-host>/api/microsoft-teams/messages`
- **Graph API Permissions**: `OnlineMeetings.ReadWrite.All`, `User.Read.All`
- **Bot Token Scope**: `https://api.botframework.com/.default`
- **Graph Token Scope**: `https://graph.microsoft.com/.default`

Unlike generic webhook connectors, OpsKnight utilizes bidirectional Bot communication:

1. Outbound incident cards are delivered as interactive **Adaptive Cards** via the Bot Connector.
2. Inbound responder interactions (button clicks, note submissions) post securely back to `/api/microsoft-teams/messages` with cryptographic token verification.
3. Card updates mutate the existing card activity in-place, preventing channel spam and duplicate alerts.

---

## Why Use Microsoft Teams Integration

| Without Teams Integration                   | With Teams Integration                                      |
| ------------------------------------------- | ----------------------------------------------------------- |
| Manually checking OpsKnight dashboard       | Alerts push immediately to your team channel                |
| Context switching to browser to acknowledge | 1-click **Acknowledge** and **Resolve** in Adaptive Cards   |
| Separate conference bridge setup            | Instant Microsoft Teams Video Bridge generation             |
| Scattered status updates across chats       | In-place card status updates reflecting live incident state |

---

## Prerequisites

Before setting up the Microsoft Teams integration:

- [ ] OpsKnight Administrator access
- [ ] Microsoft Entra ID (Azure AD) administrator permissions with ability to register apps and grant admin consent
- [ ] Azure subscription or access to Azure Bot Service (or App Studio / Developer Portal for Teams)
- [ ] OpsKnight deployment accessible over public HTTPS (required by Microsoft Bot Framework)

---

## Setup Overview

```
1. Register Azure Entra App
        ↓
2. Create Azure Bot Service
        ↓
3. Configure Credentials in OpsKnight
        ↓
4. Download App Package & Sideload in Teams
        ↓
5. Select Notification Destination Channel
```

---

## Step 1: Azure App Registration (Entra ID)

1. Sign in to the [Microsoft Entra Admin Center](https://entra.microsoft.com/) or [Azure Portal](https://portal.azure.com/).
2. Navigate to **Identity → Applications → App registrations** and click **New registration**.
3. Configure the following fields:
   - **Name**: `OpsKnight Incident Bot`
   - **Supported account types**: Select **Accounts in this organizational directory only (Single tenant)**.
   - **Redirect URI**: Leave blank for now.
4. Click **Register**. Note the **Application (client) ID** and **Directory (tenant) ID**.
5. Under **Certificates & secrets**, select **Client secrets** → **New client secret**.
   - Set a description (e.g. `OpsKnight Bot Secret`) and expiration.
   - Click **Add** and immediately copy the **Secret Value** (it will not be displayed again).
6. Under **API permissions**:
   - Click **Add a permission** → **Microsoft Graph** → **Application permissions**.
   - Add `OnlineMeetings.ReadWrite.All` (required for creating video bridges).
   - Add `User.Read.All` (required for resolving responder identities).
   - Click **Grant admin consent for <your-organization>**.

---

## Step 2: Configure Azure Bot Service

1. In the Azure Portal, search for **Azure Bot** and click **Create**.
2. Set your **Bot handle** (e.g., `opsknight-bot`).
3. For **Creation type**, select **Use existing app registration**.
4. Enter the **Application (client) ID** from Step 1.
5. In **Configuration → Messaging endpoint**, enter:
   ```
   https://<your-opsknight-host>/api/microsoft-teams/messages
   ```
6. In **Channels**, click **Microsoft Teams** and accept the Terms of Service to enable the Teams channel for your bot.

---

## Step 3: Enter Azure Credentials in OpsKnight

1. In OpsKnight, navigate to **Settings → Integrations → Microsoft Teams**.
2. Switch to the **Azure Credentials** tab.
3. Fill in the required parameters:
   - **Tenant ID**: Your Microsoft Entra Directory (tenant) ID.
   - **Client ID**: Your Application (client) ID.
   - **Client Secret**: The secret value generated in Step 1.
4. Click **Save Credentials**.
5. OpsKnight will validate the credentials against Microsoft Graph. Once verified, the credentials card will display a green **Configured & Validated** badge.

---

## Step 4: Download App Package & Install in Teams

OpsKnight generates a production-ready Microsoft Teams App Package containing the manifest and compliant branding icons:

1. On the **Bot & Manifest** tab in OpsKnight, click **Download App Package (.zip)**.
2. The downloaded zip contains:
   - `manifest.json`: Bot ID, scopes (`team`, `groupchat`), and command bindings.
   - `color.png`: 192x192 px icon for Teams App Store and directory.
   - `outline.png`: 32x32 px transparent white silhouette for the Teams app bar and channel headers.
3. Open Microsoft Teams (or the [Teams Admin Center](https://admin.teams.microsoft.com/)):
   - Go to **Apps** → **Manage your apps** (or **Upload a customized app** in Teams).
   - Select **Upload a custom app** and upload the downloaded `.zip` file.
   - Click **Add to a team** and select the Team and Channel where you want the bot installed.
4. When the bot is added to the Team, Teams fires an install event (`conversationUpdate`) to OpsKnight's messaging endpoint, automatically registering the team installation and capturing the conversation routing ID.

---

## Step 5: Configure Notification Destination

1. In OpsKnight, go to **Settings → Integrations → Microsoft Teams** → **Channel Routing** (or **Settings → Notifications → Microsoft Teams Destination**).
2. Select your **Team** from the dropdown. OpsKnight automatically queries and deduplicates installed teams and Entra Group IDs.
3. Select the destination **Channel** (e.g., `#incidents` or `#general`).
4. Click **Link Channel**.
5. You can also link specific channels per service in **Services → [Service Name] → Notification Channels**.

---

## Step 6: PowerShell Policy for Online Meetings (Video Bridge)

To allow OpsKnight to automatically schedule Microsoft Teams Online Meetings on behalf of organizers without interactive user login, configure an Application Access Policy in Teams PowerShell:

1. Open PowerShell and install the Microsoft Teams module (if not already installed):
   ```powershell
   Install-Module -Name MicrosoftTeams -Force -AllowClobber
   ```
2. Connect to Microsoft Teams as an administrator:
   ```powershell
   Connect-MicrosoftTeams
   ```
3. Create an application access policy granting your Bot App ID meeting creation rights:
   ```powershell
   New-CsApplicationAccessPolicy -Identity "OpsKnight-MeetingPolicy" -AppIds "<YOUR_CLIENT_ID>" -Description "Allow OpsKnight Bot to create Online Meetings"
   ```
4. Grant the policy globally or to specific incident commanders:
   ```powershell
   Grant-CsApplicationAccessPolicy -PolicyName "OpsKnight-MeetingPolicy" -Global
   ```

---

## Standard vs Private vs Shared Channels

| Channel Type         | Bot Support          | Channel Discovery            | Recommendations                                                                                                |
| -------------------- | -------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Standard Channel** | Full Support         | Automatic                    | Recommended for incident broadcast and response.                                                               |
| **Shared Channel**   | Full Support         | Automatic via Entra Group ID | Supported across federated teams.                                                                              |
| **Private Channel**  | Limited by Microsoft | Restricted                   | Microsoft Teams restricts bot installation in private channels. Use standard channels for incident operations. |

---

## Disconnecting & Deleting the Integration

If you need to disconnect or remove the Microsoft Teams integration:

1. Navigate to **Settings → Integrations → Microsoft Teams**.
2. Click the red **Disconnect Integration** button in the top-right corner.
3. An **Alert Dialog** will appear detailing the actions:
   - Revokes any active in-flight Teams notification operations.
   - Clears all cached Bot Framework and Microsoft Graph bearer tokens.
   - Unlinks all service destination channels.
   - Deletes all stored Azure credentials and team installation records.
4. Confirm by clicking **Yes, Disconnect Integration**.
5. The integration will immediately revert to an unconfigured state.
