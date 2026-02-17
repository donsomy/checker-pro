// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyD2DlQJbmDm5PUQsHCmT80ImosRpEhOO5Y",
  authDomain: "checkers-ikpupro.firebaseapp.com",
  projectId: "checkers-ikpupro",
  storageBucket: "checkers-ikpupro.firebasestorage.app",
  messagingSenderId: "291151514355",
  appId: "1:291151514355:web:b6306862ddf25241a38586",
  measurementId: "G-3BRRRHC1LR"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
