import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBlLa6-W94ZFzL5H1Z2xNKzpPYc7sKkiqA",
  authDomain: "restaurant-inventory-5505f.firebaseapp.com",
  projectId: "restaurant-inventory-5505f",
  storageBucket: "restaurant-inventory-5505f.firebasestorage.app",
  messagingSenderId: "57515342769",
  appId: "1:57515342769:web:e74e0e267aeca6d1d6db90",
  measurementId: "G-LCFKRKMN3F"
};

console.log("Firebase system core initializing sequence mounting...");

export const app = initializeApp(firebaseConfig);
export const dbFs = getFirestore(app);

console.log("Firestore secure cloud routing mapped successfully.");
