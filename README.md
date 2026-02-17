# Checkers Pro

A clean Checkers game you can run on GitHub Pages.

## Features
- 2 Player (local)
- AI mode (Hard minimax)
- Online multiplayer (Firebase Realtime Database)

## Setup
1. Open `firebase.js`
2. Paste your Firebase config values.
3. In Firebase Realtime Database rules, allow read/write for testing:

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

## Run locally
Just open `index.html` in your browser.

## Deploy on GitHub Pages
- Push to GitHub
- Settings -> Pages -> Deploy from branch -> main -> /root
- Open the link
- 
