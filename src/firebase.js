import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyCt1MzAlWIUiO1_AudLepVSMikEWH255NY",
  authDomain: "movi-f72fb.firebaseapp.com",
  projectId: "movi-f72fb",
  storageBucket: "movi-f72fb.appspot.com", // IMPORTANT FIX
  messagingSenderId: "195315033727",
  appId: "1:195315033727:web:20c4525c332f114496814a"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const storage = getStorage(app);