import React, { useState } from "react";
import emailjs from "@emailjs/browser";

import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";

import { db } from "../firebase";

export default function Login() {
  const [isSignup, setIsSignup] = useState(false);
  const [showOtp, setShowOtp] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [otpInput, setOtpInput] = useState("");
  const [generatedOtp, setGeneratedOtp] = useState("");

  const sendOTP = async (email) => {
    const otp = Math.floor(
      100000 + Math.random() * 900000
    ).toString();

    setGeneratedOtp(otp);

    await emailjs.send(
      "service_7bcnbg5",
      "template_tlsvnx8",
      {
        to_email: email,
        otp: otp,
      },
      "GN3853npRdZpRfzfz"
    );

    return otp;
  };

  const signup = async () => {
    try {
      if (!email || !password) {
        alert("Fill all fields");
        return;
      }

      const existing = await getDocs(
        query(
          collection(db, "users"),
          where("email", "==", email)
        )
      );

      if (!existing.empty) {
        alert("Email already exists");
        return;
      }

      await sendOTP(email);

      setShowOtp(true);

      alert("OTP Sent To Email");
    } catch (err) {
      console.log(err);
      alert("Failed To Send OTP");
    }
  };

  const verifyOtp = async () => {
    try {
      if (otpInput !== generatedOtp) {
        alert("Invalid OTP");
        return;
      }

      await addDoc(collection(db, "users"), {
        email,
        password,
        verified: true,
        createdAt: Date.now(),
      });

      localStorage.setItem(
        "user",
        JSON.stringify({
          email,
        })
      );

      alert("Account Created");

      window.location.reload();
    } catch (err) {
      console.log(err);
      alert("Verification Failed");
    }
  };

  const login = async () => {
    try {
      const snap = await getDocs(
        query(
          collection(db, "users"),
          where("email", "==", email),
          where("password", "==", password),
          where("verified", "==", true)
        )
      );

      if (snap.empty) {
        alert("Invalid Login");
        return;
      }

      localStorage.setItem(
        "user",
        JSON.stringify({
          email,
        })
      );

      alert("Login Success");

      window.location.reload();
    } catch (err) {
      console.log(err);
      alert("Login Failed");
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#000",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "20px",
      }}
    >
      <div
        style={{
          width: "350px",
          background: "#111",
          padding: "25px",
          borderRadius: "12px",
        }}
      >
        <h2
          style={{
            color: "#fff",
            textAlign: "center",
            marginBottom: "20px",
          }}
        >
          {showOtp
            ? "Verify OTP"
            : isSignup
            ? "Create Account"
            : "Login"}
        </h2>

        {!showOtp && (
          <>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) =>
                setEmail(e.target.value)
              }
              style={{
                width: "100%",
                padding: "12px",
                marginBottom: "10px",
              }}
            />

            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) =>
                setPassword(e.target.value)
              }
              style={{
                width: "100%",
                padding: "12px",
                marginBottom: "15px",
              }}
            />

            <button
              onClick={
                isSignup ? signup : login
              }
              style={{
                width: "100%",
                padding: "12px",
                background: "#e50914",
                color: "#fff",
                border: "none",
                cursor: "pointer",
                borderRadius: "6px",
              }}
            >
              {isSignup
                ? "Send OTP"
                : "Login"}
            </button>

            <p
              onClick={() =>
                setIsSignup(!isSignup)
              }
              style={{
                color: "#fff",
                textAlign: "center",
                marginTop: "15px",
                cursor: "pointer",
              }}
            >
              {isSignup
                ? "Already have an account?"
                : "Create Account"}
            </p>
          </>
        )}

        {showOtp && (
          <>
            <input
              type="text"
              placeholder="Enter OTP"
              value={otpInput}
              onChange={(e) =>
                setOtpInput(e.target.value)
              }
              style={{
                width: "100%",
                padding: "12px",
                marginBottom: "15px",
              }}
            />

            <button
              onClick={verifyOtp}
              style={{
                width: "100%",
                padding: "12px",
                background: "#e50914",
                color: "#fff",
                border: "none",
                cursor: "pointer",
                borderRadius: "6px",
              }}
            >
              Verify OTP
            </button>
          </>
        )}
      </div>
    </div>
  );
}