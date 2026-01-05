### Firebase Cloud Messaging (FCM) setup and local testing

This guide explains how to configure FCM for iOS and Android, where to store credentials, and how to test push notifications with the LoocateMe backend.

Prerequisites:
- A Firebase project with Cloud Messaging enabled.
- Service account key for Firebase Admin SDK.

1) Backend configuration

- Create a Firebase service account (Project settings → Service accounts → Generate new private key). Download the JSON.
- Set environment variable GOOGLE_APPLICATION_CREDENTIALS_JSON with the JSON content (stringified) when starting the backend. Example:

  export GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat /path/to/firebase-admin-key.json)"
  export CORS_ORIGIN=http://localhost:19006
  export PORT=4000
  yarn --cwd loocateme_backend start

The backend file src/services/fcm.service.js initializes firebase-admin from this env var. If not present, push is disabled but the API remains functional.

2) Mobile app registration (React Native)

This repo doesn’t include @react-native-firebase/messaging yet. When you add it, you can use the helper in loocateme-app/components/PushService.js to send the token to the backend endpoint POST /api/push/register-token.

Example integration (pseudocode, see comments in PushService.js):

  import messaging from '@react-native-firebase/messaging';
  import { Platform } from 'react-native';
  import { sendTokenToBackend } from '../components/PushService';

  async function registerFcm() {
    const authStatus = await messaging().requestPermission();
    const enabled = authStatus === messaging.AuthorizationStatus.AUTHORIZED || authStatus === messaging.AuthorizationStatus.PROVISIONAL;
    if (!enabled) return;
    const token = await messaging().getToken();
    const platform = Platform.OS === 'ios' ? 'ios' : (Platform.OS === 'android' ? 'android' : 'unknown');
    await sendTokenToBackend(token, platform);
  }

Android setup (summary):
- Add google-services.json under android/app/.
- Update Android build.gradle and app/build.gradle for Google services and Firebase (per @react-native-firebase docs).
- Ensure notification permission and proper default channel configuration (if using local notifications).

iOS setup (summary):
- Add GoogleService-Info.plist to the iOS project.
- Enable Push Notifications and Background Modes → Remote notifications in Xcode capabilities.
- Upload your APNs key/certificate to Firebase (Project settings → Cloud Messaging). Use token-based APNs auth if possible.
- Update AppDelegate/App setup per @react-native-firebase/messaging docs to request permission and receive notifications.

2bis) Unified server-side push util (one-call iOS+Android)

You can send a configurable notification to both platforms with one function:

  import { sendUnifiedNotification } from './src/services/fcm.service.js';

  // Example: send to a list of userIds (their registered tokens will be resolved)
  await sendUnifiedNotification({
    userIds: ['<USER_ID_1>', '<USER_ID_2>'],
    title: 'Hello from LoocateMe',
    body: 'This is a cross-platform push 👋',
    data: { kind: 'demo', deepLink: 'loocate://home' },
    imageUrl: 'https://example.com/image.png',
    sound: 'default',
    badge: 1,
    androidChannelId: 'default',
    priority: 'high',
    collapseKey: 'demo',
    mutableContent: false,
    contentAvailable: false,
  });

Or pass tokens directly:

  await sendUnifiedNotification({
    tokens: ['<FCM_TOKEN_1>', '<FCM_TOKEN_2>'],
    title: 'Direct push',
    body: 'Sent using raw tokens',
  });

3) Local testing of push

Step A — Register a token:
- Build/run the app on a device/emulator configured with FCM.
- After obtaining the device token, call the backend endpoint to register it:

  curl -X POST \
    -H "Authorization: Bearer <ACCESS_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"token":"<FCM_TOKEN>","platform":"android"}' \
    http://localhost:4000/api/push/register-token

Step B — Trigger a “profile viewed” event:
- This is automatically done when one user opens another user’s profile in the app. It will create an Event and send a push to the target user (if tokens exist).
- To test via curl:

  curl -X POST \
    -H "Authorization: Bearer <ACCESS_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"targetUserId": "<TARGET_USER_ID>"}' \
    http://localhost:4000/api/events/profile-view

Expected result: if the target user has registered tokens and GOOGLE_APPLICATION_CREDENTIALS_JSON is set correctly, they should receive a push titled “Nouvelle visite”. If the target is Premium, the message may include visitor details.

4) Troubleshooting

- If you see [fcm] GOOGLE_APPLICATION_CREDENTIALS_JSON not set; push disabled, ensure the env var is exported and visible to the node process.
- If you see errors about APNs on iOS, confirm that your APNs key is uploaded to Firebase and that the bundle identifier matches.
- For Android, verify google-services.json is for the correct applicationId and that Google Services Gradle plugin is applied.
