# checker-pro
checkera game app
# Checkers Pro 🏁

A modern Checkers game with:

✅ 2 Player (same device)  
✅ Hard AI (Minimax)  
✅ Online Multiplayer (Firebase Realtime Database)  
✅ Installable PWA (offline support)

---

## Setup

### 1) Clone / Download
Put all files in one folder.

### 2) Firebase Setup
Create a Firebase project and enable **Realtime Database**.

Then open `firebase.js` and paste your Firebase config.

---

## Realtime Database Rules (for testing)

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
