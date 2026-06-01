import React, { useState, useEffect, useRef, useCallback } from "react";
import emailjs from "@emailjs/browser";
import bcrypt from "bcryptjs";
import { collection, addDoc, getDocs, query, where, updateDoc, doc } from "firebase/firestore";
import { db } from "../firebase";
import "./Login.css";
import logi from "../assets/logi.png";

// ═══════════════════════════════════════════════════════════════════
// SVG ICONS (zero emojis)
// ═══════════════════════════════════════════════════════════════════
const IconMail = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2"/>
    <polyline points="2,4 12,13 22,4"/>
  </svg>
);
const IconLock = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>
);
const IconEye = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);
const IconEyeOff = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
);
const IconArrowLeft = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="12" x2="5" y2="12"/>
    <polyline points="12 19 5 12 12 5"/>
  </svg>
);
const IconClipboard = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="2" width="6" height="4" rx="1"/>
    <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"/>
  </svg>
);
const IconCheckCircle = () => (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
    <polyline points="22 4 12 14.01 9 11.01"/>
  </svg>
);
const IconAlertCircle = () => (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="8" x2="12" y2="12"/>
    <line x1="12" y1="16" x2="12.01" y2="16"/>
  </svg>
);
const IconWarning = () => (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
);
const IconInfo = () => (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="8" x2="12" y2="12"/>
    <line x1="12" y1="16" x2="12.01" y2="16"/>
  </svg>
);
const IconClose = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);
const IconCheckSmall = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
const IconXSmall = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);
const IconInfoSmall = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="8" x2="12" y2="12"/>
    <line x1="12" y1="16" x2="12.01" y2="16"/>
  </svg>
);

// ═══════════════════════════════════════════════════════════════════
// DIALOG / ALERT MODAL SYSTEM
// ═══════════════════════════════════════════════════════════════════
let dialogResolve = null;
const dialogListeners = [];

export const showDialog = ({ type = "info", title, message, confirmText = "OK", cancelText = null }) => {
  return new Promise((resolve) => {
    dialogResolve = resolve;
    dialogListeners.forEach((cb) => cb({ open: true, type, title, message, confirmText, cancelText }));
  });
};

// Convenience wrappers
export const alertDialog = (title, message, type = "info") =>
  showDialog({ type, title, message, confirmText: "OK" });

export const successDialog = (title, message) =>
  showDialog({ type: "success", title, message, confirmText: "Continue" });

export const errorDialog = (title, message) =>
  showDialog({ type: "error", title, message, confirmText: "Try Again" });

export function DialogContainer() {
  const [state, setState] = useState({ open: false, type: "info", title: "", message: "", confirmText: "OK", cancelText: null });
  const btnRef = useRef(null);

  useEffect(() => {
    const handler = (s) => setState(s);
    dialogListeners.push(handler);
    return () => dialogListeners.splice(dialogListeners.indexOf(handler), 1);
  }, []);

  useEffect(() => {
    if (state.open) {
      setTimeout(() => btnRef.current?.focus(), 80);
    }
  }, [state.open]);

  const handleConfirm = () => {
    setState((s) => ({ ...s, open: false }));
    dialogResolve && dialogResolve(true);
  };

  const handleCancel = () => {
    setState((s) => ({ ...s, open: false }));
    dialogResolve && dialogResolve(false);
  };

  const handleKeyDown = useCallback((e) => {
    if (!state.open) return;
    if (e.key === "Escape") handleCancel();
    if (e.key === "Enter") handleConfirm();
  }, [state.open]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (!state.open) return null;

  const icons = {
    success: <IconCheckCircle />,
    error:   <IconAlertCircle />,
    warning: <IconWarning />,
    info:    <IconInfo />,
  };

  return (
    <div className="dialog-overlay" onClick={(e) => e.target === e.currentTarget && handleCancel()} role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <div className={`dialog-box dialog-${state.type}`}>
        {/* Top accent bar */}
        <div className="dialog-accent-bar" />

        {/* Close X */}
        <button className="dialog-close-btn" onClick={handleCancel} aria-label="Close">
          <IconClose />
        </button>

        {/* Icon */}
        <div className={`dialog-icon-wrap dialog-icon-${state.type}`}>
          {icons[state.type]}
        </div>

        {/* Content */}
        <h3 className="dialog-title" id="dialog-title">{state.title}</h3>
        <p className="dialog-message">{state.message}</p>

        {/* Actions */}
        <div className={`dialog-actions ${state.cancelText ? "dialog-actions-two" : "dialog-actions-one"}`}>
          {state.cancelText && (
            <button className="dialog-btn dialog-btn-cancel" onClick={handleCancel}>
              {state.cancelText}
            </button>
          )}
          <button
            ref={btnRef}
            className={`dialog-btn dialog-btn-confirm dialog-btn-confirm-${state.type}`}
            onClick={handleConfirm}
          >
            {state.confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TOAST SYSTEM (slim banner — stays alongside dialog)
// ═══════════════════════════════════════════════════════════════════
let toastId = 0;
const toastListeners = [];
export const toast = (message, type = "info", duration = 3500) => {
  const id = ++toastId;
  toastListeners.forEach((cb) => cb({ id, message, type, duration }));
};

export function ToastContainer() {
  const [toasts, setToasts] = useState([]);
  useEffect(() => {
    const handler = (t) => {
      setToasts((prev) => [...prev, t]);
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), t.duration);
    };
    toastListeners.push(handler);
    return () => toastListeners.splice(toastListeners.indexOf(handler), 1);
  }, []);
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span className="toast-icon">
            {t.type === "success" ? <IconCheckSmall /> : t.type === "error" ? <IconXSmall /> : <IconInfoSmall />}
          </span>
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════
const EMAILJS_SERVICE_ID  = "service_7bcnbg5";
const EMAILJS_TEMPLATE_ID = "template_tlsvnx8";
const EMAILJS_PUBLIC_KEY  = "GN3853npRdZpRfzfz";
const OTP_VALIDITY_MS     = 60_000;
const GMAIL_SUFFIX        = "@gmail.com";

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════
const sanitizeEmail  = (v) => { const l = v.toLowerCase().trim(); return l.includes("@") ? l : l + GMAIL_SUFFIX; };
const validateEmail  = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const validatePass   = (v) => v.length === 8;
const generateOtp    = () => Math.floor(100000 + Math.random() * 900000).toString();
const sendOtpEmail   = (email, otp) =>
  emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, { to_email: email, otp }, EMAILJS_PUBLIC_KEY);

// ═══════════════════════════════════════════════════════════════════
// EMAIL INPUT — with live @gmail.com suffix
// ═══════════════════════════════════════════════════════════════════
function EmailInput({ value, onChange, error, disabled, onEnter }) {
  const showSuffix = value.length > 0 && !value.includes("@");
  return (
    <div className={`input-group ${error ? "input-error" : ""}`}>
      <span className="input-icon"><IconMail /></span>
      <div className="email-input-wrap">
        <input
          type="text"
          placeholder="Email"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onEnter && onEnter()}
          disabled={disabled}
          autoComplete="email"
          inputMode="email"
        />
        {showSuffix && <span className="email-suffix">{GMAIL_SUFFIX}</span>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// OTP 6-BOX INPUT
// ═══════════════════════════════════════════════════════════════════
function OtpBoxInput({ value, onChange, disabled, expired }) {
  const inputs = useRef([]);

  const handleChange = (idx, e) => {
    const char = e.target.value.replace(/\D/g, "").slice(-1);
    const arr  = (value + "      ").slice(0, 6).split("");
    arr[idx]   = char;
    onChange(arr.join("").trimEnd().padEnd(6, " ").slice(0, 6).replace(/ /g, "").padEnd(value.length > idx ? value.length : idx + (char ? 1 : 0), " "));
    // simpler: just replace at index
    const next = value.split("");
    while (next.length < 6) next.push("");
    next[idx] = char;
    onChange(next.join(""));
    if (char && idx < 5) inputs.current[idx + 1]?.focus();
  };

  const handleKeyDown = (idx, e) => {
    if (e.key === "Backspace") {
      const arr = (value + "      ").slice(0, 6).split("");
      if (!arr[idx]?.trim() && idx > 0) {
        inputs.current[idx - 1]?.focus();
        arr[idx - 1] = "";
        onChange(arr.join(""));
      } else {
        arr[idx] = "";
        onChange(arr.join(""));
      }
    }
    if (e.key === "ArrowLeft"  && idx > 0) inputs.current[idx - 1]?.focus();
    if (e.key === "ArrowRight" && idx < 5) inputs.current[idx + 1]?.focus();
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    onChange(pasted.padEnd(6, " ").slice(0, 6));
    const fi = Math.min(pasted.length, 5);
    inputs.current[fi]?.focus();
  };

  const digits = (value + "      ").slice(0, 6).split("");

  return (
    <div className="otp-boxes">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => (inputs.current[i] = el)}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={d.trim()}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          disabled={disabled || expired}
          className={`otp-box ${expired ? "otp-box-expired" : ""} ${d.trim() ? "otp-box-filled" : ""}`}
          autoComplete="one-time-code"
        />
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// OTP SCREEN
// ═══════════════════════════════════════════════════════════════════
function OtpScreen({ email, onVerified, onBack, onResend }) {
  const [otp,       setOtp]       = useState("      ");
  const [loading,   setLoading]   = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [expired,   setExpired]   = useState(false);

  useEffect(() => {
    if (countdown <= 0) { setExpired(true); return; }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const handleVerify = async () => {
    const code = otp.replace(/\s/g, "");
    if (expired)        { await errorDialog("OTP Expired", "Your OTP has expired. Please request a new one."); return; }
    if (code.length !== 6) { await errorDialog("Invalid OTP", "Please enter all 6 digits of your OTP."); return; }
    setLoading(true);
    try { await onVerified(code); }
    finally { setLoading(false); }
  };

  const handlePasteClipboard = async () => {
    try {
      const text   = await navigator.clipboard.readText();
      const digits = text.replace(/\D/g, "").slice(0, 6);
      if (digits.length === 6) {
        setOtp(digits);
        toast("OTP pasted from clipboard!", "success");
      } else {
        await errorDialog("Paste Failed", "Could not find a 6-digit OTP in your clipboard.");
      }
    } catch {
      await errorDialog("Clipboard Access", "Clipboard access was denied. Please paste manually.");
    }
  };

  const handleResend = async () => {
    setOtp("      ");
    setCountdown(60);
    setExpired(false);
    await onResend();
    toast("A new OTP has been sent!", "success");
  };

  return (
    <div className="form-section">
      <p className="otp-hint">
        A 6-digit code was sent to <strong>{email}</strong>
      </p>
      <OtpBoxInput value={otp} onChange={setOtp} disabled={loading} expired={expired} />
      <button className="btn-paste" onClick={handlePasteClipboard} disabled={loading || expired} type="button">
        <IconClipboard /> Paste OTP from Clipboard
      </button>
      <div className="otp-meta">
        {expired
          ? <span className="otp-expired">OTP Expired</span>
          : <span className="otp-countdown">Expires in {countdown}s</span>}
        <button className="link-btn" onClick={handleResend} disabled={loading}>Resend OTP</button>
      </div>
      <button className="btn-primary" onClick={handleVerify} disabled={loading || expired}>
        {loading ? <span className="spinner" /> : "Verify OTP"}
      </button>
      <button className="link-btn back-btn" onClick={onBack}>
        <IconArrowLeft /> Back
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// FORGOT PASSWORD
// ═══════════════════════════════════════════════════════════════════
function ForgotPassword({ onBack }) {
  const [step,        setStep]       = useState("email");
  const [email,       setEmail]      = useState("");
  const [emailErr,    setEmailErr]   = useState("");
  const [otpStore,    setOtpStore]   = useState({ code: "", expiry: 0 });
  const [newPass,     setNewPass]    = useState("");
  const [confirmPass, setConfirmPass]= useState("");
  const [passErr,     setPassErr]    = useState("");
  const [showPass,    setShowPass]   = useState(false);
  const [loading,     setLoading]    = useState(false);

  const sendOtp = async () => {
    const clean = sanitizeEmail(email);
    if (!validateEmail(clean)) { setEmailErr("Enter a valid email"); return; }
    setEmailErr("");
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, "users"), where("email", "==", clean)));
      if (snap.empty) {
        await errorDialog("Account Not Found", `No account is registered with ${clean}. Please check the email or create a new account.`);
        return;
      }
      const code = generateOtp();
      await sendOtpEmail(clean, code);
      setOtpStore({ code, expiry: Date.now() + OTP_VALIDITY_MS });
      setStep("otp");
      toast("OTP sent to your email!", "success");
    } catch {
      await errorDialog("Send Failed", "Failed to send OTP. Please check your internet connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async (inputOtp) => {
    if (Date.now() > otpStore.expiry) {
      await errorDialog("OTP Expired", "Your OTP has expired. Please go back and request a new one.");
      return;
    }
    if (inputOtp !== otpStore.code) {
      await errorDialog("Invalid OTP", "The OTP you entered is incorrect. Please check your email and try again.");
      return;
    }
    setStep("newpass");
    toast("OTP verified successfully!", "success");
  };

  const resendOtp = async () => {
    const code = generateOtp();
    await sendOtpEmail(sanitizeEmail(email), code);
    setOtpStore({ code, expiry: Date.now() + OTP_VALIDITY_MS });
  };

  const updatePassword = async () => {
    if (!validatePass(newPass)) {
      setPassErr("Password must be exactly 8 characters");
      await errorDialog("Invalid Password", "Your password must be exactly 8 characters long.");
      return;
    }
    if (newPass !== confirmPass) {
      setPassErr("Passwords do not match");
      await errorDialog("Passwords Don't Match", "The passwords you entered do not match. Please try again.");
      return;
    }
    setPassErr("");
    setLoading(true);
    try {
      const clean = sanitizeEmail(email);
      const snap  = await getDocs(query(collection(db, "users"), where("email", "==", clean)));
      if (snap.empty) { await errorDialog("Account Not Found", "Could not find your account. Please restart the process."); return; }
      const hashed = await bcrypt.hash(newPass, 10);
      await updateDoc(doc(db, "users", snap.docs[0].id), { password: hashed });
      await successDialog("Password Updated!", "Your password has been successfully changed. You can now log in with your new password.");
      onBack();
    } catch {
      await errorDialog("Update Failed", "Failed to update your password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="form-section">
      <h2 className="form-title">Forgot Password</h2>
      <p className="form-subtitle">
        {step === "email"   && "Enter your email to receive an OTP"}
        {step === "otp"     && "Check your inbox"}
        {step === "newpass" && "Set a new password"}
      </p>

      {step === "email" && (
        <>
          <EmailInput value={email} onChange={setEmail} error={!!emailErr} disabled={loading} onEnter={sendOtp} />
          {emailErr && <p className="field-error">{emailErr}</p>}
          <button className="btn-primary" onClick={sendOtp} disabled={loading}>
            {loading ? <span className="spinner" /> : "Send OTP"}
          </button>
        </>
      )}

      {step === "otp" && (
        <OtpScreen
          email={sanitizeEmail(email)}
          onVerified={verifyOtp}
          onBack={() => setStep("email")}
          onResend={resendOtp}
        />
      )}

      {step === "newpass" && (
        <>
          <div className={`input-group ${passErr ? "input-error" : ""}`}>
            <span className="input-icon"><IconLock /></span>
            <input
              type={showPass ? "text" : "password"}
              placeholder="New Password (8 chars)"
              value={newPass}
              onChange={(e) => setNewPass(e.target.value.slice(0, 8))}
              disabled={loading}
              maxLength={8}
            />
            <button className="eye-btn" onClick={() => setShowPass((s) => !s)} type="button">
              {showPass ? <IconEyeOff /> : <IconEye />}
            </button>
          </div>
          <div className={`input-group ${passErr ? "input-error" : ""}`}>
            <span className="input-icon"><IconLock /></span>
            <input
              type={showPass ? "text" : "password"}
              placeholder="Confirm Password"
              value={confirmPass}
              onChange={(e) => setConfirmPass(e.target.value.slice(0, 8))}
              onKeyDown={(e) => e.key === "Enter" && updatePassword()}
              disabled={loading}
              maxLength={8}
            />
          </div>
          {passErr && <p className="field-error">{passErr}</p>}
          <button className="btn-primary" onClick={updatePassword} disabled={loading}>
            {loading ? <span className="spinner" /> : "Update Password"}
          </button>
        </>
      )}

      {step !== "otp" && (
        <button className="link-btn back-btn" onClick={onBack}>
          <IconArrowLeft /> Back to Login
        </button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// LOGIN SCREEN
// ═══════════════════════════════════════════════════════════════════
function LoginScreen({ onSwitch, onForgot }) {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [emailErr, setEmailErr] = useState("");
  const [passErr,  setPassErr]  = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading,  setLoading]  = useState(false);

  const validate = () => {
    let ok = true;
    if (!validateEmail(sanitizeEmail(email))) { setEmailErr("Enter a valid email"); ok = false; } else setEmailErr("");
    if (!password) { setPassErr("Password is required"); ok = false; } else setPassErr("");
    return ok;
  };

  const handleLogin = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      const clean = sanitizeEmail(email);
      const snap  = await getDocs(
        query(collection(db, "users"), where("email", "==", clean), where("verified", "==", true))
      );
      if (snap.empty) {
        await errorDialog("Account Not Found", `No verified account exists for ${clean}. Please check your email or create a new account.`);
        return;
      }
      const userData = snap.docs[0].data();
      const match    = await bcrypt.compare(password, userData.password);
      if (!match) {
        await errorDialog("Incorrect Password", "The password you entered is wrong. Please try again or use 'Forgot Password' to reset it.");
        return;
      }
      localStorage.setItem("user", JSON.stringify({ email: clean }));
      await successDialog("Welcome Back!", `You have successfully logged in as ${clean}.`);
      window.location.reload();
    } catch {
      await errorDialog("Login Failed", "Something went wrong. Please check your internet connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="form-section">
      <h2 className="form-title">Welcome Back</h2>
      <p className="form-subtitle">Sig in to continue</p>

      <EmailInput value={email} onChange={setEmail} error={!!emailErr} disabled={loading} onEnter={handleLogin} />
      {emailErr && <p className="field-error">{emailErr}</p>}

      <div className={`input-group ${passErr ? "input-error" : ""}`}>
        <span className="input-icon"><IconLock /></span>
        <input
          type={showPass ? "text" : "password"}
          placeholder="Password (8 chars)"
          value={password}
          onChange={(e) => setPassword(e.target.value.slice(0, 8))}
          onKeyDown={(e) => e.key === "Enter" && handleLogin()}
          disabled={loading}
          maxLength={8}
        />
        <button className="eye-btn" onClick={() => setShowPass((s) => !s)} tabIndex={-1} type="button">
          {showPass ? <IconEyeOff /> : <IconEye />}
        </button>
      </div>
      {passErr && <p className="field-error">{passErr}</p>}

      <div className="forgot-row">
        <button className="link-btn forgot-link" onClick={onForgot}>Forgot Password?</button>
      </div>

      <button className="btn-primary" onClick={handleLogin} disabled={loading}>
        {loading ? <span className="spinner" /> : "Login"}
      </button>

      <p className="switch-text">
        Don't have an account?{" "}
        <button className="link-btn highlight" onClick={onSwitch}>Create Account</button>
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SIGNUP SCREEN
// ═══════════════════════════════════════════════════════════════════
function SignupScreen({ onSwitch }) {
  const [step,        setStep]       = useState("form");
  const [email,       setEmail]      = useState("");
  const [password,    setPassword]   = useState("");
  const [confirmPass, setConfirmPass]= useState("");
  const [emailErr,    setEmailErr]   = useState("");
  const [passErr,     setPassErr]    = useState("");
  const [showPass,    setShowPass]   = useState(false);
  const [loading,     setLoading]    = useState(false);
  const [otpStore,    setOtpStore]   = useState({ code: "", expiry: 0 });

  const validate = () => {
    let ok = true;
    if (!validateEmail(sanitizeEmail(email))) { setEmailErr("Enter a valid email"); ok = false; } else setEmailErr("");
    if (!validatePass(password)) { setPassErr("Password must be exactly 8 characters"); ok = false; }
    else if (password !== confirmPass) { setPassErr("Passwords do not match"); ok = false; }
    else setPassErr("");
    return ok;
  };

  const handleSendOtp = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      const clean    = sanitizeEmail(email);
      const existing = await getDocs(query(collection(db, "users"), where("email", "==", clean)));
      if (!existing.empty) {
        await errorDialog("Email Already Registered", `${clean} is already registered. Please log in or use a different email.`);
        return;
      }
      const code = generateOtp();
      await sendOtpEmail(clean, code);
      setOtpStore({ code, expiry: Date.now() + OTP_VALIDITY_MS });
      setStep("otp");
      toast("OTP sent to your email!", "success");
    } catch {
      await errorDialog("Send Failed", "Failed to send the OTP. Please check your internet connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async (inputOtp) => {
    if (Date.now() > otpStore.expiry) {
      await errorDialog("OTP Expired", "Your OTP has expired. Please go back and request a new one.");
      return;
    }
    if (inputOtp !== otpStore.code) {
      await errorDialog("Invalid OTP", "The code you entered doesn't match. Please check your email and try again.");
      return;
    }
    try {
      const clean  = sanitizeEmail(email);
      const hashed = await bcrypt.hash(password, 10);
      await addDoc(collection(db, "users"), { email: clean, password: hashed, verified: true, createdAt: Date.now() });
      localStorage.setItem("user", JSON.stringify({ email: clean }));
      await successDialog("Account Created!", `Welcome! Your account for ${clean} has been successfully created.`);
      window.location.reload();
    } catch {
      await errorDialog("Registration Failed", "Could not create your account. Please try again.");
    }
  };

  const resendOtp = async () => {
    const code = generateOtp();
    await sendOtpEmail(sanitizeEmail(email), code);
    setOtpStore({ code, expiry: Date.now() + OTP_VALIDITY_MS });
  };

  return (
    <div className="form-section">
      {step === "form" ? (
        <>
          <h2 className="form-title">Create Account</h2>
          <p className="form-subtitle">Join HM today</p>

          <EmailInput value={email} onChange={setEmail} error={!!emailErr} disabled={loading} />
          {emailErr && <p className="field-error">{emailErr}</p>}

          <div className={`input-group ${passErr ? "input-error" : ""}`}>
            <span className="input-icon"><IconLock /></span>
            <input
              type={showPass ? "text" : "password"}
              placeholder="Password (8 chars)"
              value={password}
              onChange={(e) => setPassword(e.target.value.slice(0, 8))}
              disabled={loading}
              maxLength={8}
            />
            <button className="eye-btn" onClick={() => setShowPass((s) => !s)} tabIndex={-1} type="button">
              {showPass ? <IconEyeOff /> : <IconEye />}
            </button>
          </div>

          <div className={`input-group ${passErr ? "input-error" : ""}`}>
            <span className="input-icon"><IconLock /></span>
            <input
              type={showPass ? "text" : "password"}
              placeholder="Confirm Password"
              value={confirmPass}
              onChange={(e) => setConfirmPass(e.target.value.slice(0, 8))}
              onKeyDown={(e) => e.key === "Enter" && handleSendOtp()}
              disabled={loading}
              maxLength={8}
            />
          </div>
          {passErr && <p className="field-error">{passErr}</p>}

          <button className="btn-primary" onClick={handleSendOtp} disabled={loading}>
            {loading ? <span className="spinner" /> : "Create Account"}
          </button>

          <p className="switch-text">
            Already have an account?{" "}
            <button className="link-btn highlight" onClick={onSwitch}>Login</button>
          </p>
        </>
      ) : (
        <>
          <h2 className="form-title">Verify Email</h2>
          <OtpScreen
            email={sanitizeEmail(email)}
            onVerified={verifyOtp}
            onBack={() => setStep("form")}
            onResend={resendOtp}
          />
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ROOT LOGIN COMPONENT
// ═══════════════════════════════════════════════════════════════════
export default function Login() {
  const [view, setView] = useState("login");

  return (
    <>
      <ToastContainer />
      <DialogContainer />
      <div className="auth-root">
        <div className="glow-orb glow-orb-1" />
        <div className="glow-orb glow-orb-2" />
        <div className="glow-orb glow-orb-3" />

        <div className="auth-card">
          <div className="logo-wrap">
            <img src={logi} alt="HM Logo" className="logo-i" />
          </div>

          <div className={`panel-container view-${view}`}>
            {view === "login"  && <LoginScreen  onSwitch={() => setView("signup")} onForgot={() => setView("forgot")} />}
            {view === "signup" && <SignupScreen  onSwitch={() => setView("login")} />}
            {view === "forgot" && <ForgotPassword onBack={() => setView("login")} />}
          </div>
        </div>
      </div>
    </>
  );
}