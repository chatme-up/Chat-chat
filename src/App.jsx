import React, { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { 
  getFirestore, collection, addDoc, query, orderBy, 
  onSnapshot, deleteDoc, doc, setDoc, getDoc, updateDoc 
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBB_8Uq6pCSE8qqju6aknEt2V9uArkmBoc",
  authDomain: "encryptedchat-fbeea.firebaseapp.com",
  projectId: "encryptedchat-fbeea",
  storageBucket: "encryptedchat-fbeea.firebasestorage.app",
  messagingSenderId: "934746892023",
  appId: "1:934746892023:web:2b79852b718c438f3f15f2",
  measurementId: "G-QKY8HJVDTM"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Free Gemini API Integration helper for NAFI AI
const GEMINI_API_KEY = "AIzaSyBB_8Uq6pCSE8qqju6aknEt2V9uArkmBoc";

async function fetchNafiAIResponse(prompt) {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "I am NAFI AI! I'm here to answer any questions you have.";
  } catch (err) {
    return "Network error connecting to NAFI AI. Please try again.";
  }
}

async function hashPassword(password) {
  const enc = new TextEncoder().encode(password);
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function getCryptoKey(passphrase) {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw", enc.encode(passphrase), { name: "PBKDF2" }, false, ["deriveKey"]
  );
  return window.crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode("secure-chat-static-salt-v1"), iterations: 100000, hash: "SHA-256" },
    keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
}

async function encryptData(plaintext, passphrase) {
  try {
    const key = await getCryptoKey(passphrase);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)
    );
    const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
    const cipherHex = Array.from(new Uint8Array(ciphertext)).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${ivHex}:${cipherHex}`;
  } catch (e) {
    return "";
  }
}

async function decryptData(payload, passphrase) {
  try {
    if (!payload || !payload.includes(":")) return "[Decryption Error]";
    const [ivHex, cipherHex] = payload.split(":");
    const iv = new Uint8Array(ivHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    const ciphertext = new Uint8Array(cipherHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    const key = await getCryptoKey(passphrase);
    const decrypted = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new TextDecoder().decode(decrypted);
  } catch (e) {
    return "[Encrypted Message / Wrong Key]";
  }
}

export default function ChatApp() {
  const [authMode, setAuthMode] = useState("login");
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [avatarImage, setAvatarImage] = useState(null);
  const [statusBio, setStatusBio] = useState("Available");
  const [errorMessage, setErrorMessage] = useState("");
  const [currentUser, setCurrentUser] = useState(null);

  const [currentView, setCurrentView] = useState("chats");
  const [activeChatUser, setActiveChatUser] = useState(null);
  const [isAiChat, setIsAiChat] = useState(false);
  const [aiMessages, setAiMessages] = useState([
    { sender: "nafi_ai", type: "text", decryptedText: "Hello! I am NAFI AI. Ask me anything!", timestamp: Date.now() }
  ]);

  const [passphrase, setPassphrase] = useState("my-secret-key");
  const [searchQuery, setSearchQuery] = useState("");
  const [allUsers, setAllUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  
  const [replyingTo, setReplyingTo] = useState(null);
  const [isTypingRemote, setIsTypingRemote] = useState(false);
  const typingTimeoutRef = useRef(null);
  const idleTimerRef = useRef(null);

  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [newProfilePic, setNewProfilePic] = useState(null);
  const [newStatusBioInput, setNewStatusBioInput] = useState("");
  const [resetTargetUser, setResetTargetUser] = useState("");
  const [newPasswordForUser, setNewPasswordForUser] = useState("");
  const [adminSuccessMsg, setAdminSuccessMsg] = useState("");

  const [selectedMsgForOptions, setSelectedMsgForOptions] = useState(null);
  const pressTimerRef = useRef(null);

  const [isRecording, setIsRecording] = useState(false);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const [lightboxImage, setLightboxImage] = useState(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, aiMessages]);

  useEffect(() => {
    if (!isUnlocked) return;
    const resetIdleTimer = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        setIsUnlocked(false);
        setCurrentUser(null);
        alert("Session locked due to 15 minutes of inactivity.");
      }, 15 * 60 * 1000);
    };

    window.addEventListener("mousemove", resetIdleTimer);
    window.addEventListener("keydown", resetIdleTimer);
    window.addEventListener("touchstart", resetIdleTimer);
    resetIdleTimer();

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      window.removeEventListener("mousemove", resetIdleTimer);
      window.removeEventListener("keydown", resetIdleTimer);
      window.removeEventListener("touchstart", resetIdleTimer);
    };
  }, [isUnlocked]);

  useEffect(() => {
    if (!isUnlocked || !currentUser) return;
    const userRef = doc(db, "app_users", currentUser.username);
    updateDoc(userRef, { lastSeen: Date.now() }).catch(() => {});
    const interval = setInterval(() => {
      updateDoc(userRef, { lastSeen: Date.now() }).catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, [isUnlocked, currentUser?.username]);

  useEffect(() => {
    const unsubUsers = onSnapshot(collection(db, "app_users"), (snapshot) => {
      const usersList = [];
      snapshot.forEach(doc => usersList.push(doc.data()));
      setAllUsers(usersList);
      
      if (currentUser) {
        const match = usersList.find(u => u.username === currentUser.username);
        if (match) setCurrentUser(match);
      }
    });
    return () => unsubUsers();
  }, [currentUser?.username]);

  useEffect(() => {
    if (!isUnlocked || !activeChatUser || isAiChat) return;
    const roomKey = [currentUser.username, activeChatUser.username].sort().join("_dm_");
    
    const q = query(collection(db, "rooms", roomKey, "messages"), orderBy("timestamp", "asc"));
    const unsubscribeMsgs = onSnapshot(q, async (snapshot) => {
      const loadedMsgs = [];
      for (const docSnap of snapshot.docs) {
        const data = docSnap.data();
        const decryptedText = await decryptData(data.ciphertext, passphrase);
        loadedMsgs.push({ id: docSnap.id, ...data, decryptedText });

        if (data.sender !== currentUser.username && !data.isRead) {
          await updateDoc(doc(db, "rooms", roomKey, "messages", docSnap.id), { isRead: true });
        }
      }
      setMessages(loadedMsgs);
    });

    const typingRef = doc(db, "rooms", roomKey, "meta", "typing");
    const unsubscribeTyping = onSnapshot(typingRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.user && data.user !== currentUser.username) {
          setIsTypingRemote(data.isTyping);
        }
      }
    });

    return () => {
      unsubscribeMsgs();
      unsubscribeTyping();
    };
  }, [isUnlocked, activeChatUser, isAiChat, passphrase]);

  const handleInputChange = (e) => {
    setInputText(e.target.value);
    if (isAiChat || !activeChatUser) return;

    const roomKey = [currentUser.username, activeChatUser.username].sort().join("_dm_");
    const typingRef = doc(db, "rooms", roomKey, "meta", "typing");
    
    setDoc(typingRef, { user: currentUser.username, isTyping: true }, { merge: true });

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      setDoc(typingRef, { user: currentUser.username, isTyping: false }, { merge: true });
    }, 2000);
  };

  const handleAvatarFileSelect = (e, targetSetter = setAvatarImage) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => targetSetter(reader.result);
    reader.readAsDataURL(file);
  };

  const handleProfileUpdate = async () => {
    try {
      const userRef = doc(db, "app_users", currentUser.username);
      const updates = {};
      if (newProfilePic) updates.avatarImage = newProfilePic;
      if (newStatusBioInput.trim()) updates.statusBio = newStatusBioInput.trim();

      await updateDoc(userRef, updates);
      setCurrentUser(prev => ({ 
        ...prev, 
        avatarImage: newProfilePic || prev.avatarImage,
        statusBio: newStatusBioInput.trim() || prev.statusBio 
      }));
      setNewProfilePic(null);
      setNewStatusBioInput("");
      setShowProfileModal(false);
    } catch (err) {
      alert("Failed to update profile.");
    }
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage("");
    const cleanUser = username.trim().toLowerCase();
    if (!cleanUser || !password) return;

    const userRef = doc(db, "app_users", cleanUser);

    try {
      const userSnap = await getDoc(userRef);
      const passHash = await hashPassword(password);

      if (authMode === "signup") {
        if (password !== confirmPassword) {
          setErrorMessage("⚠️ Passwords do not match. Please re-enter.");
          return;
        }

        if (userSnap.exists()) {
          setErrorMessage("⚠️ Username already exists. Please choose another or login.");
          return;
        }

        const isAdmin = allUsers.length === 0 || cleanUser === "admin";
        const newUserObj = {
          username: cleanUser,
          displayName: username.trim(),
          passwordHash: passHash,
          avatarImage: avatarImage || "https://api.dicebear.com/7.x/bottts/svg?seed=" + cleanUser,
          statusBio: statusBio,
          isAdmin,
          lastSeen: Date.now(),
          createdAt: Date.now()
        };

        await setDoc(userRef, newUserObj);
        setCurrentUser(newUserObj);
        setShowSuccessModal(true);
        setTimeout(() => {
          setShowSuccessModal(false);
          setIsUnlocked(true);
        }, 1500);
      } else {
        if (!userSnap.exists()) {
          setErrorMessage("⚠️ Username not found. Please click 'Create Account' to sign up.");
          return;
        }

        const userData = userSnap.data();
        if (userData.passwordHash !== passHash) {
          setErrorMessage("❌ Incorrect password. Contact Admin to recover password.");
          return;
        }

        setCurrentUser(userData);
        setAvatarImage(userData.avatarImage);
        setStatusBio(userData.statusBio || "Available");
        setIsUnlocked(true);
      }
    } catch (err) {
      setErrorMessage("Authentication error. Please check your connection.");
    }
  };

  const handleAdminPasswordReset = async (e) => {
    e.preventDefault();
    setAdminSuccessMsg("");
    if (!resetTargetUser || !newPasswordForUser) return;

    try {
      const targetRef = doc(db, "app_users", resetTargetUser.toLowerCase());
      const targetSnap = await getDoc(targetRef);

      if (!targetSnap.exists()) {
        alert("User not found.");
        return;
      }

      const newHash = await hashPassword(newPasswordForUser);
      await setDoc(targetRef, { passwordHash: newHash }, { merge: true });
      setAdminSuccessMsg(`Successfully reset password for @${resetTargetUser}!`);
      setResetTargetUser("");
      setNewPasswordForUser("");
    } catch (err) {
      alert("Failed to reset password.");
    }
  };

  const openChatWith = (user, isAi = false) => {
    setIsAiChat(isAi);
    setActiveChatUser(user);
    setReplyingTo(null);
    setCurrentView("chat_room");
  };

  const sendMessage = async (type = "text", content = inputText) => {
    if (!content.trim() && type === "text") return;

    if (isAiChat) {
      const userMsg = { sender: currentUser.username, type: "text", decryptedText: content, timestamp: Date.now() };
      setAiMessages(prev => [...prev, userMsg]);
      setInputText("");

      const aiReplyText = await fetchNafiAIResponse(content);
      setAiMessages(prev => [...prev, { sender: "nafi_ai", type: "text", decryptedText: aiReplyText, timestamp: Date.now() }]);
      return;
    }

    const roomKey = [currentUser.username, activeChatUser.username].sort().join("_dm_");
    const ciphertext = await encryptData(content, passphrase);

    await addDoc(collection(db, "rooms", roomKey, "messages"), {
      sender: currentUser.username,
      senderDisplayName: currentUser.displayName,
      type,
      ciphertext,
      timestamp: Date.now(),
      replyTo: replyingTo ? { sender: replyingTo.sender, text: replyingTo.decryptedText || "[Media]" } : null,
      isRead: false,
      deletedFor: []
    });

    if (type === "text") setInputText("");
    if (type === "audio") setAudioPreviewUrl(null);
    setReplyingTo(null);
  };

  const deleteForEveryone = async (msgId) => {
    if (isAiChat) return;
    const roomKey = [currentUser.username, activeChatUser.username].sort().join("_dm_");
    await deleteDoc(doc(db, "rooms", roomKey, "messages", msgId));
    setSelectedMsgForOptions(null);
  };

  const deleteForMe = (msgId) => {
    if (isAiChat) {
      setAiMessages(prev => prev.filter(m => m.timestamp !== msgId));
      setSelectedMsgForOptions(null);
      return;
    }
    setMessages(prev => prev.map(m => {
      if (m.id === msgId) {
        const hiddenList = m.deletedFor || [];
        return { ...m, deletedFor: [...hiddenList, currentUser.username] };
      }
      return m;
    }));
    setSelectedMsgForOptions(null);
  };

  const handleTouchStart = (msg) => {
    pressTimerRef.current = setTimeout(() => {
      setSelectedMsgForOptions(msg);
    }, 500);
  };

  const handleTouchEnd = () => {
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
  };

  const startRecording = async () => {
    setAudioPreviewUrl(null);
    audioChunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      mediaRecorderRef.current = new MediaRecorder(stream, { mimeType });
      
      mediaRecorderRef.current.ondataavailable = (e) => e.data.size > 0 && audioChunksRef.current.push(e.data);
      mediaRecorderRef.current.onstop = async () => {
        const audioBlobObj = new Blob(audioChunksRef.current, { type: mimeType });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlobObj);
        reader.onloadend = () => setAudioPreviewUrl(reader.result);
      };
      
      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (err) {
      alert("Microphone permission required.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const handleFileUpload = (e, type = "image") => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = async () => {
      sendMessage(type, reader.result);
    };
    reader.readAsDataURL(file);
  };

  if (!isUnlocked) {
    return (
      <div className="min-h-screen bg-slate-200 flex items-center justify-center p-3 font-sans text-slate-800">
        <div className="bg-white border border-slate-300 p-6 rounded-3xl shadow-xl w-full max-w-xs relative overflow-hidden">
          
          {showSuccessModal && (
            <div className="absolute inset-0 bg-white/95 backdrop-blur-md z-50 flex flex-col items-center justify-center text-center p-6">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center text-3xl mb-3 shadow-md animate-bounce">
                ✓
              </div>
              <h2 className="text-xl font-bold text-slate-900 mb-1">Account Created!</h2>
              <p className="text-xs text-slate-500">Welcome to Secure Chat. Logging in...</p>
            </div>
          )}

          <div className="text-center mb-5">
            <div className="text-4xl mb-1">💬</div>
            <h1 className="text-xl font-bold text-slate-900">Secure E2EE Chat</h1>
            <p className="text-slate-500 text-xs mt-0.5">Professional Messaging with NAFI AI</p>
          </div>

          <div className="flex bg-slate-100 p-1 rounded-xl mb-5 border border-slate-200">
            <button 
              type="button"
              onClick={() => { setAuthMode("login"); setErrorMessage(""); }}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition ${authMode === "login" ? 'bg-indigo-950 text-white shadow-sm' : 'text-slate-500'}`}
            >
              Login
            </button>
            <button 
              type="button"
              onClick={() => { setAuthMode("signup"); setErrorMessage(""); }}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition ${authMode === "signup" ? 'bg-indigo-950 text-white shadow-sm' : 'text-slate-500'}`}
            >
              Create Account
            </button>
          </div>

          {errorMessage && (
            <div className="mb-4 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 text-[11px] text-center font-medium">
              {errorMessage}
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="space-y-3.5">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-600 font-semibold mb-1">Username</label>
              <input 
                type="text" 
                value={username} 
                onChange={(e) => { setUsername(e.target.value); setErrorMessage(""); }} 
                placeholder="e.g. tijani" 
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-indigo-950 transition"
                required 
              />
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-600 font-semibold mb-1">Password</label>
              <div className="relative">
                <input 
                  type={showPassword ? "text" : "password"} 
                  value={password} 
                  onChange={(e) => setPassword(e.target.value)} 
                  placeholder="Enter password..." 
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 pr-10 text-xs text-slate-900 focus:outline-none focus:border-indigo-950 transition"
                  required 
                />
                <button 
                  type="button" 
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-indigo-950 text-[11px] font-semibold"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            {authMode === "signup" && (
              <>
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-slate-600 font-semibold mb-1">Re-enter Password</label>
                  <div className="relative">
                    <input 
                      type={showConfirmPassword ? "text" : "password"} 
                      value={confirmPassword} 
                      onChange={(e) => setConfirmPassword(e.target.value)} 
                      placeholder="Confirm password..." 
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 pr-10 text-xs text-slate-900 focus:outline-none focus:border-indigo-950 transition"
                      required 
                    />
                    <button 
                      type="button" 
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-indigo-950 text-[11px] font-semibold"
                    >
                      {showConfirmPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-slate-600 font-semibold mb-1">Status Bio</label>
                  <input 
                    type="text" 
                    value={statusBio} 
                    onChange={(e) => setStatusBio(e.target.value)} 
                    placeholder="e.g. Available, At work..." 
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-950 transition mb-2"
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-slate-600 font-semibold mb-1">Profile Photo</label>
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-300 overflow-hidden flex items-center justify-center flex-shrink-0">
                      {avatarImage ? (
                        <img src={avatarImage} alt="Avatar preview" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-xl">📷</span>
                      )}
                    </div>
                    <label className="flex-1 py-2 px-3 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-xl text-[11px] font-semibold cursor-pointer text-slate-700 text-center transition">
                      Upload Photo
                      <input type="file" accept="image/*" onChange={(e) => handleAvatarFileSelect(e, setAvatarImage)} className="hidden" />
                    </label>
                  </div>
                </div>
              </>
            )}

            <button 
              type="submit" 
              className="w-full py-3 bg-indigo-950 hover:bg-slate-900 text-white font-semibold rounded-xl shadow-md transition transform active:scale-95 text-xs mt-1"
            >
              {authMode === "login" ? "Login" : "Sign Up & Enter"}
            </button>
          </form>

          {authMode === "login" && (
            <p className="text-[10px] text-slate-400 text-center mt-3">
              Forgot password? Contact your designated **Admin** to reset it.
            </p>
          )}
        </div>
      </div>
    );
  }

  const otherUsers = allUsers.filter(u => u.username !== currentUser.username);
  const filteredChats = otherUsers.filter(u => 
    u.displayName.toLowerCase().includes(searchQuery.toLowerCase()) || 
    u.username.includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-screen bg-white text-slate-900 font-sans overflow-hidden w-full max-w-sm mx-auto border-x border-slate-200 shadow-2xl">
      
      {currentView === "chats" && (
        <div className="flex flex-col h-full bg-white">
          <div className="px-3.5 pt-3 pb-2 flex items-center justify-between bg-indigo-950 text-white shadow-md">
            <h1 className="text-xl font-extrabold tracking-tight">Chats</h1>
            <div className="flex items-center gap-2">
              {currentUser.isAdmin && (
                <button 
                  type="button"
                  onClick={() => setShowAdminPanel(true)} 
                  className="text-[10px] px-2 py-1 rounded-md bg-white/20 text-white font-semibold hover:bg-white/30"
                >
                  ⚙️ Admin
                </button>
              )}
              <button 
                type="button"
                onClick={() => setShowProfileModal(true)} 
                className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center overflow-hidden border border-white/30 flex-shrink-0"
                title="Change Profile Picture & Status"
              >
                <img src={currentUser.avatarImage} alt="" className="w-full h-full object-cover" />
              </button>
              <button 
                type="button"
                onClick={() => setIsUnlocked(false)} 
                className="text-[11px] text-slate-300 hover:text-white px-1"
              >
                Logout
              </button>
            </div>
          </div>

          <div className="px-3 py-2">
            <div className="flex items-center gap-2 bg-slate-100 rounded-xl px-2.5 py-1.5 border border-slate-200">
              <span className="text-slate-400 text-xs">🔍</span>
              <input 
                type="text" 
                value={searchQuery} 
                onChange={(e) => setSearchQuery(e.target.value)} 
                placeholder="Search chats or users..." 
                className="bg-transparent text-xs w-full focus:outline-none text-slate-900 placeholder-slate-400"
              />
            </div>
          </div>

          <div className="px-3 py-1 flex items-center gap-1.5 overflow-x-auto">
            <span className="px-2.5 py-0.5 bg-indigo-950 text-white text-[11px] font-semibold rounded-full shadow-sm">All</span>
            <span className="px-2.5 py-0.5 bg-slate-100 text-slate-600 text-[11px] font-medium rounded-full">Unread</span>
            <span className="px-2.5 py-0.5 bg-slate-100 text-slate-600 text-[11px] font-medium rounded-full">Favorites</span>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {/* NAFI AI Assistant Chat Row */}
            <div 
              onClick={() => openChatWith({ username: "nafi_ai", displayName: "NAFI AI", avatarImage: "https://api.dicebear.com/7.x/bottts/svg?seed=nafi_ai" }, true)}
              className="flex items-center gap-2.5 px-3.5 py-3 bg-indigo-50/60 hover:bg-indigo-100/60 cursor-pointer transition border-l-4 border-indigo-950"
            >
              <div className="w-10 h-10 rounded-full bg-indigo-950 text-white flex items-center justify-center text-lg flex-shrink-0 shadow-sm">
                🤖
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <h3 className="font-bold text-xs text-indigo-950 flex items-center gap-1">
                    NAFI AI Assistant <span className="text-[9px] bg-indigo-950 text-white px-1.5 py-0.2 rounded-full">AI</span>
                  </h3>
                  <span className="text-[10px] text-emerald-600 font-medium">● Online</span>
                </div>
                <p className="text-[11px] text-slate-600 truncate">Ask NAFI AI anything in real-time...</p>
              </div>
            </div>

            {filteredChats.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-xs px-4">
                No other registered users yet.<br/>Invite your friends to sign up!
              </div>
            ) : (
              filteredChats.map(user => {
                const isOnline = user.lastSeen && (Date.now() - user.lastSeen < 60000);
                const lastSeenTime = user.lastSeen ? new Date(user.lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";

                return (
                  <div 
                    key={user.username} 
                    onClick={() => openChatWith(user, false)}
                    className="flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-slate-50 cursor-pointer transition"
                  >
                    <div className="relative flex-shrink-0">
                      <img src={user.avatarImage} alt="" className="w-10 h-10 rounded-full object-cover border border-slate-200" />
                      {isOnline && <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-white rounded-full"></span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <h3 className="font-bold text-xs text-slate-900 truncate">{user.displayName}</h3>
                        <span className="text-[10px] text-slate-400">{isOnline ? "Online" : `Last seen ${lastSeenTime}`}</span>
                      </div>
                      <p className="text-[11px] text-slate-500 truncate">{user.statusBio || "Available"}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {currentView === "chat_room" && activeChatUser && (
        <div className="flex flex-col h-full bg-slate-100">
          <header className="bg-indigo-950 text-white px-3 py-2 flex items-center justify-between shadow-md z-10">
            <div className="flex items-center gap-2">
              <button 
                type="button"
                onClick={() => setCurrentView("chats")} 
                className="text-white font-bold text-base hover:text-slate-200 px-1"
              >
                ←
              </button>
              <img src={activeChatUser.avatarImage} alt="" className="w-8 h-8 rounded-full object-cover border border-white/30 flex-shrink-0" />
              <div>
                <h2 className="font-bold text-xs text-white leading-tight">{activeChatUser.displayName}</h2>
                <p className="text-[9px] text-slate-300 font-mono">
                  {isAiChat ? "Live AI Assistant" : (isTypingRemote ? "typing..." : `@${activeChatUser.username}`)}
                </p>
              </div>
            </div>

            {!isAiChat && (
              <div className="flex items-center gap-1.5 text-white">
                <button type="button" onClick={() => alert("Voice call connecting...")} title="Voice Call" className="p-1.5 hover:bg-white/10 rounded-full text-sm">📞</button>
                <button type="button" onClick={() => alert("Video call connecting...")} title="Video Call" className="p-1.5 hover:bg-white/10 rounded-full text-sm">📹</button>
              </div>
            )}
          </header>

          <div className="flex-1 overflow-y-auto p-3 space-y-2.5 bg-slate-100">
            {(isAiChat ? aiMessages : messages).map((msg) => {
              const isMe = msg.sender === currentUser.username;
              if (!isAiChat && msg.deletedFor?.includes(currentUser.username)) return null;

              return (
                <div key={msg.id || msg.timestamp} className={`flex items-end gap-1.5 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div 
                    onTouchStart={() => handleTouchStart(msg)}
                    onTouchEnd={handleTouchEnd}
                    onMouseDown={() => handleTouchStart(msg)}
                    onMouseUp={handleTouchEnd}
                    onMouseLeave={handleTouchEnd}
                    className={`max-w-[80%] rounded-2xl px-3 py-2 shadow-sm relative select-none cursor-pointer border ${isMe ? 'bg-indigo-950 border-indigo-950 text-white rounded-br-none' : 'bg-white border-slate-200 text-slate-800 rounded-bl-none'}`}
                  >
                    {msg.replyTo && (
                      <div className={`mb-1.5 p-1.5 rounded-lg text-[10px] border-l-2 ${isMe ? 'bg-white/10 border-white text-slate-200' : 'bg-slate-100 border-indigo-950 text-slate-600'}`}>
                        <p className="font-semibold">@{msg.replyTo.sender}</p>
                        <p className="truncate">{msg.replyTo.text}</p>
                      </div>
                    )}

                    <div className={`flex items-center justify-between gap-3 mb-0.5 text-[9px] ${isMe ? 'text-slate-300' : 'text-slate-400'}`}>
                      <span className="font-semibold">@{msg.sender}</span>
                      <div className="flex items-center gap-1">
                        <span className="font-mono">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        {isMe && !isAiChat && (
                          <span className={`text-[10px] font-bold ${msg.isRead ? 'text-sky-400' : 'text-slate-400'}`} title={msg.isRead ? "Read" : "Sent"}>
                            ✓✓
                          </span>
                        )}
                      </div>
                    </div>

                    {msg.type === 'text' && (
                      <p className="text-xs leading-relaxed whitespace-pre-wrap break-words">{msg.decryptedText}</p>
                    )}
                    {msg.type === 'image' && (
                      <img 
                        src={msg.decryptedText} 
                        alt="Shared media" 
                        onClick={(e) => { e.stopPropagation(); setLightboxImage(msg.decryptedText); }}
                        className="rounded-xl max-h-48 w-full object-cover cursor-pointer hover:opacity-95 transition mt-1 border border-slate-200" 
                      />
                    )}
                    {msg.type === 'file' && (
                      <a href={msg.decryptedText} download="shared-file" className="flex items-center gap-1.5 underline text-xs mt-0.5">
                        📁 Download Attached File
                      </a>
                    )}
                    {msg.type === 'audio' && (
                      <audio controls src={msg.decryptedText} className="mt-1 h-8 w-44 accent-indigo-950"></audio>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          <footer className="bg-white border-t border-slate-200 p-2 shadow-md">
            {replyingTo && (
              <div className="flex items-center justify-between bg-slate-100 px-3 py-1.5 rounded-xl mb-2 border-l-4 border-indigo-950 text-xs">
                <div>
                  <span className="font-bold text-indigo-950 text-[11px]">Replying to @{replyingTo.sender}</span>
                  <p className="text-slate-600 truncate max-w-[240px]">{replyingTo.decryptedText || "[Media]"}</p>
                </div>
                <button onClick={() => setReplyingTo(null)} className="text-slate-400 hover:text-slate-600">✕</button>
              </div>
            )}

            {audioPreviewUrl ? (
              <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-2xl border border-slate-300">
                <button type="button" onClick={() => setAudioPreviewUrl(null)} className="p-1.5 rounded-xl bg-rose-100 text-rose-600 text-[11px] font-semibold">Discard</button>
                <audio controls src={audioPreviewUrl} className="flex-1 h-8 accent-indigo-950"></audio>
                <button type="button" onClick={() => sendMessage("audio", audioPreviewUrl)} className="px-3 py-1.5 bg-indigo-950 text-white text-[11px] font-semibold rounded-xl">Send</button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                {!isAiChat && (
                  <>
                    <label className="p-2 rounded-full bg-slate-100 hover:bg-slate-200 cursor-pointer text-slate-700 transition text-xs" title="Upload Image">
                      📷
                      <input type="file" accept="image/*" onChange={(e) => handleFileUpload(e, "image")} className="hidden" />
                    </label>

                    <label className="p-2 rounded-full bg-slate-100 hover:bg-slate-200 cursor-pointer text-slate-700 transition text-xs" title="Upload File">
                      📎
                      <input type="file" onChange={(e) => handleFileUpload(e, "file")} className="hidden" />
                    </label>

                    <button 
                      type="button" 
                      onMouseDown={startRecording} 
                      onMouseUp={stopRecording} 
                      onTouchStart={startRecording} 
                      onTouchEnd={stopRecording} 
                      className={`p-2 rounded-full border transition text-xs ${isRecording ? 'bg-rose-500 text-white border-rose-600 animate-pulse' : 'bg-slate-100 text-slate-700 border-slate-200'}`}
                      title="Hold to record voice note"
                    >
                      🎙️
                    </button>
                  </>
                )}

                <input 
                  type="text" 
                  value={inputText} 
                  onChange={handleInputChange} 
                  onKeyDown={(e) => e.key === 'Enter' && sendMessage("text", inputText)}
                  placeholder={isAiChat ? "Ask NAFI AI anything..." : "Type a message..."} 
                  className="flex-1 bg-slate-100 border border-slate-200 rounded-full px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-950 transition"
                />

                <button 
                  type="button"
                  onClick={() => sendMessage("text", inputText)} 
                  className="p-2 bg-indigo-950 hover:bg-slate-900 text-white rounded-full shadow-md transition text-xs"
                >
                  ➤
                </button>
              </div>
            )}
          </footer>
        </div>
      )}

      {selectedMsgForOptions && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-4 max-w-xs w-full shadow-2xl border border-slate-200 text-center">
            <h3 className="font-bold text-sm text-slate-900 mb-3">Message Options</h3>
            <div className="space-y-2">
              <button 
                type="button" 
                onClick={() => { setReplyingTo(selectedMsgForOptions); setSelectedMsgForOptions(null); }} 
                className="w-full py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-950 font-semibold rounded-xl text-xs transition"
              >
                Reply Quote ↩️
              </button>
              {!isAiChat && selectedMsgForOptions.sender === currentUser.username && (
                <button 
                  type="button" 
                  onClick={() => deleteForEveryone(selectedMsgForOptions.id)} 
                  className="w-full py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-xl text-xs transition"
                >
                  Delete for Everyone 🗑️
                </button>
              )}
              <button 
                type="button" 
                onClick={() => deleteForMe(selectedMsgForOptions.id || selectedMsgForOptions.timestamp)} 
                className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold rounded-xl text-xs transition"
              >
                Delete for Me 👤
              </button>
              <button 
                type="button" 
                onClick={() => setSelectedMsgForOptions(null)} 
                className="w-full py-2 text-slate-400 hover:text-slate-600 text-xs font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showProfileModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-5 max-w-xs w-full shadow-2xl border border-slate-200 text-center">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-sm text-slate-900">Edit Profile & Status</h3>
              <button type="button" onClick={() => setShowProfileModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <div className="w-20 h-20 rounded-full bg-slate-100 border border-slate-300 overflow-hidden mx-auto mb-3 flex items-center justify-center">
              {newProfilePic || currentUser.avatarImage ? (
                <img src={newProfilePic || currentUser.avatarImage} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-3xl">📷</span>
              )}
            </div>

            <label className="block w-full py-2 px-4 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-xl text-xs font-semibold cursor-pointer text-slate-700 mb-3 transition">
              Change Photo
              <input type="file" accept="image/*" onChange={(e) => handleAvatarFileSelect(e, setNewProfilePic)} className="hidden" />
            </label>

            <div className="mb-4 text-left">
              <label className="block text-[10px] uppercase tracking-wider text-slate-600 font-semibold mb-1">Status Bio</label>
              <input 
                type="text" 
                value={newStatusBioInput} 
                onChange={(e) => setNewStatusBioInput(e.target.value)} 
                placeholder={currentUser.statusBio || "Available"} 
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-950 transition"
              />
            </div>

            <button 
              type="button" 
              onClick={handleProfileUpdate} 
              className="w-full py-2.5 bg-indigo-950 text-white font-semibold rounded-xl text-xs transition shadow-md"
            >
              Save Profile Changes
            </button>
          </div>
        </div>
      )}

      {showAdminPanel && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-5 max-w-xs w-full shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-sm text-slate-900">⚙️ Admin Control Panel</h3>
              <button type="button" onClick={() => setShowAdminPanel(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            
            {adminSuccessMsg && (
              <div className="mb-3 p-2.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs text-center font-medium">
                {adminSuccessMsg}
              </div>
            )}

            <form onSubmit={handleAdminPasswordReset} className="space-y-3">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-600 font-semibold mb-1">Target Username</label>
                <input 
                  type="text" 
                  value={resetTargetUser} 
                  onChange={(e) => setResetTargetUser(e.target.value)} 
                  placeholder="e.g. tijani" 
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs"
                  required 
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-600 font-semibold mb-1">New Password</label>
                <input 
                  type="password" 
                  value={newPasswordForUser} 
                  onChange={(e) => setNewPasswordForUser(e.target.value)} 
                  placeholder="Enter new password..." 
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs"
                  required 
                />
              </div>

              <button 
                type="submit" 
                className="w-full py-2.5 bg-indigo-950 text-white font-semibold rounded-xl text-xs transition"
              >
                Reset Password
              </button>
            </form>
          </div>
        </div>
      )}

      {lightboxImage && (
        <div onClick={() => setLightboxImage(null)} className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <img src={lightboxImage} alt="Fullscreen preview" className="max-w-full max-h-full rounded-2xl border border-white/20" />
        </div>
      )}
    </div>
  );
}
