// Firebase App (the core Firebase SDK) is always required and must be listed first
// database for testing purposes

// Testowa Baza Danych
const firebaseConfig = {
  apiKey: "AIzaSyDNY67dtYOw5z8rDqs_7rfSixsMDDukQEw",
  authDomain: "grafikkalinowa.firebaseapp.com",
  databaseURL: "https://grafikkalinowa-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "grafikkalinowa",
  storageBucket: "grafikkalinowa.firebasestorage.app",
  messagingSenderId: "531819524737",
  appId: "1:531819524737:web:bb3f279ef99419095e1380",
  measurementId: "G-5X744M8VG5"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
export const db = firebase.firestore();
export const auth = firebase.auth();

// Backward compatibility
window.db = db;
window.auth = auth;
