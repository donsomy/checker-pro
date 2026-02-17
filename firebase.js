
const firebaseConfig = {
  apiKey: "AIzaSyD2DlQJbmDm5PUQsHCmT80ImosRpEhOO5Y",
  authDomain: "checkers-ikpupro.firebaseapp.com",
  databaseURL: "https://checkers-ikpupro-default-rtdb.firebaseio.com",
  projectId: "checkers-ikpupro",
  storageBucket: "checkers-ikpupro.firebasestorage.app",
  messagingSenderId: "291151514355",
  appId: "1:291151514355:web:b6306862ddf25241a38586",
  measurementId: "G-3BRRRHC1LR"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
