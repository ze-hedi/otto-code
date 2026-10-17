# Otto Mobile

Standalone Expo (React Native, TypeScript) client for the Otto agent backend in
`web_app/backend`. See [PLAN.md](./PLAN.md) for scope and design.

## Run

```bash
cd mobile
npm install
npx expo install --fix   # aligns native package versions with the installed Expo SDK
npx expo start
```

1. Start the backend (`web_app/backend`, port 4000).
2. In the app: **Settings → Backend URL**. On a physical phone use your computer's
   LAN IP (e.g. `http://192.168.1.20:4000`), not `localhost`. Android emulator: `http://10.0.2.2:4000`.
3. Projects → pick a project → pick an agent → chat.

Streaming uses `expo/fetch`, so it needs a development build or Expo Go on a recent SDK.
