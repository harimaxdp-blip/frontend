import React, { useEffect, useState } from "react";
import {
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
} from "firebase/auth";
import { auth, provider } from "../firebase";

export default function Login() {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    console.log("🚀 Login Page Loaded");

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      console.log("🔥 AUTH STATE:", user);

      if (user) {
        console.log("✅ USER LOGGED IN");
        console.log("UID:", user.uid);
        console.log("Name:", user.displayName);
        console.log("Email:", user.email);

        alert("Login Success: " + user.email);
      }
    });

    const checkRedirect = async () => {
      try {
        console.log("🔍 Checking Redirect Result...");

        const result = await getRedirectResult(auth);

        console.log("📦 Redirect Result:", result);

if (result?.user) {
  console.log("✅ Redirect Success", result.user);

  alert("Login Success: " + result.user.email);

  setLoading(false);
}else {
          console.log("⚠️ No Redirect Result Found");
        }
      } catch (error) {
        console.error("❌ REDIRECT ERROR:", error);
        console.error("CODE:", error.code);
        console.error("MESSAGE:", error.message);

        alert(
          `Firebase Error\n\n${error.code}\n\n${error.message}`
        );
      }
    };

    checkRedirect();

    return () => unsubscribe();
  }, []);

  const handleGoogleLogin = async () => {
    try {
      console.log("🚀 Starting Google Login");

      setLoading(true);

await signInWithRedirect(auth, provider);
    } catch (error) {
      console.error("❌ LOGIN ERROR:", error);
      console.error("CODE:", error.code);
      console.error("MESSAGE:", error.message);

      alert(
        `Login Error\n\n${error.code}\n\n${error.message}`
      );

      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <img
          src="/logo192.png"
          alt="Logo"
          style={styles.logo}
        />

        <h1 style={styles.title}>Welcome to MOVI</h1>

        <p style={styles.subtitle}>
          Sign in with Google to continue
        </p>

        <button
          onClick={handleGoogleLogin}
          style={styles.googleBtn}
          disabled={loading}
        >
          {loading
            ? "Redirecting..."
            : "Continue with Google"}
        </button>
      </div>
    </div>
  );
}

const styles = {
  container: {
    width: "100%",
    height: "100vh",
    background: "#000",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: "20px",
  },
  card: {
    width: "100%",
    maxWidth: "420px",
    background: "#111",
    borderRadius: "24px",
    padding: "40px 30px",
    textAlign: "center",
  },
  logo: {
    width: "90px",
    marginBottom: "20px",
  },
  title: {
    color: "#fff",
    marginBottom: "10px",
  },
  subtitle: {
    color: "#999",
    marginBottom: "30px",
  },
  googleBtn: {
    width: "100%",
    height: "56px",
    border: "none",
    borderRadius: "14px",
    background: "#fff",
    cursor: "pointer",
    fontSize: "16px",
    fontWeight: "600",
  },
};