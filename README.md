# Job Digest Portal

Static portal that reads your daily job digest from Firebase Firestore.

## Setup
1. Copy `config.example.js` to `config.js` and paste your Firebase web config.
2. Set your Firestore collection name (default: `jobs`).
3. Host this folder on Vercel or Netlify as a static site.

## Firebase Rules (public read)
Use this if you want the portal public:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /jobs/{document} {
      allow read: if true;
      allow write: if false;
    }
  }
}
```

## Notes
- The backend (daily job search) should write to the `jobs` collection.
- The portal is read-only.
