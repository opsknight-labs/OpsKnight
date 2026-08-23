---
order: 4
---

# Mobile PWA

OpsKnight works as a Progressive Web App for mobile access.

## Features

- 📱 Install on home screen
- 🔔 Push notifications
- 📶 Offline support
- 🔒 **Biometric App Lock**
- 🔍 **Spotlight Search**
- ⚡ Fast, app-like experience

## Installation

### iOS (Safari)

1. Open OpsKnight in Safari
2. Tap the **Share** button
3. Scroll and tap **Add to Home Screen**
4. Tap **Add**

### Android (Chrome)

1. Open OpsKnight in Chrome
2. Tap the menu (⋮)
3. Tap **Install app** or **Add to Home Screen**
4. Confirm installation

## Push Notifications

### Enabling Push

1. Open OpsKnight on mobile
2. A prompt will ask for notification permission
3. Tap **Allow**
4. Notifications are now enabled

### What Gets Notified

- New incidents assigned to you
- Escalation to you
- Incidents for services you follow

### Notification Settings

Configure in **Settings → Preferences**:

- Enable/disable push
- Quiet hours
- Notification types

## Offline Mode

The PWA supports basic offline functionality:

- View cached incidents
- See last-known service status
- Queue actions for when online

### Limitations

When offline:

- Cannot create new incidents
- Cannot receive new alerts
- Data may be stale

## Security & Navigation

### Biometric App Lock

OpsKnight Mobile includes a privacy screen feature:

1. Go to **More → Preferences**.
2. Toggle **App Lock**.
3. When you switch apps or minimize OpsKnight, it instantly locks.
4. Unlock using your device's native FaceID/TouchID/PIN.

### Spotlight Search

Quickly jump to any incident, service, or team:

- **Mobile**: Tap the Search icon in the header.
- **Keyboard**: Press `Cmd+K` (Mac) or `Ctrl+K` (Windows).

## Requirements

### Browser Support

| Browser      | Minimum Version |
| ------------ | --------------- |
| Chrome       | 67+             |
| Safari (iOS) | 11.3+           |
| Firefox      | 58+             |
| Edge         | 79+             |

### Server Requirements

- HTTPS required for PWA
- Service Worker enabled
- Manifest.json served

## Troubleshooting

### Push Not Working

1. Check browser notification permissions
2. Verify push is enabled in Settings
3. Clear browser cache
4. Reinstall PWA

### App Not Installing

1. Ensure HTTPS
2. Clear browser cache
3. Try different browser
4. Check browser compatibility

## Best Practices

- ✅ Install for fastest access
- ✅ Enable push for critical alerts
- ✅ Keep the app updated
- ✅ Use on reliable networks
