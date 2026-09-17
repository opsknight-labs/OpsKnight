# Microsoft Teams Integration — Operational Findings, Gotchas & Fixes

This document records the end-to-end findings, architectural constraints, Microsoft-specific quirks, and required code fixes encountered during the setup and certification of the OpsKnight Microsoft Teams integration (Online Meetings & Bot Channel Operations).

---

## 1. Microsoft Teams PowerShell & Application Access Policies

### The Problem

Microsoft does not expose the Teams Application Access Policy configuration in the Teams Admin Center web UI. Graph API meeting creation on behalf of users using application permissions (`OnlineMeetings.ReadWrite.All`) fails with `403 Forbidden` unless an Application Access Policy is assigned in PowerShell.

### Gotchas & Solutions

- **Non-Interactive Client Secret Auth is Unsupported**: `Connect-MicrosoftTeams` does **not** accept client secrets. Unattended automation requires certificate thumbprints. For administrator-led setups on macOS, `-UseDeviceAuthentication` (`Connect-MicrosoftTeams -UseDeviceAuthentication`) must be used to authenticate via `https://login.microsoftcom/device`.
- **Policy Creation**:
  ```powershell
  New-CsApplicationAccessPolicy `
    -Identity "OpsKnightMeetingPolicy" `
    -AppIds "<CLIENT-ID>" `
    -Description "OpsKnight Meeting Policy"
  ```
- **Policy Assignment**:
  - Specific user: `Grant-CsApplicationAccessPolicy -Identity "user@tenant.onmicrosoft.com" -PolicyName "OpsKnightMeetingPolicy"`
  - Tenant-wide: `Grant-CsApplicationAccessPolicy -Global -PolicyName "OpsKnightMeetingPolicy"`
- **Propagation Delay**: Teams policies take **30 minutes to a few hours** to propagate across Microsoft's distributed backend.

---

## 2. Entra ID App Registration & API Permissions

### Finding 1: Application vs. Delegated Permissions

- **Gotcha**: Adding `OnlineMeetings.ReadWrite` as a **Delegated** permission causes the OAuth app-only client credentials token (`client_credentials` + `https://graph.microsoft.com/.default`) to have an empty roles claim (`roles: []`), leading to `403 Authorization_RequestDenied`.
- **Fix**: The permission **must** be an **Application** permission:
  - `OnlineMeetings.ReadWrite.All` (Application)
  - `User.Read.All` (Application) — needed to resolve email UPNs to Object IDs
  - Must click **"Grant admin consent for <Tenant>"** (green checkmark required in Status column).

### Finding 2: Supported Account Types (`isMSAApp`)

- **Gotcha**: If an Azure App Registration is initialized with _Personal Microsoft accounts only_ (`isMSAApp=true`), Microsoft Graph disables and hides the **Application permissions** card completely in the UI.
- **Fix**: In the app's **Manifest** tab in Azure Portal, change:
  ```json
  "signInAudience": "AzureADMyOrg"
  ```
  _(or `"AzureADMultipleOrgs"`)_ and save. The "Application permissions" option will immediately reappear.

---

## 3. Microsoft Graph Meeting Creation (`POST /onlineMeetings`)

### The GUID vs. Email Requirement

- **Gotcha**: Microsoft Graph's app-only endpoint:
  ```http
  POST /v1.0/users/{userId}/onlineMeetings/createOrGet
  ```
  strictly requires `{userId}` to be the user's **Entra Object ID (GUID)**. Passing an email address (`dushyant@...`) causes:
  ```json
  HTTP 400 Bad Request: "The userId in request URL is not a valid GUID."
  ```
- **Code Fix in OpsKnight**:
  Updated `TeamsMeetingAdapter.resolveOrganizer` in `src/lib/incident-collaboration/meeting-registry.ts` to automatically detect when `defaultMeetingOrganizerUpn` contains `@`, query `GET /v1.0/users/{email}?$select=id` via Microsoft Graph using the application token, and transparently swap the UPN for the Entra Object ID.

---

## 4. Teams App Package & Manifest Packaging (`.zip`)

### Finding 1: Root vs. Subfolder Packaging

- **Gotcha**: macOS (Safari) automatically extracts downloaded `.zip` files into a folder `opsknight-teams/`. If a user recompresses that folder, macOS nests the files inside `opsknight-teams/` and includes hidden `__MACOSX` metadata files.
- **Symptom**: Microsoft Teams Admin Center / Teams client fails with:
  ```text
  "Manifest parsing error message unavailable."
  ```
- **Fix**: The `.zip` archive must contain `manifest.json`, `color.png` (192x192), and `outline.png` (32x32) directly at the **root of the archive**:
  ```bash
  zip -X opsknight-teams.zip manifest.json color.png outline.png
  ```

### Finding 2: Localhost Rejection in Manifest

- **Gotcha**: When OpsKnight runs on `localhost:3000`, the default manifest generator previously produced:
  - `validDomains: ["localhost"]`
  - `webApplicationInfo.resource: "api://localhost/<botId>"`
    Teams rejects any manifest containing `localhost` with validation errors.
- **Code Fix in OpsKnight**:
  Updated `buildMicrosoftTeamsAppManifest` in `src/lib/microsoft-teams/app-manifest.ts` to detect loopback origins (`localhost`, `127.0.0.1`) and fall back to `opsknight.com` for `validDomains` and `api://${botId}` for `webApplicationInfo.resource`.

---

## 5. Adding Bot to a Team ("Bad Request" Resolution)

When adding the custom app to a Team/Channel in Microsoft Teams, a generic `Bad Request` error occurs due to two missing Azure configurations:

1. **Application ID URI in Expose an API**:
   - The manifest declares:
     ```json
     "webApplicationInfo": {
       "id": "<CLIENT_ID>",
       "resource": "api://<CLIENT_ID>"
     }
     ```
   - In Azure Entra ID > App registrations > OpsKnight > **Expose an API**, an **Application ID URI** matching `webApplicationInfo.resource` (e.g. `api://<CLIENT_ID>`) must be explicitly saved.
2. **Azure Bot Resource & Teams Channel**:
   - Because the manifest includes a `"bots"` array, Teams contacts the Bot Framework.
   - An **Azure Bot** resource must exist in Azure with the same App ID, and the **Microsoft Teams channel** must be toggled on under its _Channels_ blade.
   - Messaging endpoint should point to: `https://<APP_HOST>/api/microsoft-teams/messages`.

---

## 6. Summary of Verified Credentials (Test Tenant)

| Parameter                   | Value                                    | Location in OpsKnight                                        |
| :-------------------------- | :--------------------------------------- | :----------------------------------------------------------- |
| **Directory (Tenant) ID**   | `57307294-7f40-49db-911e-7256a5875c74`   | Database (`MicrosoftTeamsConfig.tenantId`)                   |
| **Application (Client) ID** | `14fd6d35-4de1-4311-a438-eb2e34e5802b`   | Database (`MicrosoftTeamsConfig.clientId`)                   |
| **Client Secret**           | _(Stored encrypted with AES-256-GCM)_    | Database (`MicrosoftTeamsConfig.clientSecret`)               |
| **Organizer UPN**           | `dushyant@opsknighttest.onmicrosoft.com` | Database (`MicrosoftTeamsConfig.defaultMeetingOrganizerUpn`) |
| **User Object ID**          | `a5995c42-57ca-4cd5-9159-a55c37a55d5e`   | Resolved automatically via Graph                             |
| **Policy Name**             | `OpsKnightMeetingPolicy`                 | Microsoft Teams backend (Assigned & Certified)               |

---

## 7. App Submission Collision: "The app's external ID is already being used"

### The Gotcha

When re-submitting or re-uploading a modified package to the Teams Catalog or client sideloading:

```text
"This app has already been submitted in your org.
The app's external ID is already being used. To submit it again, update the external ID."
```

In Teams manifests, `"id"` at the root represents the package's **External ID**. If the previous submission is retained or pending in the catalog, reusing the exact same manifest `"id"` causes an immediate collision error.

### The Fix

1. Generate a new unique GUID (`uuidgen`) for the root `"id"` in `manifest.json`:
   ```json
   "id": "<NEW-UNIQUE-GUID>",
   "version": "1.3.1"
   ```
2. Keep the Bot and Entra mappings intact:
   ```json
   "bots": [{ "botId": "<AZURE-APP-CLIENT-ID>", ... }],
   "webApplicationInfo": { "id": "<AZURE-APP-CLIENT-ID>", ... }
   ```
3. Teams will accept the upload as a fresh, non-conflicting package.

---

## 8. Teams Developer Portal / App Validation: Outline Icon Transparency

### The Error

```text
"Outline icon is not transparent. It's Alpha,R,G,B: 12,170,0,0"
```

### The Gotcha

Microsoft Teams strictly enforces that `outline.png` (32x32) must be a **monochrome white glyph on a transparent background** (`RGB = 255, 255, 255` for all visible pixels with varying alpha).
The original `outline.png` had anti-aliased reddish pixels from the red OpsKnight shield icon (`R=170, G=0, B=0, A=12`). Teams' automated validator rejects any outline icon where non-transparent pixels have colored RGB values.

### The Fix

Processed `outline.png` with PIL:

- Kept the exact alpha channel for anti-aliasing.
- Forced all visible pixels to pure white `(255, 255, 255, a)`.
- Verified 0 non-compliant colored pixels remain.
