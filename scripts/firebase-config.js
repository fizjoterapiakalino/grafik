// Firebase App (the core Firebase SDK) is always required and must be listed first
// database for testing purposes

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCdPhCgZeFYv3fLrd9Xc4AVwBu70cCvlVQ",
  authDomain: "grafikkalinowa-c1b41.firebaseapp.com",
  projectId: "grafikkalinowa-c1b41",
  storageBucket: "grafikkalinowa-c1b41.firebasestorage.app",
  messagingSenderId: "59665168961",
  appId: "1:59665168961:web:166b1816b1981b2babe4c0",
  measurementId: "G-RXBFWH2CXN"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
export const db = firebase.firestore();
export const auth = firebase.auth();

// Backward compatibility
window.db = db;
window.auth = auth;